/**
 * run_tests - Run project test suite
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const paramsSchema = z.object({
  scope: z
    .enum(["all", "affected", "specific"])
    .optional()
    .describe("Which tests to run (default: affected)"),
  pattern: z.string().optional().describe("Test file pattern for 'specific' scope"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 60000)"),
});

type RunTestsParams = z.infer<typeof paramsSchema>;

export interface TestResult {
  status: "pass" | "fail" | "error";
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{ name: string; message: string }>;
  output: string;
}

/**
 * Detect the test runner used in the project
 */
function detectTestRunner(repoPath: string): { command: string; runner: string } {
  const pkgPath = path.join(repoPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const testScript = pkg.scripts?.test;

    if (testScript) {
      if (testScript.includes("vitest")) {
        return { command: "npx vitest run", runner: "vitest" };
      }
      if (testScript.includes("jest")) {
        return { command: "npx jest", runner: "jest" };
      }
      if (testScript.includes("mocha")) {
        return { command: "npx mocha", runner: "mocha" };
      }
      return { command: "npm test --", runner: "npm" };
    }

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return { command: "npx vitest run", runner: "vitest" };
    if (deps.jest) return { command: "npx jest", runner: "jest" };
    if (deps.mocha) return { command: "npx mocha", runner: "mocha" };
  }

  if (fs.existsSync(path.join(repoPath, "pytest.ini")) ||
      fs.existsSync(path.join(repoPath, "pyproject.toml"))) {
    return { command: "pytest", runner: "pytest" };
  }

  if (fs.existsSync(path.join(repoPath, "Cargo.toml"))) {
    return { command: "cargo test", runner: "cargo" };
  }

  return { command: "npm test --", runner: "npm" };
}

/**
 * Parse test output to extract pass/fail counts
 */
function parseTestOutput(
  output: string,
  runner: string
): { passed: number; failed: number; skipped: number; failures: Array<{ name: string; message: string }> } {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ name: string; message: string }> = [];

  if (runner === "jest" || runner === "vitest") {
    const match = output.match(/Tests:\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (match) {
      passed = parseInt(match[1], 10);
      failed = parseInt(match[2], 10);
    } else {
      const passMatch = output.match(/(\d+)\s+passed/i);
      const failMatch = output.match(/(\d+)\s+failed/i);
      if (passMatch) passed = parseInt(passMatch[1], 10);
      if (failMatch) failed = parseInt(failMatch[1], 10);
    }
  } else if (runner === "pytest") {
    const match = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (match) {
      passed = parseInt(match[1], 10);
      failed = parseInt(match[2], 10);
    }
  } else if (runner === "cargo") {
    const match = output.match(/(\d+)\s+passed;\s+(\d+)\s+failed/);
    if (match) {
      passed = parseInt(match[1], 10);
      failed = parseInt(match[2], 10);
    }
  } else {
    const passMatch = output.match(/(\d+)\s+(?:passing|passed|✓)/i);
    const failMatch = output.match(/(\d+)\s+(?:failing|failed|✗)/i);
    if (passMatch) passed = parseInt(passMatch[1], 10);
    if (failMatch) failed = parseInt(failMatch[1], 10);
  }

  return { passed, failed, skipped, failures: failures.slice(0, 5) };
}

export const runTestsTool: Tool<RunTestsParams, TestResult> = {
  name: "run_tests",
  description:
    "Run the test suite. ALWAYS run tests after applying patches and before committing.",
  category: "MUTATING",
  paramsSchema,
  resultSchema: z.object({
    status: z.enum(["pass", "fail", "error"]),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    duration: z.number(),
    failures: z.array(z.object({ name: z.string(), message: z.string() })),
    output: z.string(),
  }),
  costHint: "expensive",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<TestResult>> {
    const startTime = Date.now();
    const timeout = params.timeout ?? 60000;
    const scope = params.scope ?? "affected";

    try {
      const { command, runner } = detectTestRunner(ctx.repoPath);

      let testCmd = command;
      if (scope === "specific" && params.pattern) {
        testCmd += ` ${params.pattern}`;
      }
      if (scope === "affected") {
        if (runner === "jest") testCmd += " --changedSince=HEAD~1";
        if (runner === "vitest") testCmd += " --changed";
      }

      return new Promise((resolve) => {
        let output = "";
        let timedOut = false;

        const proc = spawn("sh", ["-c", testCmd], {
          cwd: ctx.repoPath,
          env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
        });

        proc.stdout?.on("data", (data) => {
          output += data.toString();
        });

        proc.stderr?.on("data", (data) => {
          output += data.toString();
        });

        const timeoutId = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, timeout);

        proc.on("close", (code) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;

          if (timedOut) {
            resolve({
              success: true,
              data: {
                status: "error",
                passed: 0,
                failed: 0,
                skipped: 0,
                duration,
                failures: [{ name: "timeout", message: `Tests timed out after ${timeout}ms` }],
                output: output.slice(-5000),
              },
              eventId: crypto.randomUUID(),
            });
            return;
          }

          const { passed, failed, skipped, failures } = parseTestOutput(output, runner);

          resolve({
            success: true,
            data: {
              status: code === 0 ? "pass" : "fail",
              passed,
              failed,
              skipped,
              duration,
              failures,
              output: output.slice(-5000),
            },
            eventId: crypto.randomUUID(),
          });
        });

        proc.on("error", (err) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            error: {
              code: "test_error",
              message: err.message,
              recoverable: true,
            },
            eventId: crypto.randomUUID(),
          });
        });
      });
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "test_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  },
};
