/**
 * Event Bus
 * 
 * Pub/sub system for real-time event streaming across the system.
 * Built on PostgreSQL LISTEN/NOTIFY for durability and simplicity.
 */

import { pool } from "./client";
import { EventEmitter } from "events";

// ============================================================================
// TYPES
// ============================================================================

export type EventChannel = 
  | "metrics"        // Metric events from ledger
  | "jobs"           // Job lifecycle events
  | "notifications"  // User notifications
  | "insights"       // Watcher insights
  | "health"         // System health checks
  | "alerts";        // Critical alerts

export interface BusEvent<T = unknown> {
  channel: EventChannel;
  type: string;
  timestamp: string;
  source: string;
  data: T;
  traceId?: string;
  jobId?: string;
}

export type EventHandler<T = unknown> = (event: BusEvent<T>) => void | Promise<void>;

// ============================================================================
// EVENT BUS
// ============================================================================

class EventBus extends EventEmitter {
  private pgClient: any = null;
  private subscriptions = new Map<EventChannel, Set<EventHandler>>();
  private connected = false;
  private reconnecting = false;

  constructor() {
    super();
    this.setMaxListeners(100); // Allow many subscribers
  }

  /**
   * Connect to PostgreSQL for LISTEN/NOTIFY
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      this.pgClient = await pool.connect();
      this.connected = true;

      // Set up notification handler
      this.pgClient.on("notification", (msg: { channel: string; payload?: string }) => {
        this.handleNotification(msg);
      });

      // Handle disconnection
      this.pgClient.on("error", () => {
        this.connected = false;
        this.reconnect();
      });

      // Create notify function
      await this.pgClient.query(`
        CREATE OR REPLACE FUNCTION bus_notify(channel TEXT, payload JSONB)
        RETURNS void AS $$
        BEGIN
          PERFORM pg_notify(channel, payload::text);
        END;
        $$ LANGUAGE plpgsql;
      `);

      console.log("[EventBus] Connected to PostgreSQL");
    } catch (error) {
      console.error("[EventBus] Connection failed:", error);
      this.reconnect();
    }
  }

  /**
   * Reconnect on disconnection
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    const maxAttempts = 10;
    let attempts = 0;

    while (attempts < maxAttempts && !this.connected) {
      attempts++;
      console.log(`[EventBus] Reconnect attempt ${attempts}/${maxAttempts}`);
      
      await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempts), 30000)));
      
      try {
        await this.connect();
      } catch {
        // Continue trying
      }
    }

    this.reconnecting = false;
    
    if (!this.connected) {
      console.error("[EventBus] Failed to reconnect after", maxAttempts, "attempts");
    }
  }

  /**
   * Handle incoming PostgreSQL notification
   */
  private handleNotification(msg: { channel: string; payload?: string }): void {
    if (!msg.payload) return;

    try {
      const event: BusEvent = JSON.parse(msg.payload);
      event.channel = msg.channel as EventChannel;
      
      // Emit to local subscribers
      this.emit(msg.channel, event);
      this.emit("*", event); // Wildcard for all events

      // Call registered handlers
      const handlers = this.subscriptions.get(msg.channel as EventChannel);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (e) {
            console.error("[EventBus] Handler error:", e);
          }
        }
      }
    } catch (e) {
      console.error("[EventBus] Failed to parse notification:", e);
    }
  }

  /**
   * Subscribe to a channel
   */
  async subscribe<T = unknown>(channel: EventChannel, handler: EventHandler<T>): Promise<() => void> {
    await this.connect();

    // Subscribe to PostgreSQL channel
    if (!this.subscriptions.has(channel)) {
      await this.pgClient?.query(`LISTEN ${channel}`);
      this.subscriptions.set(channel, new Set());
    }

    this.subscriptions.get(channel)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      const handlers = this.subscriptions.get(channel);
      if (handlers) {
        handlers.delete(handler as EventHandler);
        if (handlers.size === 0) {
          this.pgClient?.query(`UNLISTEN ${channel}`);
          this.subscriptions.delete(channel);
        }
      }
    };
  }

  /**
   * Publish an event to a channel
   */
  async publish<T = unknown>(
    channel: EventChannel,
    type: string,
    data: T,
    options: { source?: string; traceId?: string; jobId?: string } = {}
  ): Promise<void> {
    await this.connect();

    const event: BusEvent<T> = {
      channel,
      type,
      timestamp: new Date().toISOString(),
      source: options.source ?? "unknown",
      data,
      traceId: options.traceId,
      jobId: options.jobId,
    };

    await this.pgClient?.query(
      `SELECT bus_notify($1, $2::jsonb)`,
      [channel, JSON.stringify(event)]
    );

    // Also emit locally
    this.emit(channel, event);
    this.emit("*", event);
  }

  /**
   * Disconnect from PostgreSQL
   */
  async disconnect(): Promise<void> {
    if (this.pgClient) {
      for (const channel of this.subscriptions.keys()) {
        await this.pgClient.query(`UNLISTEN ${channel}`);
      }
      this.pgClient.release();
      this.pgClient = null;
    }
    this.connected = false;
    this.subscriptions.clear();
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let busInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!busInstance) {
    busInstance = new EventBus();
  }
  return busInstance;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Publish a job event
 */
