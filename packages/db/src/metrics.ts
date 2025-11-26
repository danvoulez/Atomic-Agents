/**
 * Metrics Collector
 * 
 * Comprehensive metrics collection from the append-only ledger.
 * Provides real-time and aggregated statistics about everything.
 */

import { pool } from "./client";

// ============================================================================
// METRIC TYPES
// ============================================================================

export interface JobMetrics {
  total: number;
  byStatus: Record<string, number>;
  byMode: Record<string, number>;
  avgDurationMs: number;
  avgSteps: number;
  avgTokens: number;
  successRate: number;
  escalationRate: number;
}

export interface AgentMetrics {
  totalEvents: number;
  byAgent: Record<string, number>;
  toolCalls: Record<string, number>;
  avgToolLatencyMs: Record<string, number>;
  errorRate: number;
  topErrors: { error: string; count: number }[];
}

export interface BudgetMetrics {
  totalTokensUsed: number;
  totalStepsUsed: number;
  avgTokensPerJob: number;
  avgStepsPerJob: number;
  budgetExceededCount: number;
  tokensByAgent: Record<string, number>;
}

export interface ConversationMetrics {
  totalConversations: number;
  totalMessages: number;
  avgMessagesPerConversation: number;
  messagesByRole: Record<string, number>;
}

