/**
 * TDLN-IN: Natural Language → LogLine compiler
 * Wraps Rust napi-bindings with JS fallback
 */

import type { ParsedLogLine, LogLineValue } from "./logline";

export interface TranslateInput {
  text: string;
  grammarPath?: string;
}

export interface TranslateResult {
  span: ParsedLogLine;
  verdict: "Translated" | "Abstain";
  abstainReason?: string;
  clarification?: string;
}

// Native bindings interface
interface NativeBindings {
  translateNlToLogline: (req: { text: string }, grammarPath: string) => string;
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
 * Translate natural language input to a LogLine span (async, uses native if available).
 */
export async function translateToLogLineAsync(input: TranslateInput): Promise<TranslateResult> {
  const grammarPath = input.grammarPath ?? "grammars/coding-intents.yaml";
  const n = await loadNative();

  if (n) {
    try {
      const json = n.translateNlToLogline({ text: input.text }, grammarPath);
      const span = JSON.parse(json) as ParsedLogLine;
      return { span, verdict: "Translated" };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no match")) {
        return {
          span: { type: "unknown", params: [] },
          verdict: "Abstain",
          abstainReason: "no_match",
          clarification: "I'm not sure what you'd like me to do. Try: 'fix [bug] in [file]', 'add [feature]', or 'explain [code]'",
        };
      }
      throw e;
    }
  }

  return translateToLogLine(input);
}

/**
 * Synchronous translation (fallback pattern matching)
 */
export function translateToLogLine(input: TranslateInput): TranslateResult {
  const normalized = input.text.toLowerCase().trim();

  // Bug fix patterns
  if (normalized.includes("fix") || normalized.includes("bug") || normalized.includes("broken")) {
    const target = extractTarget(normalized) ?? "unknown";
    return {
      span: {
        type: "operation",
        name: "bug_fix",
        params: [
          ["target", { Str: target }],
          ["description", { Str: input.text }],
          ["mode", { Str: "mechanic" }],
        ],
      },
      verdict: "Translated",
    };
  }

  // Feature patterns
  if (normalized.includes("add") || normalized.includes("create") || normalized.includes("implement")) {
    return {
      span: {
        type: "operation",
        name: "feature",
        params: [
          ["description", { Str: input.text }],
          ["mode", { Str: "genius" }],
        ],
      },
      verdict: "Translated",
    };
  }

  // Analysis patterns
  if (normalized.includes("explain") || normalized.includes("how does") || normalized.includes("what is")) {
    const subject = extractTarget(normalized) ?? input.text;
    return {
      span: {
        type: "operation",
        name: "analyze",
        params: [
          ["subject", { Str: subject }],
          ["mode", { Str: "mechanic" }],
        ],
      },
      verdict: "Translated",
    };
  }

  // Review patterns
  if (normalized.includes("review") || normalized.includes("check")) {
    return {
      span: {
        type: "operation",
        name: "review",
        params: [
          ["target", { Str: "@latest_changes" }],
          ["mode", { Str: "mechanic" }],
        ],
      },
      verdict: "Translated",
    };
  }

  // Refactor patterns
  if (normalized.includes("refactor") || normalized.includes("clean up") || normalized.includes("improve")) {
    const target = extractTarget(normalized) ?? "unknown";
    return {
      span: {
        type: "operation",
        name: "refactor",
        params: [
          ["target", { Str: target }],
          ["mode", { Str: "genius" }],
        ],
      },
      verdict: "Translated",
    };
  }

  // No match - abstain
  return {
    span: { type: "unknown", params: [] },
    verdict: "Abstain",
    abstainReason: "unclear_intent",
    clarification: "I'm not sure what you'd like me to do. Try: 'fix [bug] in [file]', 'add [feature]', 'explain [code]', or 'review changes'",
  };
}

/**
 * Extract a target reference from text (file path, module name, etc.)
 */
function extractTarget(text: string): string | undefined {
  // Look for file paths
  const pathMatch = text.match(/(?:in\s+)?([a-zA-Z0-9_/.-]+\.[a-zA-Z]+)/);
  if (pathMatch) return pathMatch[1];

  // Look for @references
  const refMatch = text.match(/@([a-zA-Z0-9_.]+)/);
  if (refMatch) return `@${refMatch[1]}`;

  // Look for "in X" patterns
  const inMatch = text.match(/\bin\s+(?:the\s+)?([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)?)/);
  if (inMatch) return inMatch[1];

  return undefined;
}
