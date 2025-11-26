/**
 * TDLN Machinery - Rust-powered NL↔LogLine translation
 *
 * This package wraps the Rust napi-bindings crate, providing:
 * - LogLine parsing and serialization
 * - TDLN-IN: Natural language → LogLine translation
 * - TDLN-OUT: Structured data → Natural language rendering
 *
 * Async versions (parseLogLineAsync, translateToLogLineAsync, renderToNaturalLanguageAsync)
 * will use native Rust bindings if available.
 *
 * Sync versions use pure JavaScript fallbacks.
 */

export {
  parseLogLine,
  parseLogLineAsync,
  serializeLogLine,
  serializeLogLineAsync,
  type ParsedLogLine,
  type LogLineValue,
} from "./logline";

export {
  translateToLogLine,
  translateToLogLineAsync,
  type TranslateInput,
  type TranslateResult,
} from "./tdln-in";

export {
  renderToNaturalLanguage,
  renderToNaturalLanguageAsync,
  type RenderInput,
  type RenderResult,
} from "./tdln-out";
