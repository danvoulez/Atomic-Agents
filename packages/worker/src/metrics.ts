/**
 * Worker Metrics
 * 
 * Comprehensive metrics recording for the worker process.
 * Integrates with the event bus for real-time streaming.
 */

import { 
  publishMetricEvent, 
  publishHealthCheck,
  getMetricAggregator,
} from "@ai-coding-team/db";
import { getLogger, logMetric } from "./logger";

const logger = getLogger().child({ component: "metrics" });
const aggregator = getMetricAggregator();

// ============================================================================
// METRIC NAMES
// ============================================================================

export const METRICS = {
  // Job metrics
  JOB_CLAIMED: "job.claimed",
  JOB_COMPLETED: "job.completed",
  JOB_FAILED: "job.failed",
  JOB_DURATION: "job.duration_ms",
  
  // Step metrics
  STEPS_USED: "steps.used",
  STEPS_REMAINING: "steps.remaining",
  
  // Token metrics
  TOKENS_USED: "tokens.used",
  TOKENS_PROMPT: "tokens.prompt",
  TOKENS_COMPLETION: "tokens.completion",
  
  // Tool metrics
  TOOL_CALL: "tool.call",
  TOOL_SUCCESS: "tool.success",
  TOOL_FAILURE: "tool.failure",
  TOOL_DURATION: "tool.duration_ms",
  
  // LLM metrics
  LLM_REQUEST: "llm.request",
  LLM_SUCCESS: "llm.success",
  LLM_FAILURE: "llm.failure",
  LLM_LATENCY: "llm.latency_ms",
  LLM_TOKENS: "llm.tokens",
  
  // Queue metrics
  QUEUE_DEPTH: "queue.depth",
  QUEUE_WAIT_TIME: "queue.wait_time_ms",
  
  // Worker metrics
  WORKER_HEARTBEAT: "worker.heartbeat",
  WORKER_IDLE: "worker.idle",
  WORKER_BUSY: "worker.busy",
  
  // Error metrics
  ERROR_TOTAL: "error.total",
  ERROR_RECOVERABLE: "error.recoverable",
  ERROR_FATAL: "error.fatal",
  
  // Escalation metrics
  ESCALATION_TOTAL: "escalation.total",
} as const;

// ============================================================================
// RECORDING FUNCTIONS
// ============================================================================

/**
 * Record a metric value
 */
export function recordMetric(
  name: string, 
  value: number,
  labels: Record<string, string> = {}
): void {
  // Log locally
  logger.debug("Metric recorded", { metric: name, value, labels });
  
  // Aggregate for batching
  aggregator.record(name, value);
  
  // Log to CloudWatch Embedded Metric Format
  logMetric(name, value, "Count", labels);
  
  // Publish to event bus (fire and forget)
  publishMetricEvent(name, value, labels).catch(() => {
    // Ignore errors
  });
}

/**
 * Record a duration metric
 */
export function recordDuration(
  name: string,
  startTime: number,
  labels: Record<string, string> = {}
): number {
  const duration = Date.now() - startTime;
  logMetric(name, duration, "Milliseconds", labels);
  aggregator.record(name, duration);
  return duration;
}

/**
 * Record job claimed
 */
export function recordJobClaimed(jobId: string, mode: string): void {
  recordMetric(METRICS.JOB_CLAIMED, 1, { job_id: jobId, mode });
}

/**
 * Record job completed
 */
export function recordJobCompleted(
  jobId: string,
  mode: string,
  durationMs: number,
  stepsUsed: number,
  tokensUsed: number
): void {
  recordMetric(METRICS.JOB_COMPLETED, 1, { job_id: jobId, mode });
  recordMetric(METRICS.JOB_DURATION, durationMs, { mode });
  recordMetric(METRICS.STEPS_USED, stepsUsed, { job_id: jobId, mode });
  recordMetric(METRICS.TOKENS_USED, tokensUsed, { job_id: jobId, mode });
}

/**
 * Record job failed
 */
export function recordJobFailed(jobId: string, mode: string, errorCode: string): void {
  recordMetric(METRICS.JOB_FAILED, 1, { job_id: jobId, mode, error_code: errorCode });
  recordMetric(METRICS.ERROR_TOTAL, 1, { type: "job_failure", error_code: errorCode });
}

/**
 * Record tool execution
 */
export function recordToolExecution(
  toolName: string,
  success: boolean,
  durationMs: number,
  labels: Record<string, string> = {}
): void {
  recordMetric(METRICS.TOOL_CALL, 1, { tool: toolName, ...labels });
  
  if (success) {
    recordMetric(METRICS.TOOL_SUCCESS, 1, { tool: toolName, ...labels });
  } else {
    recordMetric(METRICS.TOOL_FAILURE, 1, { tool: toolName, ...labels });
  }
  
  recordMetric(METRICS.TOOL_DURATION, durationMs, { tool: toolName, ...labels });
}