export interface SystemMetrics {
  ledgerEntries: number;
  entriesByKind: Record<string, number>;
  entriesLast24h: number;
  entriesLastHour: number;
  storageEstimateBytes: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

export interface InsightsMetrics {
  totalInsights: number;
  byCategory: Record<string, number>;
  avgConfidence: number;
  actionedCount: number;
}

export interface FullMetrics {
  timestamp: string;
  jobs: JobMetrics;
  agents: AgentMetrics;
  budget: BudgetMetrics;
  conversations: ConversationMetrics;
  system: SystemMetrics;
  insights: InsightsMetrics;
  timeseries: TimeseriesPoint[];
}

export interface TimeseriesPoint {
  timestamp: string;
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  tokensUsed: number;
  escalations: number;
}

// ============================================================================
// METRIC COLLECTORS
// ============================================================================

interface StatusRow { status: string; count: string }
interface ModeRow { mode: string; count: string }
interface AggRow { 
  total_jobs?: string; 
  avg_duration_ms?: string; 
  avg_steps?: string; 
  avg_tokens?: string;
  success_rate?: string;
  escalation_rate?: string;
}
interface AgentRow { agent: string; count: string }
interface ToolRow { tool: string; count: string; avg_latency?: string }
interface ErrorRow { error: string; count: string }
interface TotalsRow { total?: string; error_rate?: string }
interface BudgetRow { 
  total_tokens?: string; 
  total_steps?: string; 
  avg_tokens?: string; 
  avg_steps?: string;
  budget_exceeded?: string;
}
interface TokensByAgentRow { agent: string; tokens: string }
interface ConvRow { 
  total_conversations?: string; 
  total_messages?: string; 
  avg_messages?: string; 
}
interface RoleRow { role: string; count: string }
interface SystemRow {
  total?: string;
  last_24h?: string;
  last_hour?: string;
  oldest?: string;
  newest?: string;
  storage_bytes?: string;
}
interface KindRow { kind: string; count: string }
interface InsightRow { 
  total?: string; 
  avg_confidence?: string; 
  actioned?: string; 
}
interface CategoryRow { category: string; count: string }
interface TimeseriesRow {
  timestamp: string;
  jobs_created: string;
  jobs_completed: string;
  jobs_failed: string;
  tokens_used: string;
  escalations: string;
}

/**
 * Collect job metrics from the ledger
 */
export async function collectJobMetrics(since?: string): Promise<JobMetrics> {
  const sinceClause = since ? `AND created_at >= $1` : "";
  const params = since ? [since] : [];

  // Job status distribution
  const statusRes = await pool.query<StatusRow>(`
    SELECT 
      COALESCE((data->>'status')::text, 'unknown') as status,
      COUNT(*) as count
    FROM ledger 
    WHERE kind = 'job_status' ${sinceClause}
    GROUP BY data->>'status'
  `, params);

  // Job mode distribution
  const modeRes = await pool.query<ModeRow>(`
    SELECT 
      COALESCE((data->>'mode')::text, 'mechanic') as mode,
      COUNT(DISTINCT job_id) as count
    FROM ledger 
    WHERE kind = 'job_created' ${sinceClause}
    GROUP BY data->>'mode'
  `, params);

  // Aggregates
  const aggRes = await pool.query<AggRow>(`
    SELECT 
      COUNT(DISTINCT job_id) as total_jobs,
      AVG(CASE WHEN kind = 'job_status' AND data->>'status' = 'succeeded' 
          THEN EXTRACT(EPOCH FROM (created_at - 
            (SELECT MIN(l2.created_at) FROM ledger l2 WHERE l2.job_id = ledger.job_id AND l2.kind = 'job_created')
          )) * 1000 END) as avg_duration_ms,
      AVG((data->>'steps_used')::numeric) FILTER (WHERE kind = 'job_status') as avg_steps,
      AVG((data->>'tokens_used')::numeric) FILTER (WHERE kind = 'job_status') as avg_tokens,
      COUNT(*) FILTER (WHERE kind = 'job_status' AND data->>'status' = 'succeeded')::float / 
        NULLIF(COUNT(*) FILTER (WHERE kind = 'job_status' AND data->>'status' IN ('succeeded', 'failed')), 0) as success_rate,
      COUNT(*) FILTER (WHERE kind = 'escalation')::float / 
        NULLIF(COUNT(DISTINCT job_id), 0) as escalation_rate
    FROM ledger
    WHERE (kind IN ('job_created', 'job_status', 'escalation')) ${sinceClause}
  `, params);

  const agg = aggRes.rows[0] || {};

  return {
    total: parseInt(agg.total_jobs ?? "0") || 0,
    byStatus: Object.fromEntries(statusRes.rows.map(r => [r.status, parseInt(r.count)])),
    byMode: Object.fromEntries(modeRes.rows.map(r => [r.mode, parseInt(r.count)])),
    avgDurationMs: parseFloat(agg.avg_duration_ms ?? "0") || 0,
    avgSteps: parseFloat(agg.avg_steps ?? "0") || 0,
    avgTokens: parseFloat(agg.avg_tokens ?? "0") || 0,
    successRate: parseFloat(agg.success_rate ?? "0") || 0,
    escalationRate: parseFloat(agg.escalation_rate ?? "0") || 0,
  };
}

/**
 * Collect agent metrics from the ledger
 */
export async function collectAgentMetrics(since?: string): Promise<AgentMetrics> {
  const sinceClause = since ? `AND created_at >= $1` : "";
  const params = since ? [since] : [];

  // Events by agent
  const agentRes = await pool.query<AgentRow>(`
    SELECT 
      COALESCE(actor_id, 'unknown') as agent,
      COUNT(*) as count
    FROM ledger 
    WHERE actor_type = 'agent' ${sinceClause}
    GROUP BY actor_id
  `, params);

  // Tool calls
  const toolRes = await pool.query<ToolRow>(`
    SELECT 
      COALESCE(data->>'tool_name', 'unknown') as tool,
      COUNT(*) as count,
      AVG((data->>'duration_ms')::numeric) as avg_latency
    FROM ledger 
    WHERE kind = 'event' AND data->>'event_kind' = 'tool_call' ${sinceClause}
    GROUP BY data->>'tool_name'
  `, params);

  // Errors
  const errorRes = await pool.query<ErrorRow>(`
    SELECT 
      COALESCE(data->>'error_message', summary) as error,
      COUNT(*) as count
    FROM ledger 
    WHERE kind = 'error' ${sinceClause}
    GROUP BY COALESCE(data->>'error_message', summary)
    ORDER BY count DESC
    LIMIT 10
  `, params);

  // Total events and error rate
  const totalsRes = await pool.query<TotalsRow>(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE kind = 'error')::float / NULLIF(COUNT(*), 0) as error_rate
    FROM ledger 
    WHERE actor_type = 'agent' ${sinceClause}
  `, params);

  const totals = totalsRes.rows[0] || {};

  return {
    totalEvents: parseInt(totals.total ?? "0") || 0,
    byAgent: Object.fromEntries(agentRes.rows.map(r => [r.agent, parseInt(r.count)])),
    toolCalls: Object.fromEntries(toolRes.rows.map(r => [r.tool, parseInt(r.count)])),
    avgToolLatencyMs: Object.fromEntries(toolRes.rows.map(r => [r.tool, parseFloat(r.avg_latency ?? "0") || 0])),
    errorRate: parseFloat(totals.error_rate ?? "0") || 0,
    topErrors: errorRes.rows.map(r => ({ error: r.error, count: parseInt(r.count) })),
  };
}

/**
 * Collect budget metrics from the ledger
 */
export async function collectBudgetMetrics(since?: string): Promise<BudgetMetrics> {
  const sinceClause = since ? `AND created_at >= $1` : "";
  const params = since ? [since] : [];

  const budgetRes = await pool.query<BudgetRow>(`
    SELECT 
      COALESCE(SUM((data->>'tokens_used')::numeric), 0) as total_tokens,
      COALESCE(SUM((data->>'steps_used')::numeric), 0) as total_steps,
      AVG((data->>'tokens_used')::numeric) as avg_tokens,
      AVG((data->>'steps_used')::numeric) as avg_steps,
      COUNT(*) FILTER (WHERE data->>'budget_exceeded' = 'true') as budget_exceeded
    FROM ledger 
    WHERE kind = 'job_status' AND data->>'status' IN ('succeeded', 'failed') ${sinceClause}
  `, params);

  // Tokens by agent
  const byAgentRes = await pool.query<TokensByAgentRow>(`
    SELECT 
      COALESCE(actor_id, 'unknown') as agent,
      COALESCE(SUM((data->>'tokens')::numeric), 0) as tokens
    FROM ledger 
    WHERE kind = 'event' AND actor_type = 'agent' AND data->>'tokens' IS NOT NULL ${sinceClause}
    GROUP BY actor_id
  `, params);

  const agg = budgetRes.rows[0] || {};

  return {
    totalTokensUsed: parseInt(agg.total_tokens ?? "0") || 0,
    totalStepsUsed: parseInt(agg.total_steps ?? "0") || 0,
    avgTokensPerJob: parseFloat(agg.avg_tokens ?? "0") || 0,
    avgStepsPerJob: parseFloat(agg.avg_steps ?? "0") || 0,
    budgetExceededCount: parseInt(agg.budget_exceeded ?? "0") || 0,
    tokensByAgent: Object.fromEntries(byAgentRes.rows.map(r => [r.agent, parseInt(r.tokens)])),
  };
}

/**
 * Collect conversation metrics
 */
export async function collectConversationMetrics(since?: string): Promise<ConversationMetrics> {
  const sinceClause = since ? `AND created_at >= $1` : "";
  const params = since ? [since] : [];

  const convRes = await pool.query<ConvRow>(`
    SELECT 
      COUNT(DISTINCT conversation_id) as total_conversations,
      COUNT(*) as total_messages,
      COUNT(*)::float / NULLIF(COUNT(DISTINCT conversation_id), 0) as avg_messages
    FROM ledger 
    WHERE kind = 'message' ${sinceClause}
  `, params);

  const byRoleRes = await pool.query<RoleRow>(`
    SELECT 
      COALESCE(data->>'role', 'unknown') as role,
      COUNT(*) as count
    FROM ledger 
    WHERE kind = 'message' ${sinceClause}
    GROUP BY data->>'role'
  `, params);

  const agg = convRes.rows[0] || {};

  return {
    totalConversations: parseInt(agg.total_conversations ?? "0") || 0,
    totalMessages: parseInt(agg.total_messages ?? "0") || 0,
    avgMessagesPerConversation: parseFloat(agg.avg_messages ?? "0") || 0,
    messagesByRole: Object.fromEntries(byRoleRes.rows.map(r => [r.role, parseInt(r.count)])),
  };
}

/**
 * Collect system metrics
 */
export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const sysRes = await pool.query<SystemRow>(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as last_24h,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') as last_hour,
      MIN(created_at)::text as oldest,
      MAX(created_at)::text as newest,
      pg_total_relation_size('ledger') as storage_bytes
    FROM ledger
  `);