export async function publishJobEvent(
  type: "created" | "started" | "completed" | "failed" | "cancelled" | "escalated",
  jobId: string,
  data: Record<string, unknown>
): Promise<void> {
  await getEventBus().publish("jobs", type, { jobId, ...data }, { jobId });
}

/**
 * Publish a metric event
 */
export async function publishMetricEvent(
  type: string,
  value: number,
  labels: Record<string, string> = {}
): Promise<void> {
  await getEventBus().publish("metrics", type, { value, labels }, { source: "metrics" });
}

/**
 * Publish a notification
 */
export async function publishNotification(
  type: string,
  message: string,
  data: Record<string, unknown> = {},
  projectId?: string
): Promise<void> {
  await getEventBus().publish("notifications", type, { message, projectId, ...data });
}

/**
 * Publish an insight
 */
export async function publishInsight(
  category: string,
  summary: string,
  confidence: number,
  data: Record<string, unknown> = {}
): Promise<void> {
  await getEventBus().publish("insights", category, { summary, confidence, ...data });
}

/**
 * Publish a health check result
 */
export async function publishHealthCheck(
  component: string,
  healthy: boolean,
  details: Record<string, unknown> = {}
): Promise<void> {
  await getEventBus().publish("health", "check", { component, healthy, ...details });
}

/**
 * Publish a critical alert
 */
export async function publishAlert(
  severity: "warning" | "error" | "critical",
  message: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await getEventBus().publish("alerts", severity, { message, ...data });
}

// ============================================================================
// METRIC AGGREGATOR
// ============================================================================

interface AggregatedMetric {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  lastValue: number;
  lastUpdate: number;
}

class MetricAggregator {
  private metrics = new Map<string, AggregatedMetric>();
  private flushInterval: NodeJS.Timeout | null = null;
  private flushCallback: ((metrics: Map<string, AggregatedMetric>) => void) | null = null;

  /**
   * Record a metric value
   */
  record(name: string, value: number): void {
    const existing = this.metrics.get(name);
    
    if (existing) {
      existing.count++;
      existing.sum += value;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
      existing.avg = existing.sum / existing.count;
      existing.lastValue = value;
      existing.lastUpdate = Date.now();
    } else {
      this.metrics.set(name, {
        count: 1,
        sum: value,
        min: value,
        max: value,
        avg: value,
        lastValue: value,
        lastUpdate: Date.now(),
      });
    }
  }

  /**
   * Start periodic flushing
   */
  startFlush(intervalMs: number, callback: (metrics: Map<string, AggregatedMetric>) => void): void {
    this.flushCallback = callback;
    this.flushInterval = setInterval(() => {
      if (this.flushCallback && this.metrics.size > 0) {
        this.flushCallback(new Map(this.metrics));
        this.metrics.clear();
      }
    }, intervalMs);
  }

  /**
   * Stop flushing
   */
  stopFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): Map<string, AggregatedMetric> {
    return new Map(this.metrics);
  }
}

let aggregatorInstance: MetricAggregator | null = null;

export function getMetricAggregator(): MetricAggregator {
  if (!aggregatorInstance) {
    aggregatorInstance = new MetricAggregator();
  }
  return aggregatorInstance;
}

