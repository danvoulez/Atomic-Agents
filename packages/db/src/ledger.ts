/**
 * Append-Only Ledger
 * 
 * Core principle: NEVER update or delete. Status = last row.
 * This provides:
 * - Full audit trail
 * - Time travel (see state at any point)
 * - Cross-project knowledge/memory
 * - RBAC enforcement
 */

import { pool, query } from "./client";

// ============================================================================
// TYPES
// ============================================================================

export type LedgerEntryKind =
  | "message"           // Conversation messages
  | "job_created"       // New job
  | "job_status"        // Job status change (queued → running → succeeded)
  | "job_claimed"       // Worker claimed job
  | "event"             // Agent events (tool calls, decisions, etc.)
  | "analysis"          // Code analysis results
  | "plan"              // Proposed plans
  | "patch"             // Code patches (before/after)
  | "review"            // Code review feedback
  | "evaluation"        // Quality evaluations
  | "escalation"        // Human escalation
  | "knowledge"         // Cross-project learnings
  | "error"             // Errors
  | "audit";            // Admin/system actions

export interface LedgerEntry {
  id: string;
  created_at: string;
  kind: LedgerEntryKind;
  
  // Context
  project_id?: string;
  conversation_id?: string;
  job_id?: string;
  trace_id?: string;
  
  // Actor
  actor_type: "user" | "agent" | "system" | "admin";
  actor_id?: string;          // user_id, agent_type, or system component
  
  // Content
  summary: string;
  data: Record<string, unknown>;
  
  // Cross-references
  parent_id?: string;         // For threading/replies
  refs?: string[];            // IDs of related entries
}

export interface LedgerQuery {
  project_id?: string;
  conversation_id?: string;
  job_id?: string;
  kind?: LedgerEntryKind | LedgerEntryKind[];
  actor_type?: LedgerEntry["actor_type"];
  since?: string;             // ISO timestamp
  until?: string;
  limit?: number;
  search?: string;            // Full-text search in summary/data
}

// ============================================================================
// SCHEMA (append-only table)
// ============================================================================