  const byKindRes = await pool.query<KindRow>(`
    SELECT kind, COUNT(*) as count FROM ledger GROUP BY kind
  `);

  const agg = sysRes.rows[0] || {};

  return {
    ledgerEntries: parseInt(agg.total ?? "0") || 0,
    entriesByKind: Object.fromEntries(byKindRes.rows.map(r => [r.kind, parseInt(r.count)])),
    entriesLast24h: parseInt(agg.last_24h ?? "0") || 0,
    entriesLastHour: parseInt(agg.last_hour ?? "0") || 0,
    storageEstimateBytes: parseInt(agg.storage_bytes ?? "0") || 0,
    oldestEntry: agg.oldest || null,
    newestEntry: agg.newest || null,
  };
}

/**
 * Collect insights metrics
 */
export async function collectInsightsMetrics(since?: string): Promise<InsightsMetrics> {
  const sinceClause = since ? `AND created_at >= $1` : "";
  const params = since ? [since] : [];

  const insightRes = await pool.query<InsightRow>(`
    SELECT 
      COUNT(*) as total,
      AVG((data->>'confidence')::numeric) as avg_confidence,
      COUNT(*) FILTER (WHERE data->>'actioned' = 'true') as actioned
    FROM ledger 
    WHERE kind = 'event' AND data->>'event_kind' = 'insight' ${sinceClause}
  `, params);

  const byCategoryRes = await pool.query<CategoryRow>(`
    SELECT 
      COALESCE(data->>'category', 'unknown') as category,
      COUNT(*) as count
    FROM ledger 
    WHERE kind = 'event' AND data->>'event_kind' = 'insight' ${sinceClause}
    GROUP BY data->>'category'
  `, params);

  const agg = insightRes.rows[0] || {};

  return {
    totalInsights: parseInt(agg.total ?? "0") || 0,
    byCategory: Object.fromEntries(byCategoryRes.rows.map(r => [r.category, parseInt(r.count)])),
    avgConfidence: parseFloat(agg.avg_confidence ?? "0") || 0,
    actionedCount: parseInt(agg.actioned ?? "0") || 0,
  };
}

