/**
 * OpenTelemetry Tracing Integration
 * 
 * Provides standardized distributed tracing for agent operations.
 * Integrates with observability platforms like Jaeger, Zipkin, Grafana.
 */

// Types for OpenTelemetry (optional dependency)
interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(error: Error): void;
  end(): void;
}

interface Tracer {
  startSpan(name: string, options?: { kind?: number; attributes?: Record<string, unknown> }): Span;
}

interface Context {
  active(): unknown;
  with<T>(context: unknown, fn: () => T): T;
}

// Try to load OpenTelemetry - gracefully fail if not installed
let trace: { getTracer(name: string): Tracer } | null = null;
let context: Context | null = null;
let SpanKind: { INTERNAL: number; CLIENT: number; SERVER: number } | null = null;
let SpanStatusCode: { OK: number; ERROR: number } | null = null;

async function initOtel(): Promise<boolean> {
  try {
    const api = await import("@opentelemetry/api");
    trace = api.trace;
    context = api.context;
    SpanKind = api.SpanKind;
    SpanStatusCode = api.SpanStatusCode;
    return true;
  } catch {
    console.log("[Tracing] OpenTelemetry not installed - using no-op tracer");
    return false;
  }
}

// Initialize on load
let otelInitialized = false;
const initPromise = initOtel().then(result => {
  otelInitialized = result;
});

/**
 * No-op span for when OpenTelemetry is not available
 */
class NoOpSpan implements Span {
  setAttribute(): void {}
  setStatus(): void {}
  recordException(): void {}
  end(): void {}
}

/**
 * No-op tracer for when OpenTelemetry is not available
 */
class NoOpTracer implements Tracer {
  startSpan(): Span {
    return new NoOpSpan();
  }
}

const noOpTracer = new NoOpTracer();

/**
 * Get a tracer for the AI Coding Team
 */
export function getTracer(): Tracer {
  if (!otelInitialized || !trace) {
    return noOpTracer;
  }
  return trace.getTracer("ai-coding-team");
}

/**
 * Span attributes for agent operations
 */
export interface AgentSpanAttributes {
  "agent.type": string;
  "agent.mode": "mechanic" | "genius";
  "job.id": string;
  "job.goal"?: string;
  "trace.id": string;
  "tool.name"?: string;
  "tool.category"?: string;
  "budget.steps_used"?: number;
  "budget.steps_cap"?: number;
  "budget.tokens_used"?: number;
  "budget.tokens_cap"?: number;
}

/**
 * Trace an agent job execution
 */
export async function traceJob<T>(
  jobId: string,
  traceId: string,
  agentType: string,
  mode: "mechanic" | "genius",
  goal: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  await initPromise; // Ensure OTel is initialized
  
  const tracer = getTracer();
  const span = tracer.startSpan(`job.${agentType}`, {
    kind: SpanKind?.INTERNAL ?? 0,
    attributes: {
      "agent.type": agentType,
      "agent.mode": mode,
      "job.id": jobId,
      "job.goal": goal.slice(0, 100),
      "trace.id": traceId,
    },
  });

  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode?.OK ?? 1 });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode?.ERROR ?? 2,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace a tool execution
 */
export async function traceTool<T>(
  toolName: string,
  category: string,
  jobId: string,
  traceId: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  await initPromise;
  
  const tracer = getTracer();
  const span = tracer.startSpan(`tool.${toolName}`, {
    kind: SpanKind?.CLIENT ?? 2, // Tool calls are like client calls
    attributes: {
      "tool.name": toolName,
      "tool.category": category,
      "job.id": jobId,
      "trace.id": traceId,
    },
  });

  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode?.OK ?? 1 });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode?.ERROR ?? 2,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trace an LLM call
 */
export async function traceLLM<T>(
  model: string,
  jobId: string,
  traceId: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  await initPromise;
  
  const tracer = getTracer();
  const span = tracer.startSpan("llm.chat", {
    kind: SpanKind?.CLIENT ?? 2,
    attributes: {
      "llm.model": model,
      "job.id": jobId,
      "trace.id": traceId,
    },
  });

  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode?.OK ?? 1 });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode?.ERROR ?? 2,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add custom attributes to the current span
 */
export function addSpanAttributes(span: Span, attributes: Record<string, string | number | boolean>): void {
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}

/**
 * Record token usage in span
 */
export function recordTokenUsage(span: Span, promptTokens: number, completionTokens: number): void {
  span.setAttribute("llm.prompt_tokens", promptTokens);
  span.setAttribute("llm.completion_tokens", completionTokens);
  span.setAttribute("llm.total_tokens", promptTokens + completionTokens);
}

/**
 * Record budget usage in span
 */
export function recordBudgetUsage(
  span: Span,
  stepsUsed: number,
  stepsCap: number,
  tokensUsed: number,
  tokensCap: number
): void {
  span.setAttribute("budget.steps_used", stepsUsed);
  span.setAttribute("budget.steps_cap", stepsCap);
  span.setAttribute("budget.steps_remaining", stepsCap - stepsUsed);
  span.setAttribute("budget.tokens_used", tokensUsed);
  span.setAttribute("budget.tokens_cap", tokensCap);
  span.setAttribute("budget.tokens_remaining", tokensCap - tokensUsed);
}

/**
 * Initialize OpenTelemetry with console exporter (for development)
 */
export async function setupConsoleTracing(): Promise<void> {
  try {
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { SimpleSpanProcessor, ConsoleSpanExporter } = await import("@opentelemetry/sdk-trace-base");
    const { Resource } = await import("@opentelemetry/resources");
    const { SEMRESATTRS_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: "ai-coding-team",
      }),
    });

    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    provider.register();

    console.log("[Tracing] Console tracing enabled");
  } catch {
    console.log("[Tracing] Could not setup console tracing - dependencies not installed");
  }
}

/**
 * Initialize OpenTelemetry with OTLP exporter (for production)
 */
export async function setupOTLPTracing(endpoint: string): Promise<void> {
  try {
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");
    const { SEMRESATTRS_SERVICE_NAME } = await import("@opentelemetry/semantic-conventions");

    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: "ai-coding-team",
      }),
    });

    const exporter = new OTLPTraceExporter({
      url: endpoint,
    });

    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider.register();

    console.log(`[Tracing] OTLP tracing enabled, exporting to ${endpoint}`);
  } catch (error) {
    console.log("[Tracing] Could not setup OTLP tracing:", error);
  }
}

