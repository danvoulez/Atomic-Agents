/**
 * Error Boundaries and Global Error Handling
 * 
 * Provides:
 * - Unhandled rejection handling
 * - Uncaught exception handling
 * - Graceful degradation
 * - Error reporting
 */

import { getLogger } from "./logger";
import { publishAlert } from "@ai-coding-team/db";

const logger = getLogger().child({ component: "error-boundary" });

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface ErrorReport {
  id: string;
  timestamp: string;
  type: "uncaught" | "unhandled_rejection" | "operational" | "programmer";
  message: string;
  stack?: string;
  context: Record<string, unknown>;
  severity: "warning" | "error" | "critical";
}

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

/**
 * Operational errors are expected errors that can be handled
 */
export class OperationalError extends Error {
  public readonly isOperational = true;
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode = 500,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "OperationalError";
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Check if error is operational (expected) vs programmer error (bug)
 */
export function isOperationalError(error: Error): error is OperationalError {
  return error instanceof OperationalError;
}

// ============================================================================
// ERROR HANDLERS
// ============================================================================

let shutdownInProgress = false;

/**
 * Handle uncaught exceptions
 */
function handleUncaughtException(error: Error): void {
  logger.fatal("Uncaught exception", error, {
    type: "uncaught_exception",
  });

  const report = createErrorReport(error, "uncaught");
  reportError(report);

  // If it's not an operational error, we should restart
  if (!isOperationalError(error)) {
    gracefulShutdown("uncaught_exception");
  }
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection(reason: unknown): void {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  
  logger.error("Unhandled promise rejection", error, {
    type: "unhandled_rejection",
  });

  const report = createErrorReport(error, "unhandled_rejection");
  reportError(report);
}

/**
 * Create error report
 */
function createErrorReport(
  error: Error,
  type: ErrorReport["type"]
): ErrorReport {
  const severity: ErrorReport["severity"] = 
    type === "uncaught" ? "critical" :
    type === "unhandled_rejection" ? "error" :
    isOperationalError(error) ? "warning" :
    "error";

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    message: error.message,
    stack: error.stack,
    context: isOperationalError(error) ? error.context : {},
    severity,
  };
}

/**
 * Report error (to event bus, logs, external services)
 */
async function reportError(report: ErrorReport): Promise<void> {
  try {
    // Publish to event bus for real-time monitoring
    await publishAlert(report.severity, report.message, {
      errorId: report.id,
      type: report.type,
      stack: report.stack?.slice(0, 1000),
      context: report.context,
    });
  } catch (e) {
    // Don't let reporting errors cause more problems
    console.error("Failed to report error:", e);
  }
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(reason: string): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  logger.info("Initiating graceful shutdown", { reason });

  try {
    // Give time for in-flight requests to complete
    await new Promise(r => setTimeout(r, 5000));

    // Exit with error code
    process.exit(1);
  } catch {
    process.exit(1);
  }
}

// ============================================================================
// SETUP
// ============================================================================

let initialized = false;

/**
 * Check if running in a test environment
 */
function isTestEnvironment(): boolean {
  return Boolean(
    process.env.VITEST || 
    process.env.JEST_WORKER_ID ||
    process.env.NODE_ENV === "test" ||
    (typeof globalThis !== 'undefined' && (globalThis as any).__vitest_index__)
  );
}

/**
 * Initialize global error handlers
 */
export function setupErrorBoundary(): void {
  if (initialized) return;
  initialized = true;

  // Only set up handlers in non-test environments
  if (isTestEnvironment()) {
    logger.debug("Error boundary disabled in test environment");
    return;
  }

  process.on("uncaughtException", handleUncaughtException);
  process.on("unhandledRejection", handleUnhandledRejection);

  // Graceful shutdown on signals
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  logger.info("Error boundary initialized");
}

// ============================================================================
// SAFE EXECUTION WRAPPER
// ============================================================================

export interface SafeExecutionResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

/**
 * Safely execute a function with error handling
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context: Record<string, unknown> = {}
): Promise<SafeExecutionResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    
    logger.error("Safe execution failed", err, context);
    
    if (!isOperationalError(err)) {
      const report = createErrorReport(err, "programmer");
      await reportError(report);
    }
    
    return { success: false, error: err };
  }
}

/**
 * Wrap async function with error boundary
 */
export function withErrorBoundary<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: Record<string, unknown> = {}
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      logger.error("Error in wrapped function", err, {
        ...context,
        functionName: fn.name,
      });
      
      throw err;
    }
  }) as T;
}

// ============================================================================
// RETRY WITH CIRCUIT BREAKER
// ============================================================================

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

const circuits = new Map<string, CircuitBreakerState>();

const CIRCUIT_CONFIG = {
  failureThreshold: 5,
  recoveryTimeout: 60000, // 1 minute
  halfOpenRequests: 1,
};

/**
 * Execute with circuit breaker pattern
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  let circuit = circuits.get(name);
  
  if (!circuit) {
    circuit = { failures: 0, lastFailure: 0, state: "closed" };
    circuits.set(name, circuit);
  }

  // Check if circuit is open
  if (circuit.state === "open") {
    if (Date.now() - circuit.lastFailure > CIRCUIT_CONFIG.recoveryTimeout) {
      circuit.state = "half-open";
      logger.info("Circuit half-open", { circuit: name });
    } else if (fallback) {
      return fallback();
    } else {
      throw new OperationalError(
        `Circuit ${name} is open`,
        "CIRCUIT_OPEN",
        503
      );
    }
  }

  try {
    const result = await fn();
    
    // Success - reset circuit
    if (circuit.state === "half-open") {
      circuit.state = "closed";
      logger.info("Circuit closed", { circuit: name });
    }
    circuit.failures = 0;
    
    return result;
  } catch (error) {
    circuit.failures++;
    circuit.lastFailure = Date.now();
    
    if (circuit.failures >= CIRCUIT_CONFIG.failureThreshold) {
      circuit.state = "open";
      logger.warn("Circuit opened", { 
        circuit: name, 
        failures: circuit.failures 
      });
    }
    
    if (fallback && circuit.state === "open") {
      return fallback();
    }
    
    throw error;
  }
}