/**
 * Collect timeseries data
 */
export async function collectTimeseries(
  interval: "hour" | "day" = "hour",
  points = 24
): Promise<TimeseriesPoint[]> {
  const truncate = interval === "hour" ? "hour" : "day";
  const intervalStr = interval === "hour" ? "1 hour" : "1 day";

  const tsRes = await pool.query<TimeseriesRow>(`
    WITH time_buckets AS (
      SELECT generate_series(
        date_trunc($1, NOW()) - ($2::int - 1) * $3::interval,
        date_trunc($1, NOW()),
        $3::interval
      ) as bucket
    )
    SELECT 
      bucket::text as timestamp,
      COUNT(*) FILTER (WHERE l.kind = 'job_created') as jobs_created,
      COUNT(*) FILTER (WHERE l.kind = 'job_status' AND l.data->>'status' = 'succeeded') as jobs_completed,
      COUNT(*) FILTER (WHERE l.kind = 'job_status' AND l.data->>'status' = 'failed') as jobs_failed,
      COALESCE(SUM((l.data->>'tokens_used')::numeric) FILTER (WHERE l.kind = 'job_status'), 0) as tokens_used,
      COUNT(*) FILTER (WHERE l.kind = 'escalation') as escalations
    FROM time_buckets tb
    LEFT JOIN ledger l ON date_trunc($1, l.created_at) = tb.bucket
    GROUP BY bucket
    ORDER BY bucket
  `, [truncate, points, intervalStr]);

  return tsRes.rows.map(r => ({
    timestamp: r.timestamp,
    jobsCreated: parseInt(r.jobs_created) || 0,
    jobsCompleted: parseInt(r.jobs_completed) || 0,
    jobsFailed: parseInt(r.jobs_failed) || 0,
    tokensUsed: parseInt(r.tokens_used) || 0,
    escalations: parseInt(r.escalations) || 0,
  }));
}

