/**
 * Self-Healing Tool Execution
 * 
 * Implements adaptive retry with parameter adjustment, fallback tools,
 * and circuit breaker patterns for resilient tool execution.
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface HealingStrategy<TParams, TResult> {
  /**
   * Analyze an error and determine if/how to retry
   */
  analyze(error: ToolResult<TResult>["error"], attempt: number): HealingAction<TParams>;
  
  /**
   * Get fallback tool to use if primary fails
   */
  fallbackTool?: Tool<unknown, unknown>;
}

export interface HealingAction<TParams> {
  shouldRetry: boolean;
  adjustedParams?: Partial<TParams>;
  delay?: number;
  useFallback?: boolean;
  reason: string;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    "timeout",
    "rate_limit",
    "connection_error",
    "temporary_failure",
    "server_error",
  ],
};

/**
 * Circuit breaker state
 */
interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

const circuitStates = new Map<string, CircuitState>();

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT = 60000; // 1 minute

/**
 * Check if circuit breaker allows execution
 */
function checkCircuit(toolName: string): boolean {
  const state = circuitStates.get(toolName);
  
  if (!state) {
    return true; // No state = closed circuit
  }
  
  if (state.state === "open") {
    // Check if enough time has passed to try again
    if (Date.now() - state.lastFailure > CIRCUIT_RESET_TIMEOUT) {
      state.state = "half-open";
      return true;
    }
    return false;
  }
  
  return true;
}

/**
 * Record success - reset circuit
 */
function recordSuccess(toolName: string): void {
  const state = circuitStates.get(toolName);
  if (state) {
    state.failures = 0;
    state.state = "closed";
  }
}

/**
 * Record failure - potentially open circuit
 */
function recordFailure(toolName: string): void {
  let state = circuitStates.get(toolName);
  
  if (!state) {
    state = { failures: 0, lastFailure: 0, state: "closed" };
    circuitStates.set(toolName, state);
  }
  
  state.failures++;
  state.lastFailure = Date.now();
  
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.state = "open";
  }
}

/**
 * Execute a tool with self-healing capabilities
 */
