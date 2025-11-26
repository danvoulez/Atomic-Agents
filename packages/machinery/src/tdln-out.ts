/**
 * TDLN-OUT: JSON → Natural Language renderer
 * Wraps Rust napi-bindings with JS fallback
 */

export interface RenderInput {
  type: string;
  data: Record<string, unknown>;
  templatePath?: string;
}

export interface RenderResult {
  text: string;
  citations?: Array<{ source: string; field: string }>;
}

// Native bindings interface
interface NativeBindings {
  renderJsonToNl: (json: string, templatePath: string) => string;
}

let native: NativeBindings | null = null;
let nativeLoadAttempted = false;

async function loadNative(): Promise<NativeBindings | null> {
  if (nativeLoadAttempted) return native;
  nativeLoadAttempted = true;

  try {
    const mod = await import("@ai-coding-team/napi-bindings" as string);
    native = mod as NativeBindings;
    return native;
  } catch {
    return null;
  }
}

/**
 * Render structured data to natural language (async, uses native if available).
 */
export async function renderToNaturalLanguageAsync(input: RenderInput): Promise<RenderResult> {
  const templatePath = input.templatePath ?? "grammars/response-templates.yaml";
  const n = await loadNative();

  if (n) {
    const json = JSON.stringify({ type: input.type, ...input.data });
    const text = n.renderJsonToNl(json, templatePath);
    return { text };
  }

  return renderToNaturalLanguage(input);
}

/**
 * Synchronous rendering (fallback templates)
 */
export function renderToNaturalLanguage(input: RenderInput): RenderResult {
  return { text: renderWithFallback(input.type, input.data) };
}

/**
 * Simple template rendering fallback
 */
function renderWithFallback(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "job_started":
      return `On it! I'll ${data.action ?? "work on this"} in \`${data.target ?? "the codebase"}\`.`;

    case "job_progress":
      return `Step ${data.step ?? "?"}/${data.total ?? "?"}: ${data.action ?? "Processing..."}`;

    case "job_complete_success": {
      const lines = [`Done! ${data.summary ?? "Task completed."}`];
      if (data.files_changed) {
        lines.push(`📁 Changed ${data.files_changed} file(s)`);
        if (data.lines_added || data.lines_removed) {
          lines[lines.length - 1] += ` (+${data.lines_added ?? 0}/-${data.lines_removed ?? 0})`;
        }
      }
      if (data.tests_passed !== undefined) {
        let testLine = `✅ Tests: ${data.tests_passed} passed`;
        if (data.tests_failed) testLine += `, ${data.tests_failed} failed`;
        lines.push(testLine);
      }
      if (data.commit) {
        lines.push(`📝 Commit: \`${data.commit}\``);
      }
      if (data.pr_url) {
        lines.push(`🔗 PR: ${data.pr_url}`);
      }
      return lines.join("\n");
    }

    case "job_complete_failure": {
      const lines = [`Hit a snag: ${data.error ?? "Unknown error"}`];
      if (data.reason) lines.push(`Reason: ${data.reason}`);
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        lines.push("Suggestions:");
        for (const s of data.suggestions) {
          lines.push(`- ${s}`);
        }
      }
      if (data.can_retry) {
        lines.push("Want me to try again with a different approach?");
      }
      return lines.join("\n");
    }

    case "clarification_needed": {
      const lines = [String(data.question ?? "I need more information.")];
      if (Array.isArray(data.options) && data.options.length > 0) {
        lines.push("Options:");
        data.options.forEach((opt, i) => {
          lines.push(`${i + 1}. ${opt}`);
        });
      }
      if (data.context) {
        lines.push(`(Context: ${data.context})`);
      }
      return lines.join("\n");
    }

    case "escalated_to_human": {
      const lines = ["I need human help with this.", "", `**Reason:** ${data.reason ?? "Unspecified"}`];
      if (data.what_i_tried) lines.push(`**What I tried:** ${data.what_i_tried}`);
      if (data.suggested_action) lines.push(`**Suggestion:** ${data.suggested_action}`);
      return lines.join("\n");
    }

    case "analysis_complete": {
      const lines = [`Here's what I found about \`${data.subject ?? "this"}\`:`, "", String(data.findings ?? "")];
      if (Array.isArray(data.related_files) && data.related_files.length > 0) {
        lines.push(`Related files: ${data.related_files.map((f) => `\`${f}\``).join(" ")}`);
      }
      return lines.join("\n");
    }

    case "plan_proposed": {
      const lines = [`Here's my plan for "${data.goal ?? "this task"}":`, ""];
      if (Array.isArray(data.steps)) {
        for (const step of data.steps as Array<{ step_number?: number; title?: string; description?: string }>) {
          lines.push(`${step.step_number ?? "?"}. **${step.title ?? "Step"}**`);
          if (step.description) lines.push(`   ${step.description}`);
        }
      }
      lines.push("", "Should I proceed?");
      return lines.join("\n");
    }

    default:
      return `[${type}] ${JSON.stringify(data)}`;
  }
}
