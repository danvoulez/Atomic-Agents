import {
  EventRow,
  JobRow,
  MessageRow,
  EvaluationRow,
  JobInput,
  EventInput,
  EvaluationInput,
  JobStatus,
  AgentType,
  EventKind,
} from "./schema";

// Re-export pool and query from client
export { pool, query } from "./client";
import { pool } from "./client";

export type {
  JobRow,
  MessageRow,
  EventRow,
  EvaluationRow,
  JobInput,
  EventInput,
  EvaluationInput,
  JobStatus,
  AgentType,
  EventKind,
};

// ============================================================================
// Jobs
// ============================================================================

/**
 * Claim a single job using Postgres row locking (FOR UPDATE SKIP LOCKED).
 */
export async function claimNextJob(mode: string): Promise<JobRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<JobRow>(
      `
      SELECT *
      FROM jobs
      WHERE status = 'queued' AND mode = $1
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
      `,
      [mode]
    );

    if (res.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const job = res.rows[0];
    await client.query(
      "UPDATE jobs SET status = 'running', started_at = NOW(), last_heartbeat_at = NOW() WHERE id = $1",
      [job.id]
    );
    await client.query("COMMIT");
    return job;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getJob(id: string): Promise<JobRow | null> {
  const res = await pool.query<JobRow>("SELECT * FROM jobs WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}

export async function markJobStatus(id: string, status: JobStatus): Promise<void> {
  const terminal: JobStatus[] = ["succeeded", "failed", "aborted"];
  if (terminal.includes(status)) {
    await pool.query("UPDATE jobs SET status = $1, finished_at = NOW() WHERE id = $2", [status, id]);
  } else {
    await pool.query("UPDATE jobs SET status = $1 WHERE id = $2", [status, id]);
  }
}

export async function isJobCancelling(id: string): Promise<boolean> {
  const res = await pool.query<{ status: JobStatus }>("SELECT status FROM jobs WHERE id = $1", [id]);
  return res.rows[0]?.status === "cancelling";
}

export async function setJobHeartbeat(id: string): Promise<void> {
  await pool.query("UPDATE jobs SET last_heartbeat_at = NOW() WHERE id = $1", [id]);
}

export async function updateJobBudget(
  id: string,
  updates: { steps_used?: number; tokens_used?: number; cost_used_cents?: number; current_action?: string }
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.steps_used !== undefined) {
    sets.push(`steps_used = $${idx++}`);
    values.push(updates.steps_used);
  }
  if (updates.tokens_used !== undefined) {
    sets.push(`tokens_used = $${idx++}`);
    values.push(updates.tokens_used);
  }
  if (updates.cost_used_cents !== undefined) {
    sets.push(`cost_used_cents = $${idx++}`);
    values.push(updates.cost_used_cents);
  }
  if (updates.current_action !== undefined) {
    sets.push(`current_action = $${idx++}`);
    values.push(updates.current_action);
  }

  if (sets.length > 0) {
    values.push(id);
    await pool.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = $${idx}`, values);
  }
}

export async function requeueStaleJobs(thresholdMs: number): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `
    WITH updated AS (
      UPDATE jobs
      SET status = 'queued', started_at = NULL, last_heartbeat_at = NULL, assigned_to = NULL
      WHERE status = 'running'
        AND (last_heartbeat_at IS NULL OR last_heartbeat_at < NOW() - ($1::interval))
      RETURNING 1
    )
    SELECT COUNT(*) FROM updated
    `,
    [`${thresholdMs} milliseconds`]
  );
  return parseInt(res.rows[0]?.count ?? "0", 10);
}

export async function insertJob(job: JobInput): Promise<JobRow> {
  const id = job.id ?? crypto.randomUUID();
  const traceId = job.trace_id ?? id;

  if (job.conversation_id) {
    await ensureConversation(job.conversation_id);
  }

  await pool.query(
    `INSERT INTO jobs (
      id, trace_id, mode, agent_type, goal, repo_path, status,
      conversation_id, parent_job_id, step_cap, token_cap, cost_cap_cents,
      created_by, logline_span, span_hash, proof_ref
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      id,
      traceId,
      job.mode,
      job.agent_type ?? "coordinator",
      job.goal,
      job.repo_path,
      job.status ?? "queued",
      job.conversation_id ?? null,
      job.parent_job_id ?? null,
      job.step_cap ?? 20,
      job.token_cap ?? 100000,
      job.cost_cap_cents ?? 1000,
      job.created_by ?? "api",
      job.logline_span ?? null,
      job.span_hash ?? null,
      job.proof_ref ?? null,
    ]
  );

  return (await getJob(id))!;
}

export async function listJobs(options?: { conversationId?: string; status?: JobStatus; limit?: number }): Promise<JobRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (options?.conversationId) {
    conditions.push(`conversation_id = $${idx++}`);
    values.push(options.conversationId);
  }
  if (options?.status) {
    conditions.push(`status = $${idx++}`);
    values.push(options.status);
  }

  let sql = `SELECT * FROM jobs`;
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  sql += ` ORDER BY created_at DESC`;
  
  if (options?.limit) {
    sql += ` LIMIT $${idx++}`;
    values.push(options.limit);
  }

  const res = await pool.query<JobRow>(sql, values);
  return res.rows;
}

export async function updateJob(
  id: string,
  updates: Partial<Pick<JobRow, 
    "status" | "goal" | "mode" | "agent_type" | "repo_path" | 
    "step_cap" | "token_cap" | "cost_cap_cents" | "current_action" |
    "assigned_to" | "logline_span" | "span_hash"
  >> & { 
    output_type?: string;
    output_data?: unknown;
  }
): Promise<JobRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowedFields = [
    "status", "goal", "mode", "agent_type", "repo_path",
    "step_cap", "token_cap", "cost_cap_cents", "current_action",
    "assigned_to", "logline_span", "span_hash"
  ];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && allowedFields.includes(key)) {
      sets.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  // Handle terminal status transitions
  if (updates.status) {
    const terminalStatuses: JobStatus[] = ["succeeded", "failed", "aborted"];
    if (terminalStatuses.includes(updates.status)) {
      sets.push(`finished_at = NOW()`);
    }
  }

  if (sets.length === 0) {
    return getJob(id);
  }

  values.push(id);
  await pool.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = $${idx}`, values);
  return getJob(id);
}

export async function requestJobCancel(id: string): Promise<void> {
  await pool.query(
    "UPDATE jobs SET status = 'cancelling', cancel_requested_at = NOW() WHERE id = $1 AND status IN ('queued', 'running')",
    [id]
  );
}

// ============================================================================
// Events
// ============================================================================

export async function insertEvent(event: EventInput): Promise<EventRow> {
  const id = event.id ?? crypto.randomUUID();

  await pool.query(
    `INSERT INTO events (
      id, job_id, trace_id, kind, tool_name, params, result,
      summary, duration_ms, tokens_used, cost_cents, span_hash, conversation_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      event.job_id,
      event.trace_id,
      event.kind,
      event.tool_name ?? null,
      event.params ? JSON.stringify(event.params) : null,
      event.result ? JSON.stringify(event.result) : null,
      event.summary ?? null,
      event.duration_ms ?? null,
      event.tokens_used ?? null,
      event.cost_cents ?? null,
      event.span_hash ?? null,
      event.conversation_id ?? null,
    ]
  );

  const res = await pool.query<EventRow>("SELECT * FROM events WHERE id = $1", [id]);
  return res.rows[0];
}

