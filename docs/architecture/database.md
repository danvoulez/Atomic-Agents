# Database Architecture

PostgreSQL schema, ledger design, and data access patterns.

## Overview

AI Coding Team uses PostgreSQL as its primary database, leveraging:
- **SKIP LOCKED**: Efficient job queue without Redis
- **LISTEN/NOTIFY**: Real-time event streaming
- **JSONB**: Flexible schema for events and data
- **Append-Only Ledger**: Full audit trail

## Schema Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                              JOBS                                     │
├──────────────────────────────────────────────────────────────────────┤
│ id               │ uuid PRIMARY KEY                                  │
│ trace_id         │ uuid NOT NULL                                     │
│ mode             │ text NOT NULL (mechanic/genius)                   │
│ agent_type       │ text NOT NULL                                     │
│ goal             │ text NOT NULL                                     │
│ repo_path        │ text NOT NULL                                     │
│ status           │ text NOT NULL                                     │
│ conversation_id  │ uuid → conversations(id)                          │
│ parent_job_id    │ uuid → jobs(id)                                   │
│ step_cap         │ int                                               │
│ token_cap        │ int                                               │
│ cost_cap_cents   │ int                                               │
│ steps_used       │ int                                               │
│ tokens_used      │ int                                               │
│ cost_used_cents  │ int                                               │
│ created_at       │ timestamp                                         │
│ started_at       │ timestamp                                         │
│ finished_at      │ timestamp                                         │
│ last_heartbeat_at│ timestamp                                         │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                             EVENTS                                    │
├──────────────────────────────────────────────────────────────────────┤
│ id               │ uuid PRIMARY KEY                                  │
│ job_id           │ uuid → jobs(id)                                   │
│ trace_id         │ uuid                                              │
│ kind             │ text NOT NULL                                     │
│ tool_name        │ text                                              │
│ params           │ jsonb                                             │
│ result           │ jsonb                                             │
│ summary          │ text                                              │
│ duration_ms      │ int                                               │
│ tokens_used      │ int                                               │
│ cost_cents       │ numeric                                           │
│ created_at       │ timestamp                                         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                             LEDGER                                    │
├──────────────────────────────────────────────────────────────────────┤
│ id               │ uuid PRIMARY KEY                                  │
│ kind             │ text NOT NULL                                     │
│ job_id           │ uuid                                              │
│ conversation_id  │ uuid                                              │
│ project_id       │ text                                              │
│ actor_type       │ text (agent/user/system)                          │
│ actor_id         │ text                                              │
│ summary          │ text                                              │
│ data             │ jsonb                                             │
│ created_at       │ timestamp (immutable)                             │
└──────────────────────────────────────────────────────────────────────┘
                    ▲
                    │ APPEND ONLY - NO UPDATE/DELETE
                    │

┌──────────────────────────────────────────────────────────────────────┐
│                          CONVERSATIONS                                │
├──────────────────────────────────────────────────────────────────────┤
│ id               │ uuid PRIMARY KEY                                  │
│ created_at       │ timestamp                                         │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                            MESSAGES                                   │
├──────────────────────────────────────────────────────────────────────┤
│ id               │ uuid PRIMARY KEY                                  │
│ conversation_id  │ uuid → conversations(id)                          │
│ role             │ text NOT NULL                                     │
│ content          │ text NOT NULL                                     │
│ created_at       │ timestamp                                         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                           EVALUATIONS                                 │
├──────────────────────────────────────────────────────────────────────┤
│ id               │ uuid PRIMARY KEY                                  │
│ job_id           │ uuid → jobs(id) UNIQUE                            │
│ correctness      │ numeric                                           │
│ efficiency       │ numeric                                           │
│ honesty          │ numeric                                           │
│ safety           │ numeric                                           │
│ flags            │ jsonb                                             │
│ feedback         │ text                                              │
│ recommendations  │ jsonb                                             │
│ evaluated_by     │ text                                              │
│ created_at       │ timestamp                                         │
└──────────────────────────────────────────────────────────────────────┘
```

## Job States

```
                 ┌─────────┐
                 │ queued  │
                 └────┬────┘
                      │ worker claims
                      ▼
                 ┌─────────┐
        ┌───────│ running │───────┐
        │       └────┬────┘       │
        │            │            │
   user cancels    success      error
        │            │            │
        ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌────────┐
  │cancelling│ │succeeded │ │ failed │
  └────┬─────┘ └──────────┘ └────────┘
       │
       ▼
  ┌─────────┐
  │ aborted │
  └─────────┘

              ┌────────────────┐
              │ waiting_human  │ ← escalation
              └────────────────┘
```

## Append-Only Ledger

### Design Principles

1. **Immutable**: Rows are never updated or deleted
2. **Ordered**: `created_at` provides total ordering
3. **Traced**: Every entry has job/conversation context
4. **Typed**: `kind` field categorizes entries

### Entry Kinds

| Kind | Description |
|------|-------------|
| `job_created` | New job created |
| `job_status` | Job status change |
| `event` | Tool call, LLM response |
| `message` | Chat message |
| `error` | Error occurred |
| `escalation` | Human review requested |
| `knowledge` | Cross-project learning |
| `insight` | Watcher observation |

### Deriving Status

Status is derived from the latest entry:
```sql
-- Get current job status
SELECT data->>'status' as status
FROM ledger 
WHERE job_id = $1 AND kind = 'job_status'
ORDER BY created_at DESC
LIMIT 1;
```

### Querying the Ledger

```sql
-- Get job audit trail
SELECT * FROM ledger 
WHERE job_id = $1 
ORDER BY created_at ASC;

