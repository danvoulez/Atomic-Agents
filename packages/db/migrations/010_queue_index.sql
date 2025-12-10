-- Migration: Add index for queue polling with SKIP LOCKED
-- This index is CRITICAL for performance when using FOR UPDATE SKIP LOCKED
-- Without it, Postgres does a sequential scan which can temporarily lock the entire table

-- Index for job claiming query:
-- SELECT * FROM jobs WHERE status = 'queued' AND mode = $1 ORDER BY created_at FOR UPDATE SKIP LOCKED
CREATE INDEX IF NOT EXISTS idx_jobs_queue_claim
  ON jobs (status, mode, created_at)
  WHERE status = 'queued';

-- Index for stale job requeue query:
-- UPDATE jobs SET status = 'queued' WHERE status = 'running' AND last_heartbeat_at < ...
CREATE INDEX IF NOT EXISTS idx_jobs_stale_check
  ON jobs (status, last_heartbeat_at)
  WHERE status = 'running';

-- Partial index for active jobs (not in terminal state)
-- Useful for dashboard queries and worker monitoring
CREATE INDEX IF NOT EXISTS idx_jobs_active
  ON jobs (status, created_at)
  WHERE status IN ('queued', 'running', 'cancelling', 'waiting_human');

-- Index for conversation queries
CREATE INDEX IF NOT EXISTS idx_jobs_conversation
  ON jobs (conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;

-- Index for trace ID lookups (used in event correlation)
CREATE INDEX IF NOT EXISTS idx_jobs_trace
  ON jobs (trace_id);

-- Add comment explaining the indexes
COMMENT ON INDEX idx_jobs_queue_claim IS
  'Critical for FOR UPDATE SKIP LOCKED performance in job claiming';