export async function executeWithHealing<TParams, TResult>(
  tool: Tool<TParams, TResult>,
  params: TParams,
  ctx: ToolContext,
  strategy?: HealingStrategy<TParams, TResult>,
  config: Partial<RetryConfig> = {}
): Promise<ToolResult<TResult>> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  
  // Check circuit breaker
  if (!checkCircuit(tool.name)) {
    return {
      success: false,
      error: {
        code: "circuit_open",
        message: `Tool ${tool.name} is temporarily disabled due to repeated failures`,
        recoverable: false,
      },
      eventId: crypto.randomUUID(),
    };
  }
  
  let lastResult: ToolResult<TResult> | null = null;
  let currentParams = params;
  let delay = retryConfig.initialDelay;
  
  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    try {
      const result = await tool.execute(currentParams, ctx);
      
      if (result.success) {
        recordSuccess(tool.name);
        return result;
      }
      
      lastResult = result;
      
      // Check if error is retryable
      const errorCode = result.error?.code ?? "";
      const isRetryable = retryConfig.retryableErrors.some(e => 
        errorCode.toLowerCase().includes(e)
      );
      
      if (!isRetryable && !strategy) {
        recordFailure(tool.name);
        return result;
      }
      
      // Apply healing strategy
      if (strategy) {
        const action = strategy.analyze(result.error, attempt);
        
        if (!action.shouldRetry) {
          if (action.useFallback && strategy.fallbackTool) {
            console.log(`[Healing] Using fallback tool for ${tool.name}`);
            return await strategy.fallbackTool.execute(params, ctx) as ToolResult<TResult>;
          }
          recordFailure(tool.name);
          return result;
        }
        
        // Adjust parameters
        if (action.adjustedParams) {
          currentParams = { ...currentParams, ...action.adjustedParams };
          console.log(`[Healing] Adjusted params for ${tool.name}: ${JSON.stringify(action.adjustedParams)}`);
        }
        
        // Use custom delay if provided
        if (action.delay) {
          delay = action.delay;
        }
        
        console.log(`[Healing] Retry ${attempt}/${retryConfig.maxAttempts} for ${tool.name}: ${action.reason}`);
      }
      
      // Wait before retry
      if (attempt < retryConfig.maxAttempts) {
        await sleep(delay);
        delay = Math.min(delay * retryConfig.backoffMultiplier, retryConfig.maxDelay);
      }
      
    } catch (error: any) {
      lastResult = {
        success: false,
        error: {
          code: "execution_error",
          message: error.message,
          recoverable: true,
        },
        eventId: crypto.randomUUID(),
      };
    }
  }
  
  recordFailure(tool.name);
  return lastResult ?? {
    success: false,
    error: {
      code: "max_retries_exceeded",
      message: `Failed after ${retryConfig.maxAttempts} attempts`,
      recoverable: false,
    },
    eventId: crypto.randomUUID(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// BUILT-IN HEALING STRATEGIES
// =============================================================================

/**
 * Healing strategy for file operations
 * - Retries with different paths
 * - Falls back to alternative read methods
 */
export const fileOperationHealing: HealingStrategy<{ path: string }, unknown> = {
  analyze(error, attempt) {
    if (!error) return { shouldRetry: false, reason: "No error" };
    
    const code = error.code ?? "";
    
    // File not found - try common variations
    if (code.includes("not_found") || code.includes("ENOENT")) {
      return {
        shouldRetry: attempt < 2,
        adjustedParams: {
          path: attempt === 1 ? "./src/" : "./",
        },
        reason: "Trying alternative path prefix",
      };
    }
    
    // Permission error - not recoverable
    if (code.includes("permission") || code.includes("EACCES")) {
      return {
        shouldRetry: false,
        reason: "Permission denied - not recoverable",
      };
    }
    
    // Timeout - retry with delay
    if (code.includes("timeout")) {
      return {
        shouldRetry: true,
        delay: 2000 * attempt,
        reason: "Timeout - retrying with longer delay",
      };
    }
    
    return {
      shouldRetry: error.recoverable ?? false,
      reason: "Generic retry",
    };
  },
};

/**
 * Healing strategy for git operations
 * - Handles lock files
 * - Retries after cleanup
 */
export const gitOperationHealing: HealingStrategy<unknown, unknown> = {
  analyze(error, attempt) {
    if (!error) return { shouldRetry: false, reason: "No error" };
    
    const message = error.message ?? "";
    
    // Lock file exists - wait and retry
    if (message.includes(".lock") || message.includes("index.lock")) {
      return {
        shouldRetry: true,
        delay: 3000, // Git operations can take a moment
        reason: "Lock file detected - waiting for release",
      };
    }
    
    // Merge conflict - not automatically recoverable
    if (message.includes("conflict") || message.includes("CONFLICT")) {
      return {
        shouldRetry: false,
        reason: "Merge conflict requires manual resolution",
      };
    }
    
    // Network error - retry with backoff
    if (message.includes("network") || message.includes("fetch")) {
      return {
        shouldRetry: true,
        delay: 2000 * attempt,
        reason: "Network error - retrying",
      };
    }
    
    return {
      shouldRetry: attempt < 2,
      reason: "Generic git retry",
    };
  },
};

/**
 * Healing strategy for test execution
 * - Handles flaky tests
 * - Adjusts test scope on failures
 */
export const testExecutionHealing: HealingStrategy<{ scope?: string; pattern?: string }, unknown> = {
  analyze(error, attempt) {
    if (!error) return { shouldRetry: false, reason: "No error" };
    
    const message = error.message ?? "";
    
    // Timeout - increase timeout or reduce scope
    if (message.includes("timeout") || message.includes("TIMEOUT")) {
      return {
        shouldRetry: true,
        adjustedParams: {
          scope: "affected", // Reduce scope
        },
        delay: 1000,
        reason: "Test timeout - reducing scope",
      };
    }
    
    // Setup/teardown failure - retry
    if (message.includes("setup") || message.includes("teardown") || message.includes("beforeAll")) {
      return {
        shouldRetry: true,
        delay: 2000,
        reason: "Test setup issue - retrying",
      };
    }
    
    // Flaky test indicator - retry
    if (message.includes("flaky") || attempt === 1) {
      return {
        shouldRetry: true,
        delay: 1000,
        reason: "Potential flaky test - retrying",
      };
    }
    
    return {
      shouldRetry: false,
      reason: "Test failure - not retrying",
    };
  },
};

/**
 * Healing strategy for API calls
 * - Handles rate limits
 * - Implements exponential backoff
 */
export const apiCallHealing: HealingStrategy<unknown, unknown> = {
  analyze(error, attempt) {
    if (!error) return { shouldRetry: false, reason: "No error" };
    
    const code = error.code ?? "";
    const message = error.message ?? "";
    
    // Rate limit - wait longer
    if (code.includes("rate_limit") || message.includes("429")) {
      return {
        shouldRetry: true,
        delay: 10000 * attempt, // Longer backoff for rate limits
        reason: "Rate limited - backing off",
      };
    }
    
    // Server error (5xx) - retry
    if (code.includes("500") || code.includes("502") || code.includes("503")) {
      return {
        shouldRetry: true,
        delay: 2000 * attempt,
        reason: "Server error - retrying",
      };
    }
    
    // Network error - retry
    if (message.includes("network") || message.includes("ECONNREFUSED")) {
      return {
        shouldRetry: true,
        delay: 3000,
        reason: "Network error - retrying",
      };
    }
    
    // Client error (4xx) - don't retry
    if (code.includes("400") || code.includes("401") || code.includes("403") || code.includes("404")) {
      return {
        shouldRetry: false,
        reason: "Client error - not retrying",
      };
    }
    
    return {
      shouldRetry: error.recoverable ?? false,
      reason: "Generic API retry",
    };
  },
};

// =============================================================================
// HEALING DECORATOR
// =============================================================================

/**
 * Wrap a tool with self-healing capabilities
 */
export function withHealing<TParams, TResult>(
  tool: Tool<TParams, TResult>,
  strategy?: HealingStrategy<TParams, TResult>,
  config?: Partial<RetryConfig>
): Tool<TParams, TResult> {
  return {
    ...tool,
    name: tool.name,
    description: `${tool.description} (with self-healing)`,
    
    async execute(params: TParams, ctx: ToolContext): Promise<ToolResult<TResult>> {
      return executeWithHealing(tool, params, ctx, strategy, config);
    },
  };
}

