/**
 * Structured JSON Logger
 * 
 * Provides structured logging with:
 * - JSON format for CloudWatch/ELK
 * - Log levels
 * - Context propagation (traceId, jobId)
 * - Automatic redaction of sensitive data
 */

// ============================================================================
// TYPES
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  traceId?: string;
  jobId?: string;
  agentType?: string;
  component?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// Sensitive fields to redact
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /private/i,
];

// ============================================================================
// LOGGER CLASS
// ============================================================================

class StructuredLogger {
  private level: LogLevel = "info";
  private defaultContext: LogContext = {};
  private output: (entry: LogEntry) => void;

  constructor() {
    // Default: output to stdout as JSON
    this.output = (entry) => {
      console.log(JSON.stringify(entry));
    };

    // Set level from environment
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel && envLevel in LOG_LEVELS) {
      this.level = envLevel as LogLevel;
    }
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Set default context (added to all logs)
   */
  setDefaultContext(context: LogContext): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  /**
   * Set custom output handler
   */
  setOutput(handler: (entry: LogEntry) => void): void {
    this.output = handler;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Log at specified level
   */
  log(level: LogLevel, message: string, context: LogContext = {}, error?: Error): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.redact({ ...this.defaultContext, ...context }),
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: level === "debug" ? error.stack : undefined,
      };
    }

    this.output(entry);
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.log("error", message, context, error);
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    this.log("fatal", message, context, error);
  }

  /**
   * Redact sensitive data from context
   */
  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Check if key matches sensitive pattern
      const isSensitive = SENSITIVE_PATTERNS.some(p => p.test(key));

      if (isSensitive) {
        result[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.redact(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

/**
 * Child logger with inherited context
 */
class ChildLogger {
  private parent: StructuredLogger;
  private context: LogContext;

  constructor(parent: StructuredLogger, context: LogContext) {
    this.parent = parent;
    this.context = context;
  }

  child(context: LogContext): ChildLogger {
    return new ChildLogger(this.parent, { ...this.context, ...context });
  }

  log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    this.parent.log(level, message, { ...this.context, ...context }, error);
  }

  debug(message: string, context?: LogContext): void {
    this.parent.log("debug", message, { ...this.context, ...context });
  }

  info(message: string, context?: LogContext): void {
    this.parent.log("info", message, { ...this.context, ...context });
  }

  warn(message: string, context?: LogContext): void {
    this.parent.log("warn", message, { ...this.context, ...context });
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.parent.log("error", message, { ...this.context, ...context }, error);
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    this.parent.log("fatal", message, { ...this.context, ...context }, error);
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let loggerInstance: StructuredLogger | null = null;

export function getLogger(): StructuredLogger {
  if (!loggerInstance) {
    loggerInstance = new StructuredLogger();
  }
  return loggerInstance;
}

// ============================================================================
// REQUEST LOGGER MIDDLEWARE
// ============================================================================

export interface RequestLogContext extends LogContext {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userAgent?: string;
  ip?: string;
  requestId?: string;
}

/**
 * Create request logging middleware for Express/Next.js
 */
export function createRequestLogger() {
  const logger = getLogger().child({ component: "http" });

  return (req: any, res: any, next: () => void) => {
    const start = Date.now();
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();

    // Add request ID to response
    res.setHeader("x-request-id", requestId);

    // Log on response finish
    res.on("finish", () => {
      const duration = Date.now() - start;
      const context: RequestLogContext = {
        method: req.method,
        path: req.path || req.url,
        statusCode: res.statusCode,
        durationMs: duration,
        userAgent: req.headers["user-agent"],
        ip: req.ip || req.connection?.remoteAddress,
        requestId,
      };

      const level: LogLevel = 
        res.statusCode >= 500 ? "error" :
        res.statusCode >= 400 ? "warn" :
        "info";

      logger.log(level, `${req.method} ${req.path || req.url} ${res.statusCode}`, context);
    });

    next();
  };
}

// ============================================================================
// CLOUDWATCH EXPORTER
// ============================================================================

interface CloudWatchConfig {
  logGroupName: string;
  logStreamName: string;
  region: string;
}

/**
 * Set up CloudWatch log export
 */
export function setupCloudWatchExport(config: CloudWatchConfig): void {
  const logger = getLogger();
  const buffer: LogEntry[] = [];
  const flushInterval = 5000; // 5 seconds

  // Buffer logs and flush periodically
  logger.setOutput((entry) => {
    // Also log to console in development
    if (process.env.NODE_ENV !== "production") {
      console.log(JSON.stringify(entry));
    }

    buffer.push(entry);
  });

  // Flush buffer periodically
  setInterval(async () => {
    if (buffer.length === 0) return;

    const entries = buffer.splice(0, buffer.length);
    
    // In production, would send to CloudWatch
    // For now, just batch log
    if (process.env.AWS_REGION) {
      try {
        // Would use @aws-sdk/client-cloudwatch-logs here
        // await cloudWatchLogs.putLogEvents({
        //   logGroupName: config.logGroupName,
        //   logStreamName: config.logStreamName,
        //   logEvents: entries.map(e => ({
        //     timestamp: new Date(e.timestamp).getTime(),
        //     message: JSON.stringify(e),
        //   })),
        // });
      } catch (e) {
        console.error("Failed to send logs to CloudWatch:", e);
      }
    }
  }, flushInterval);
}

// ============================================================================
// METRIC LOGGING
// ============================================================================

/**
 * Log a metric value (for CloudWatch Metrics via Logs)
 */
export function logMetric(
  name: string,
  value: number,
  unit: "Count" | "Milliseconds" | "Bytes" | "Percent" = "Count",
  dimensions: Record<string, string> = {}
): void {
  const logger = getLogger();
  
  // CloudWatch Embedded Metric Format
  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "AICodeTeam",
        Dimensions: [Object.keys(dimensions)],
        Metrics: [{ Name: name, Unit: unit }],
      }],
    },
    [name]: value,
    ...dimensions,
  };

  logger.info(`METRIC ${name}=${value}`, { emf });
}