export async function listEvents(jobId: string): Promise<EventRow[]> {
  const res = await pool.query<EventRow>(
    `SELECT * FROM events WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId]
  );
  return res.rows;
}

export async function listEventsByTrace(traceId: string): Promise<EventRow[]> {
  const res = await pool.query<EventRow>(
    `SELECT * FROM events WHERE trace_id = $1 ORDER BY created_at ASC`,
    [traceId]
  );
  return res.rows;
}

// ============================================================================
// Evaluations
// ============================================================================

export async function insertEvaluation(evaluation: EvaluationInput): Promise<EvaluationRow> {
  const id = crypto.randomUUID();

  await pool.query(
    `INSERT INTO evaluations (
      id, job_id, correctness, efficiency, honesty, safety,
      flags, feedback, recommendations, evaluated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (job_id) DO UPDATE SET
      correctness = EXCLUDED.correctness,
      efficiency = EXCLUDED.efficiency,
      honesty = EXCLUDED.honesty,
      safety = EXCLUDED.safety,
      flags = EXCLUDED.flags,
      feedback = EXCLUDED.feedback,
      recommendations = EXCLUDED.recommendations,
      evaluated_by = EXCLUDED.evaluated_by`,
    [
      id,
      evaluation.job_id,
      evaluation.correctness ?? null,
      evaluation.efficiency ?? null,
      evaluation.honesty ?? null,
      evaluation.safety ?? null,
      JSON.stringify(evaluation.flags ?? []),
      evaluation.feedback ?? null,
      JSON.stringify(evaluation.recommendations ?? []),
      evaluation.evaluated_by ?? "auto",
    ]
  );

  const res = await pool.query<EvaluationRow>(
    "SELECT * FROM evaluations WHERE job_id = $1",
    [evaluation.job_id]
  );
  return res.rows[0];
}

export async function getEvaluation(jobId: string): Promise<EvaluationRow | null> {
  const res = await pool.query<EvaluationRow>(
    "SELECT * FROM evaluations WHERE job_id = $1",
    [jobId]
  );
  return res.rows[0] ?? null;
}

// ============================================================================
// Conversations & Messages
// ============================================================================

export async function ensureConversation(conversationId: string): Promise<void> {
  await pool.query(
    "INSERT INTO conversations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
    [conversationId]
  );
}

export async function insertMessage(message: MessageRow): Promise<void> {
  await ensureConversation(message.conversation_id);
  await pool.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))`,
    [
      message.id,
      message.conversation_id,
      message.role,
      message.content,
      message.created_at ?? null,
    ]
  );
}

export async function listMessages(conversationId: string): Promise<MessageRow[]> {
  const res = await pool.query<MessageRow>(
    `SELECT id, conversation_id, role, content, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return res.rows;
}

// ============================================================================
// Ledger & RBAC (append-only, cross-project knowledge)
// ============================================================================

export {
  // Ledger
  createLedgerSchema,
  appendToLedger,
  appendMessage as appendMessageToLedger,
  appendJobStatus,
  appendEvent as appendEventToLedger,
  appendKnowledge,
  queryLedger,
  getJobState,
  getConversationMessages,
  searchKnowledge,
  findSimilarWork,
  getAuditTrail,
  appendAudit,
  type LedgerEntry,
  type LedgerEntryKind,
  type LedgerQuery,
} from "./ledger";

export {
  // RBAC
  AgentDBClient,
  AdminDBClient,
  createAgentDBClient,
  createAdminDBClient,
  type AgentRole,
  type AgentIdentity,
} from "./rbac";

export {
  // Metrics
  collectJobMetrics,
  collectAgentMetrics,
  collectBudgetMetrics,
  collectConversationMetrics,
  collectSystemMetrics,
  collectInsightsMetrics,
  collectTimeseries,
  collectAllMetrics,
  subscribeToMetrics,
  type JobMetrics,
  type AgentMetrics,
  type BudgetMetrics,
  type ConversationMetrics,
  type SystemMetrics,
  type InsightsMetrics,
  type FullMetrics,
  type TimeseriesPoint,
  type MetricEvent,
} from "./metrics";

export {
  // Event Bus
  getEventBus,
  publishJobEvent,
  publishMetricEvent,
  publishNotification,
  publishInsight,
  publishHealthCheck,
  publishAlert,
  getMetricAggregator,
  type EventChannel,
  type BusEvent,
  type EventHandler,
} from "./eventbus";