/**
 * Collect all metrics
 */
export async function collectAllMetrics(since?: string): Promise<FullMetrics> {
  const [jobs, agents, budget, conversations, system, insights, timeseries] = await Promise.all([
    collectJobMetrics(since),
    collectAgentMetrics(since),
    collectBudgetMetrics(since),
    collectConversationMetrics(since),
    collectSystemMetrics(),
    collectInsightsMetrics(since),
    collectTimeseries("hour", 24),
  ]);

  return {
    timestamp: new Date().toISOString(),
    jobs,
    agents,
    budget,
    conversations,
    system,
    insights,
    timeseries,
  };
}

// ============================================================================
// REAL-TIME METRICS STREAM
// ============================================================================

export interface MetricEvent {
  type: "job" | "tool" | "error" | "budget" | "insight" | "message";
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Subscribe to real-time metric events via PostgreSQL LISTEN/NOTIFY
 */
export async function subscribeToMetrics(
  callback: (event: MetricEvent) => void
): Promise<() => void> {
  const client = await pool.connect();

  // Create notification trigger if not exists
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_metric_event()
    RETURNS TRIGGER AS $$
    DECLARE
      event_type TEXT;
      payload JSON;
    BEGIN
      -- Determine event type
      event_type := CASE 
        WHEN NEW.kind = 'job_status' THEN 'job'
        WHEN NEW.kind = 'event' AND NEW.data->>'event_kind' = 'tool_call' THEN 'tool'
        WHEN NEW.kind = 'error' THEN 'error'
        WHEN NEW.kind = 'event' AND NEW.data->>'event_kind' = 'insight' THEN 'insight'
        WHEN NEW.kind = 'message' THEN 'message'
        ELSE 'other'
      END;
      
      -- Build payload
      payload := json_build_object(
        'type', event_type,
        'timestamp', NEW.created_at,
        'id', NEW.id,
        'kind', NEW.kind,
        'job_id', NEW.job_id,
        'summary', NEW.summary,
        'data', NEW.data
      );
      
      -- Notify
      PERFORM pg_notify('metric_events', payload::text);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS ledger_metric_trigger ON ledger;
    CREATE TRIGGER ledger_metric_trigger
      AFTER INSERT ON ledger
      FOR EACH ROW
      EXECUTE FUNCTION notify_metric_event();
  `);

  // Subscribe to notifications
  await client.query("LISTEN metric_events");

  client.on("notification", (msg) => {
    if (msg.channel === "metric_events" && msg.payload) {
      try {
        const payload = JSON.parse(msg.payload);
        callback({
          type: payload.type,
          timestamp: payload.timestamp,
          data: payload,
        });
      } catch (e) {
        console.error("Failed to parse metric event:", e);
      }
    }
  });

  // Return unsubscribe function
  return () => {
    client.query("UNLISTEN metric_events").then(() => client.release());
  };
}