-- Get conversation history
SELECT * FROM ledger 
WHERE conversation_id = $1 AND kind = 'message'
ORDER BY created_at ASC;

-- Search knowledge base
SELECT * FROM ledger 
WHERE kind = 'knowledge' 
AND data->>'topic' ILIKE '%typescript%';

-- Find similar past work
SELECT * FROM ledger 
WHERE kind = 'job_created'
AND data->>'goal' % $1  -- trigram similarity
ORDER BY similarity(data->>'goal', $1) DESC
LIMIT 5;
```

## Job Queue Pattern

Using `FOR UPDATE SKIP LOCKED` for efficient job claiming:

```sql
-- Worker claims next job
BEGIN;

SELECT * FROM jobs 
WHERE status = 'queued' AND mode = 'mechanic'
ORDER BY created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;

-- If found, update status
UPDATE jobs SET 
  status = 'running',
  started_at = NOW(),
  last_heartbeat_at = NOW(),
  assigned_to = 'worker-123'
WHERE id = $1;

COMMIT;
```

### Benefits

- No Redis dependency
- Exactly-once processing
- Automatic deadlock prevention
- Works with replicas

## Real-Time Updates

Using PostgreSQL LISTEN/NOTIFY:

```sql
-- Create notification trigger
CREATE OR REPLACE FUNCTION notify_job_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'job_updates',
    json_build_object(
      'id', NEW.id,
      'status', NEW.status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_notify_trigger
  AFTER INSERT OR UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_change();
```

```typescript
// Subscribe in Node.js
const client = await pool.connect();
await client.query("LISTEN job_updates");
client.on("notification", (msg) => {
  const update = JSON.parse(msg.payload);
  broadcastToClients(update);
});
```

## Indexes

### Performance Indexes

```sql
-- Job claiming
CREATE INDEX idx_jobs_queue ON jobs (mode, created_at) 
  WHERE status = 'queued';

-- Job lookup
CREATE INDEX idx_jobs_conversation ON jobs (conversation_id);
CREATE INDEX idx_jobs_trace ON jobs (trace_id);

-- Event lookup
CREATE INDEX idx_events_job ON events (job_id, created_at);
CREATE INDEX idx_events_trace ON events (trace_id);

-- Ledger queries
CREATE INDEX idx_ledger_job ON ledger (job_id, created_at);
CREATE INDEX idx_ledger_conversation ON ledger (conversation_id, created_at);
CREATE INDEX idx_ledger_kind ON ledger (kind, created_at);

-- Full-text search on ledger
CREATE INDEX idx_ledger_search ON ledger 
  USING gin (to_tsvector('english', summary));
```

## RBAC (Role-Based Access Control)

Agents have restricted database access:

```typescript
// Agent roles
type AgentRole = "coordinator" | "planner" | "builder" | "reviewer" | "evaluator" | "watcher";

// Permissions matrix
const PERMISSIONS = {
  coordinator: { read: true, append: ["message", "job_status"] },
  planner: { read: true, append: ["event", "knowledge"] },
  builder: { read: true, append: ["event"] },
  reviewer: { read: true, append: ["event"] },
  evaluator: { read: true, append: ["event", "evaluation"] },
  watcher: { read: true, append: ["insight", "knowledge"] },
};

// AgentDBClient enforces these rules
const db = createAgentDBClient({
  role: "builder",
  agentId: "builder-123",
  jobId: "job-456",
});

// This will throw:
await db.deleteJob(jobId); // Error: Agents cannot delete
```

## Metrics from Database

The metrics system queries the ledger:

```sql
-- Job success rate (last 24h)
SELECT 
  COUNT(*) FILTER (WHERE data->>'status' = 'succeeded')::float /
  NULLIF(COUNT(*), 0) as success_rate
FROM ledger
WHERE kind = 'job_status' 
AND created_at >= NOW() - INTERVAL '24 hours';

-- Tokens by agent
SELECT 
  actor_id,
  SUM((data->>'tokens')::numeric) as total_tokens
FROM ledger
WHERE kind = 'event' AND actor_type = 'agent'
GROUP BY actor_id;

-- Error distribution
SELECT 
  data->>'error_code' as error_code,
  COUNT(*) as count
FROM ledger
WHERE kind = 'error'
GROUP BY data->>'error_code'
ORDER BY count DESC;
```

## Migrations

Migrations are in `packages/db/migrations/`:

```
migrations/
├── 001_initial.sql
├── 002_events.sql
├── 003_evaluations.sql
├── 004_conversations.sql
├── 005_messages.sql
├── 006_jobs_tracing.sql
├── 007_jobs_budgets.sql
└── 008_complete_schema.sql
```

Apply migrations:
```bash
DATABASE_URL=postgres://... pnpm --filter @ai-coding-team/db migrate
```

## Backup Strategy

### Production Backup

```bash
# Daily backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Point-in-time recovery (AWS RDS)
# Automatic with 7-day retention
```

### Ledger Archival

For long-term storage:
```sql
-- Move old entries to archive
INSERT INTO ledger_archive
SELECT * FROM ledger
WHERE created_at < NOW() - INTERVAL '90 days';

DELETE FROM ledger
WHERE created_at < NOW() - INTERVAL '90 days';
```

## Related Documentation

- [Architecture Overview](./overview.md)
- [API Reference](../reference/api.md)
- [Deployment Guide](../guides/deployment.md)

