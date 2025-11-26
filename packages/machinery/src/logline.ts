/**
 * LogLine parser/serializer - wraps Rust napi-bindings
 */

export interface ParsedLogLine {
  type: string;
  name?: string;
  params: Array<[string, LogLineValue]>;
}

export type LogLineValue =
  | { Str: string }
  | { Num: number }
  | { Bool: boolean }
  | { List: LogLineValue[] };

// Native bindings interface (when available)
interface NativeBindings {
  parseLoglineStr: (input: string) => string;
  serializeLoglineJson: (json: string) => string;
}

let native: NativeBindings | null = null;
let nativeLoadAttempted = false;

async function loadNative(): Promise<NativeBindings | null> {
  if (nativeLoadAttempted) return native;
  nativeLoadAttempted = true;

  try {
    // Dynamic import - will fail if not built
    const mod = await import("@ai-coding-team/napi-bindings" as string);
    native = mod as NativeBindings;
    return native;
  } catch {
    console.warn("[machinery] Native bindings not available, using stub implementation");
    return null;
  }
}

/**
 * Parse a LogLine text block into a structured span.
 * Uses Rust parser if available, otherwise falls back to simple JS parser.
 */
export async function parseLogLineAsync(text: string): Promise<ParsedLogLine> {
  const n = await loadNative();
  if (n) {
    const json = n.parseLoglineStr(text);
    return JSON.parse(json);
  }
  return parseLogLineSync(text);
}

/**
 * Synchronous fallback parser (no native bindings)
 */
export function parseLogLine(text: string): ParsedLogLine {
  return parseLogLineSync(text);
}

function parseLogLineSync(text: string): ParsedLogLine {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { type: "unknown", params: [] };
  }

  const header = lines[0];
  const [typePart, namePart] = header.split(":").map((s) => s.trim());
  const type = typePart.toLowerCase();
  const name = namePart || undefined;

  const params: Array<[string, LogLineValue]> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.toUpperCase() === "END") break;
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      params.push([key, { Str: value }]);
    }
  }

  return { type, name, params };
}

/**
 * Serialize a LogLine span back to text format.
 */
export async function serializeLogLineAsync(span: ParsedLogLine): Promise<string> {
  const n = await loadNative();
  if (n) {
    return n.serializeLoglineJson(JSON.stringify(span));
  }
  return serializeLogLineSync(span);
}

/**
 * Synchronous serialization (no native bindings)
 */
export function serializeLogLine(span: ParsedLogLine): string {
  return serializeLogLineSync(span);
}

function serializeLogLineSync(span: ParsedLogLine): string {
  let out = `${span.type.toUpperCase()}:`;
  if (span.name) {
    out += ` ${span.name}`;
  }
  out += "\n";

  for (const [key, value] of span.params) {
    out += `  ${key.toUpperCase()}: ${renderValue(value)}\n`;
  }

  out += "END";
  return out;
}

function renderValue(v: LogLineValue): string {
  if ("Str" in v) return v.Str;
  if ("Num" in v) return String(v.Num);
  if ("Bool" in v) return String(v.Bool);
  if ("List" in v) return `[${v.List.map(renderValue).join(", ")}]`;
  return "";
}