/**
 * Record LLM call
 */
export function recordLLMCall(
  model: string,
  success: boolean,
  latencyMs: number,
  promptTokens: number,
  completionTokens: number
): void {
  recordMetric(METRICS.LLM_REQUEST, 1, { model });
  
  if (success) {
    recordMetric(METRICS.LLM_SUCCESS, 1, { model });
  } else {
    recordMetric(METRICS.LLM_FAILURE, 1, { model });
  }
  
  recordMetric(METRICS.LLM_LATENCY, latencyMs, { model });
  recordMetric(METRICS.LLM_TOKENS, promptTokens + completionTokens, { model, type: "total" });
  recordMetric(METRICS.TOKENS_PROMPT, promptTokens, { model });
  recordMetric(METRICS.TOKENS_COMPLETION, completionTokens, { model });
}

/**
 * Record escalation
 */
export function recordEscalation(jobId: string, reason: string): void {
  recordMetric(METRICS.ESCALATION_TOTAL, 1, { job_id: jobId, reason });
}

/**
 * Record error
 */
export function recordError(type: string, recoverable: boolean, code: string): void {
  recordMetric(METRICS.ERROR_TOTAL, 1, { type, error_code: code });
  
  if (recoverable) {
    recordMetric(METRICS.ERROR_RECOVERABLE, 1, { type, error_code: code });
  } else {
    recordMetric(METRICS.ERROR_FATAL, 1, { type, error_code: code });
  }
}

/**
 * Record worker heartbeat
 */
export function recordWorkerHeartbeat(workerId: string, mode: string): void {
  recordMetric(METRICS.WORKER_HEARTBEAT, 1, { worker_id: workerId, mode });
}

/**
 * Record queue depth
 */
export function recordQueueDepth(mode: string, depth: number): void {
  recordMetric(METRICS.QUEUE_DEPTH, depth, { mode });
}

// ============================================================================
// HEALTH CHECKS
// ============================================================================

/**
 * Report worker health
 */
export async function reportWorkerHealth(
  workerId: string,
  healthy: boolean,
  details: Record<string, unknown> = {}
): Promise<void> {
  await publishHealthCheck(`worker-${workerId}`, healthy, {
    workerId,
    timestamp: Date.now(),
    ...details,
  });
}

// ============================================================================
// PROMETHEUS EXPORTER
// ============================================================================

/**
 * Export metrics in Prometheus format
 */
export function exportPrometheusMetrics(): string {
  const snapshot = aggregator.getSnapshot();
  const lines: string[] = [];
  
  for (const [name, metric] of snapshot) {
    const safeName = name.replace(/\./g, "_");
    
    lines.push(`# HELP ${safeName} Metric: ${name}`);
    lines.push(`# TYPE ${safeName} gauge`);
    lines.push(`${safeName}_count ${metric.count}`);
    lines.push(`${safeName}_sum ${metric.sum}`);
    lines.push(`${safeName}_min ${metric.min}`);
    lines.push(`${safeName}_max ${metric.max}`);
    lines.push(`${safeName}_avg ${metric.avg}`);
    lines.push(`${safeName}_last ${metric.lastValue}`);
    lines.push("");
  }
  
  return lines.join("\n");
}

// ============================================================================
// CLOUDWATCH EXPORTER
// ============================================================================

/**
 * Flush metrics to CloudWatch
 */
export async function flushToCloudWatch(): Promise<void> {
  const snapshot = aggregator.getSnapshot();
  
  if (snapshot.size === 0) {
    return;
  }
  
  // In production, would use AWS SDK
  // await cloudWatch.putMetricData({
  //   Namespace: "AICodeTeam",
  //   MetricData: Array.from(snapshot.entries()).map(([name, metric]) => ({
  //     MetricName: name,
  //     Value: metric.lastValue,
  //     Unit: name.includes("duration") || name.includes("latency") ? "Milliseconds" : "Count",
  //     Timestamp: new Date(),
  //   })),
  // });
  
  logger.debug("Flushed metrics to CloudWatch", { count: snapshot.size });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let flushInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic metric flushing
 */
export function startMetricsFlushing(intervalMs = 60000): void {
  if (flushInterval) {
    return;
  }
  
  flushInterval = setInterval(async () => {
    try {
      await flushToCloudWatch();
    } catch (e) {
      logger.error("Failed to flush metrics", e instanceof Error ? e : undefined);
    }
  }, intervalMs);
  
  logger.info("Metrics flushing started", { intervalMs });
}

/**
 * Stop metric flushing
 */
export function stopMetricsFlushing(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
    logger.info("Metrics flushing stopped");
  }
}
