/**
 * Browser Automation Tools
 * 
 * Tools for interacting with web browsers for testing web applications.
 * Uses Playwright under the hood for reliable cross-browser automation.
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";

// Playwright is optional - gracefully handle if not installed
let playwright: typeof import("playwright") | null = null;
let browser: import("playwright").Browser | null = null;
let page: import("playwright").Page | null = null;

async function ensureBrowser() {
  if (!playwright) {
    try {
      playwright = await import("playwright");
    } catch {
      throw new Error("Playwright not installed. Run: pnpm add -D playwright");
    }
  }
  
  if (!browser) {
    browser = await playwright.chromium.launch({ headless: true });
  }
  
  if (!page) {
    page = await browser.newPage();
  }
  
  return { browser, page };
}

// =============================================================================
// 1. BROWSER NAVIGATE
// =============================================================================

const navigateParams = z.object({
  url: z.string().url().describe("The URL to navigate to"),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional()
    .describe("When to consider navigation complete (default: load)"),
  timeout: z.number().int().min(1000).max(60000).optional()
    .describe("Navigation timeout in milliseconds (default: 30000)"),
});

type NavigateParams = z.infer<typeof navigateParams>;

type NavigateResult = {
  url: string;
  title: string;
  status: number;
  loadTime: number;
};

export const browserNavigateTool: Tool<NavigateParams, NavigateResult> = {
  name: "browser_navigate",
  description: "Navigate browser to a URL. Use for testing web applications.",
  category: "MUTATING",
  paramsSchema: navigateParams,
  resultSchema: z.object({
    url: z.string(),
    title: z.string(),
    status: z.number(),
    loadTime: z.number(),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<NavigateResult>> {
    try {
      const { page } = await ensureBrowser();
      const startTime = Date.now();
      
      const response = await page.goto(params.url, {
        waitUntil: params.waitUntil,
        timeout: params.timeout,
      });

      const loadTime = Date.now() - startTime;
      const title = await page.title();

      return {
        success: true,
        data: {
          url: page.url(),
          title,
          status: response?.status() ?? 0,
          loadTime,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "browser_navigate_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 2. BROWSER SNAPSHOT (Accessibility Tree)
// =============================================================================

const snapshotParams = z.object({
  selector: z.string().optional().describe("CSS selector to limit snapshot scope"),
  includeHidden: z.boolean().optional().describe("Include hidden elements (default: false)"),
});

type SnapshotParams = z.infer<typeof snapshotParams>;

interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  ref: string;
  children?: AccessibilityNode[];
}

type SnapshotResult = {
  url: string;
  title: string;
  tree: AccessibilityNode;
  interactiveElements: Array<{
    ref: string;
    role: string;
    name: string;
    selector: string;
  }>;
};

export const browserSnapshotTool: Tool<SnapshotParams, SnapshotResult> = {
  name: "browser_snapshot",
  description: "Get accessibility snapshot of current page. Better than screenshots for understanding page structure.",
  category: "READ_ONLY",
  paramsSchema: snapshotParams,
  resultSchema: z.object({
    url: z.string(),
    title: z.string(),
    tree: z.any() as z.ZodType<AccessibilityNode>,
    interactiveElements: z.array(z.object({
      ref: z.string(),
      role: z.string(),
      name: z.string(),
      selector: z.string(),
    })),
  }) as z.ZodType<SnapshotResult>,
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<SnapshotResult>> {
    try {
      const { page } = await ensureBrowser();
      
      // Get page content as structured data (simplified accessibility tree)
      const includeHidden = params.includeHidden ?? false;
      
      // Use evaluate to get structured page info
      const snapshot = await page.evaluate((includeHidden: boolean) => {
        function getAccessibleName(el: Element): string {
          return el.getAttribute('aria-label') 
            || el.getAttribute('title')
            || (el as HTMLElement).innerText?.slice(0, 100)
            || el.tagName.toLowerCase();
        }
        
        function traverse(el: Element): any {
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          const hidden = (el as HTMLElement).hidden || 
            getComputedStyle(el).display === 'none' ||
            getComputedStyle(el).visibility === 'hidden';
          
          if (hidden && !includeHidden) return null;
          
          return {
            role,
            name: getAccessibleName(el),
            children: Array.from(el.children)
              .map(child => traverse(child))
              .filter(Boolean),
          };
        }
        
        return traverse(document.body);
      }, includeHidden);

      // Extract interactive elements with selectors
      const interactiveElements: SnapshotResult["interactiveElements"] = [];
      let refCounter = 0;

      function traverse(node: any, path: string[] = []) {
        if (!node) return null;
        
        const ref = `e${refCounter++}`;
        const result: AccessibilityNode = {
          role: node.role || "generic",
          name: node.name || "",
          value: node.value,
          description: node.description,
          ref,
        };

        // Track interactive elements
        const interactiveRoles = ["button", "link", "textbox", "checkbox", "radio", "combobox", "menuitem"];
        if (interactiveRoles.includes(result.role)) {
          interactiveElements.push({
            ref,
            role: result.role,
            name: result.name,
            selector: `[aria-label="${result.name}"], ${result.role}:has-text("${result.name}")`,
          });
        }

        if (node.children) {
          result.children = node.children
            .map((child: any) => traverse(child, [...path, result.role]))
            .filter(Boolean);
        }

        return result;
      }

      const tree = traverse(snapshot) || { role: "document", name: "", ref: "root" };

      return {
        success: true,
        data: {
          url: page.url(),
          title: await page.title(),
          tree,
          interactiveElements: interactiveElements.slice(0, 100), // Limit for response size
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "browser_snapshot_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 3. BROWSER CLICK
// =============================================================================

const clickParams = z.object({
  selector: z.string().describe("CSS selector or text selector (e.g., 'text=Submit')"),
  button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
  clickCount: z.number().int().min(1).max(3).optional().describe("1 for single, 2 for double click (default: 1)"),
  timeout: z.number().int().min(100).max(30000).optional().describe("Timeout in ms (default: 5000)"),
});

type ClickParams = z.infer<typeof clickParams>;

type ClickResult = {
  clicked: boolean;
  elementText: string;
  newUrl?: string;
};

export const browserClickTool: Tool<ClickParams, ClickResult> = {
  name: "browser_click",
  description: "Click on an element. Use CSS selectors or 'text=...' for text content.",
  category: "MUTATING",
  paramsSchema: clickParams,
  resultSchema: z.object({
    clicked: z.boolean(),
    elementText: z.string(),
    newUrl: z.string().optional(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<ClickResult>> {
    try {
      const { page } = await ensureBrowser();
      const urlBefore = page.url();
      
      await page.click(params.selector, {
        button: params.button,
        clickCount: params.clickCount,
        timeout: params.timeout,
      });

      // Wait a bit for any navigation
      await page.waitForTimeout(500);
      
      const urlAfter = page.url();
      
      // Try to get element text
      let elementText = "";
      try {
        elementText = await page.locator(params.selector).first().textContent() ?? "";
      } catch { /* element might be gone */ }

      return {
        success: true,
        data: {
          clicked: true,
          elementText: elementText.slice(0, 100),
          newUrl: urlAfter !== urlBefore ? urlAfter : undefined,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "browser_click_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 4. BROWSER TYPE
// =============================================================================

const typeParams = z.object({
  selector: z.string().describe("CSS selector for input element"),
  text: z.string().describe("Text to type"),
  clear: z.boolean().optional().describe("Clear existing content before typing (default: true)"),
  submit: z.boolean().optional().describe("Press Enter after typing (default: false)"),
  delay: z.number().int().min(0).max(500).optional().describe("Delay between keystrokes in ms (default: 0)"),
});

type TypeParams = z.infer<typeof typeParams>;

type TypeResult = {
  typed: boolean;
  finalValue: string;
};

export const browserTypeTool: Tool<TypeParams, TypeResult> = {
  name: "browser_type",
  description: "Type text into an input field. Can clear existing content and submit.",
  category: "MUTATING",
  paramsSchema: typeParams,
  resultSchema: z.object({
    typed: z.boolean(),
    finalValue: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<TypeResult>> {
    try {
      const { page } = await ensureBrowser();
      
      const locator = page.locator(params.selector).first();
      
      if (params.clear) {
        await locator.clear();
      }
      
      await locator.type(params.text, { delay: params.delay });
      
      if (params.submit) {
        await locator.press("Enter");
      }
      
      const finalValue = await locator.inputValue();

      return {
        success: true,
        data: { typed: true, finalValue },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "browser_type_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 5. BROWSER SCREENSHOT
// =============================================================================

const screenshotParams = z.object({
  selector: z.string().optional().describe("CSS selector to screenshot specific element"),
  fullPage: z.boolean().optional().describe("Capture full scrollable page (default: false)"),
  path: z.string().optional().describe("Save to file path (relative to repo)"),
  type: z.enum(["png", "jpeg"]).optional().describe("Image format (default: png)"),
  quality: z.number().int().min(0).max(100).optional().describe("JPEG quality (0-100)"),
});

type ScreenshotParams = z.infer<typeof screenshotParams>;

type ScreenshotResult = {
  width: number;
  height: number;
  savedTo?: string;
  base64?: string;
};

export const browserScreenshotTool: Tool<ScreenshotParams, ScreenshotResult> = {
  name: "browser_screenshot",
  description: "Take a screenshot of the page or specific element.",
  category: "READ_ONLY",
  paramsSchema: screenshotParams,
  resultSchema: z.object({
    width: z.number(),
    height: z.number(),
    savedTo: z.string().optional(),
    base64: z.string().optional(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<ScreenshotResult>> {
    try {
      const { page } = await ensureBrowser();
      
      const options: any = {
        type: params.type,
        fullPage: params.fullPage,
      };
      
      if (params.quality && params.type === "jpeg") {
        options.quality = params.quality;
      }
      
      let buffer: Buffer;
      
      if (params.selector) {
        buffer = await page.locator(params.selector).first().screenshot(options);
      } else {
        buffer = await page.screenshot(options);
      }
      
      // Get dimensions
      const viewport = page.viewportSize();
      
      let result: ScreenshotResult = {
        width: viewport?.width ?? 0,
        height: viewport?.height ?? 0,
      };
      
      if (params.path) {
        const { default: fs } = await import("fs");
        const { default: path } = await import("path");
        const fullPath = path.join(ctx.repoPath, params.path);
        fs.writeFileSync(fullPath, buffer);
        result.savedTo = params.path;
      } else {
        // Return base64 if not saving to file (limited size)
        result.base64 = buffer.toString("base64").slice(0, 10000) + "...";
      }

      return {
        success: true,
        data: result,
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "browser_screenshot_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 6. BROWSER WAIT
// =============================================================================

const waitParams = z.object({
  selector: z.string().optional().describe("Wait for element to appear"),
  text: z.string().optional().describe("Wait for text to appear on page"),
  url: z.string().optional().describe("Wait for URL to match (regex)"),
  timeout: z.number().int().min(100).max(60000).optional().describe("Timeout in ms (default: 10000)"),
  state: z.enum(["attached", "detached", "visible", "hidden"]).optional()
    .describe("Element state to wait for (default: visible)"),
});

type WaitParams = z.infer<typeof waitParams>;

type WaitResult = {
  waited: boolean;
  duration: number;
  found: boolean;
};

export const browserWaitTool: Tool<WaitParams, WaitResult> = {
  name: "browser_wait",
  description: "Wait for element, text, or URL. Use after actions that trigger async changes.",
  category: "READ_ONLY",
  paramsSchema: waitParams,
  resultSchema: z.object({
    waited: z.boolean(),
    duration: z.number(),
    found: z.boolean(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<WaitResult>> {
    try {
      const { page } = await ensureBrowser();
      const startTime = Date.now();
      
      let found = false;
      
      if (params.selector) {
        await page.locator(params.selector).waitFor({
          state: params.state,
          timeout: params.timeout,
        });
        found = true;
      } else if (params.text) {
        await page.waitForSelector(`text=${params.text}`, { timeout: params.timeout });
        found = true;
      } else if (params.url) {
        await page.waitForURL(new RegExp(params.url), { timeout: params.timeout });
        found = true;
      }
      
      const duration = Date.now() - startTime;

      return {
        success: true,
        data: { waited: true, duration, found },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "browser_wait_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 7. BROWSER CLOSE
// =============================================================================

const closeParams = z.object({});

type CloseParams = z.infer<typeof closeParams>;

type CloseResult = { closed: boolean };

export const browserCloseTool: Tool<CloseParams, CloseResult> = {
  name: "browser_close",
  description: "Close the browser. Call when done with browser testing.",
  category: "MUTATING",
  paramsSchema: closeParams,
  resultSchema: z.object({ closed: z.boolean() }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<CloseResult>> {
    try {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }

      return {
        success: true,
        data: { closed: true },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "browser_close_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// EXPORTS
// =============================================================================

export const browserTools = [
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScreenshotTool,
  browserWaitTool,
  browserCloseTool,
];