export async function createLedgerSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kind TEXT NOT NULL,
      
      project_id TEXT,
      conversation_id TEXT,
      job_id UUID,
      trace_id TEXT,
      
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      
      summary TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      
      parent_id UUID REFERENCES ledger(id),
      refs UUID[]
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_ledger_project ON ledger(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_conversation ON ledger(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_job ON ledger(job_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_kind ON ledger(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_actor ON ledger(actor_type, actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_search ON ledger USING gin(to_tsvector('english', summary));

    -- Prevent updates and deletes (trigger for safety)
    CREATE OR REPLACE FUNCTION prevent_ledger_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Ledger is append-only. Updates and deletes are not allowed.';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS ledger_no_update ON ledger;
    CREATE TRIGGER ledger_no_update
      BEFORE UPDATE ON ledger
      FOR EACH ROW
      EXECUTE FUNCTION prevent_ledger_modification();

    DROP TRIGGER IF EXISTS ledger_no_delete ON ledger;
    CREATE TRIGGER ledger_no_delete
      BEFORE DELETE ON ledger
      FOR EACH ROW
      EXECUTE FUNCTION prevent_ledger_modification();
  `);
}

// ============================================================================
// APPEND OPERATIONS (the only write operations allowed)
// ============================================================================

export async function appendToLedger(entry: Omit<LedgerEntry, "id" | "created_at">): Promise<LedgerEntry> {
  const result = await pool.query<LedgerEntry>(
    `INSERT INTO ledger (
      kind, project_id, conversation_id, job_id, trace_id,
      actor_type, actor_id, summary, data, parent_id, refs
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      entry.kind,
      entry.project_id ?? null,
      entry.conversation_id ?? null,
      entry.job_id ?? null,
      entry.trace_id ?? null,
      entry.actor_type,
      entry.actor_id ?? null,
      entry.summary,
      JSON.stringify(entry.data),
      entry.parent_id ?? null,
      entry.refs ?? null,
    ]
  );
  return result.rows[0];
}

// Convenience wrappers
export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  projectId?: string
): Promise<LedgerEntry> {
  return appendToLedger({
    kind: "message",
    conversation_id: conversationId,
    project_id: projectId,
    actor_type: role === "user" ? "user" : "agent",
    actor_id: role === "user" ? undefined : "coordinator",
    summary: content.slice(0, 200),
    data: { role, content, full_content: content },
  });
}

export async function appendJobStatus(
  jobId: string,
  status: string,
  actorType: LedgerEntry["actor_type"],
  actorId?: string,
  details?: Record<string, unknown>
): Promise<LedgerEntry> {
  return appendToLedger({
    kind: "job_status",
    job_id: jobId,
    actor_type: actorType,
    actor_id: actorId,
    summary: `Job ${jobId} → ${status}`,
    data: { status, ...details },
  });
}

export async function appendEvent(
  jobId: string,
  traceId: string,
  eventKind: string,
  summary: string,
  data: Record<string, unknown>,
  actorId?: string
): Promise<LedgerEntry> {
  return appendToLedger({
    kind: "event",
    job_id: jobId,
    trace_id: traceId,
    actor_type: "agent",
    actor_id: actorId,
    summary,
    data: { event_kind: eventKind, ...data },
  });
}

export async function appendKnowledge(
  summary: string,
  data: Record<string, unknown>,
  projectId?: string,
  refs?: string[]
): Promise<LedgerEntry> {
  return appendToLedger({
    kind: "knowledge",
    project_id: projectId,
    actor_type: "agent",
    summary,
    data,
    refs,
  });
}

// ============================================================================
// QUERY OPERATIONS (read-only)
// ============================================================================

export async function queryLedger(q: LedgerQuery): Promise<LedgerEntry[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (q.project_id) {
    conditions.push(`project_id = $${paramIndex++}`);
    values.push(q.project_id);
  }

  if (q.conversation_id) {
    conditions.push(`conversation_id = $${paramIndex++}`);
    values.push(q.conversation_id);
  }

  if (q.job_id) {
    conditions.push(`job_id = $${paramIndex++}`);
    values.push(q.job_id);
  }

  if (q.kind) {
    if (Array.isArray(q.kind)) {
      conditions.push(`kind = ANY($${paramIndex++})`);
      values.push(q.kind);
    } else {
      conditions.push(`kind = $${paramIndex++}`);
      values.push(q.kind);
    }
  }

  if (q.actor_type) {
    conditions.push(`actor_type = $${paramIndex++}`);
    values.push(q.actor_type);
  }

  if (q.since) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(q.since);
  }

  if (q.until) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(q.until);
  }

  if (q.search) {
    conditions.push(`to_tsvector('english', summary) @@ plainto_tsquery('english', $${paramIndex++})`);
    values.push(q.search);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = q.limit ?? 100;

  const result = await pool.query<LedgerEntry>(
    `SELECT * FROM ledger ${whereClause} ORDER BY created_at DESC LIMIT ${limit}`,
    values
  );

  return result.rows;
}

// Get current state by deriving from latest entries
export async function getJobState(jobId: string): Promise<{
  status: string;
  stepsUsed: number;
  tokensUsed: number;
  lastActivity: string;
} | null> {
  const latestResult = await pool.query<{ status: string; created_at: string; data: any }>(
    `SELECT data->>'status' as status, created_at, data
     FROM ledger
     WHERE job_id = $1 AND kind = 'job_status'
     ORDER BY created_at DESC
     LIMIT 1`,
    [jobId]
  );

  const latest = latestResult.rows[0];
  if (!latest) return null;

  // Aggregate steps/tokens from all events
  const totalsResult = await pool.query<{ steps: string; tokens: string }>(
    `SELECT 
      COUNT(*) FILTER (WHERE kind = 'event') as steps,
      COALESCE(SUM((data->>'tokens_used')::int), 0) as tokens
     FROM ledger
     WHERE job_id = $1`,
    [jobId]
  );

  const totals = totalsResult.rows[0];

  return {
    status: latest.status,
    stepsUsed: parseInt(totals?.steps ?? "0", 10),
    tokensUsed: parseInt(totals?.tokens ?? "0", 10),
    lastActivity: latest.created_at,
  };
}

// Get conversation messages
export async function getConversationMessages(
  conversationId: string,
  limit = 50
): Promise<{ role: string; content: string; timestamp: string }[]> {
  const result = await pool.query<{ data: any; created_at: string }>(
    `SELECT data, created_at
     FROM ledger
     WHERE conversation_id = $1 AND kind = 'message'
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );

  return result.rows.map(e => ({
    role: e.data.role,
    content: e.data.content,
    timestamp: e.created_at,
  }));
}

// ============================================================================
// CROSS-PROJECT KNOWLEDGE (shared memory)
// ============================================================================

export async function searchKnowledge(
  searchQuery: string,
  options?: { projectId?: string; limit?: number }
): Promise<LedgerEntry[]> {
  const limit = options?.limit ?? 10;

  if (options?.projectId) {
    // Search within project first, then global
    const result = await pool.query<LedgerEntry>(
      `SELECT * FROM ledger
       WHERE kind = 'knowledge'
         AND to_tsvector('english', summary || ' ' || COALESCE(data::text, '')) 
             @@ plainto_tsquery('english', $1)
       ORDER BY 
         CASE WHEN project_id = $2 THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT $3`,
      [searchQuery, options.projectId, limit]
    );
    return result.rows;
  }

  const result = await pool.query<LedgerEntry>(
    `SELECT * FROM ledger
     WHERE kind = 'knowledge'
       AND to_tsvector('english', summary || ' ' || COALESCE(data::text, '')) 
           @@ plainto_tsquery('english', $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [searchQuery, limit]
  );
  return result.rows;
}

export async function getRelatedKnowledge(
  refs: string[],
  limit = 5
): Promise<LedgerEntry[]> {
  const result = await pool.query<LedgerEntry>(
    `SELECT * FROM ledger
     WHERE kind = 'knowledge' AND id = ANY($1::uuid[])
     ORDER BY created_at DESC
     LIMIT $2`,
    [refs, limit]
  );
  return result.rows;
}

// Find similar past work
export async function findSimilarWork(
  description: string,
  options?: { projectId?: string; limit?: number }
): Promise<LedgerEntry[]> {
  const limit = options?.limit ?? 5;

  const result = await pool.query<LedgerEntry>(
    `SELECT * FROM ledger
     WHERE kind IN ('analysis', 'plan', 'patch')
       AND to_tsvector('english', summary || ' ' || COALESCE(data::text, '')) 
           @@ plainto_tsquery('english', $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [description, limit]
  );
  return result.rows;
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

export async function getAuditTrail(
  options: { jobId?: string; projectId?: string; since?: string; limit?: number }
): Promise<LedgerEntry[]> {
  return queryLedger({
    job_id: options.jobId,
    project_id: options.projectId,
    since: options.since,
    limit: options.limit ?? 100,
  });
}

export async function appendAudit(
  action: string,
  details: Record<string, unknown>,
  actorType: LedgerEntry["actor_type"] = "system"
): Promise<LedgerEntry> {
  return appendToLedger({
    kind: "audit",
    actor_type: actorType,
    summary: action,
    data: details,
  });
}
