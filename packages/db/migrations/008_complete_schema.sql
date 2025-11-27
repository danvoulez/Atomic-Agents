-- Migration 008: Complete schema to match plan.md
-- Adds missing columns to jobs and events, creates evaluations table

-- ============================================================================
-- Jobs table additions
-- ============================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS trace_id UUID,
  ADD COLUMN IF NOT EXISTS agent_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS repo_path TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS logline_span TEXT,
  ADD COLUMN IF NOT EXISTS span_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES jobs(id),
  ADD COLUMN IF NOT EXISTS proof_ref UUID,
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(50) DEFAULT 'api';

-- Set defaults for existing rows
UPDATE jobs SET trace_id = id WHERE trace_id IS NULL;
UPDATE jobs SET agent_type = 'coordinator' WHERE agent_type IS NULL;
UPDATE jobs SET repo_path = '.' WHERE repo_path IS NULL;
UPDATE jobs SET created_by = 'api' WHERE created_by IS NULL;

-- Make required columns NOT NULL after populating
ALTER TABLE jobs
  ALTER COLUMN trace_id SET NOT NULL,
  ALTER COLUMN agent_type SET NOT NULL,
  ALTER COLUMN repo_path SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL;

-- Add constraint for agent_type
ALTER TABLE jobs
  ADD CONSTRAINT chk_agent_type CHECK (agent_type IN ('coordinator', 'planner', 'builder', 'reviewer', 'evaluator'));

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_trace ON jobs(trace_id);
CREATE INDEX IF NOT EXISTS idx_jobs_parent ON jobs(parent_job_id) WHERE parent_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_assigned ON jobs(assigned_to) WHERE assigned_to IS NOT NULL;

-- ============================================================================
-- Events table additions
-- ============================================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS trace_id UUID,
  ADD COLUMN IF NOT EXISTS tool_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS params JSONB,
  ADD COLUMN IF NOT EXISTS result JSONB,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER,
  ADD COLUMN IF NOT EXISTS cost_cents INTEGER,
  ADD COLUMN IF NOT EXISTS span_hash VARCHAR(64);

-- Populate trace_id from jobs for existing events
UPDATE events e
SET trace_id = j.trace_id
FROM jobs j
WHERE e.job_id = j.id AND e.trace_id IS NULL;

-- For any events without a job, set trace_id to a generated value
UPDATE events SET trace_id = gen_random_uuid() WHERE trace_id IS NULL;

ALTER TABLE events
  ALTER COLUMN trace_id SET NOT NULL;

-- Add constraint for kind values
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_kind_check;
ALTER TABLE events
  ADD CONSTRAINT events_kind_check CHECK (kind IN (
    'tool_call', 'tool_result',
    'analysis', 'plan', 'decision',
    'error', 'escalation',
    'evaluation', 'info'
  ));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_tool ON events(tool_name) WHERE tool_name IS NOT NULL;

-- ============================================================================
-- Evaluations table (new)
-- ============================================================================

CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  
  -- Scores (0.0 to 1.0)
  correctness REAL CHECK (correctness IS NULL OR (correctness >= 0.0 AND correctness <= 1.0)),
  efficiency REAL CHECK (efficiency IS NULL OR (efficiency >= 0.0 AND efficiency <= 1.0)),
  honesty REAL CHECK (honesty IS NULL OR (honesty >= 0.0 AND honesty <= 1.0)),
  safety REAL CHECK (safety IS NULL OR (safety >= 0.0 AND safety <= 1.0)),
  
  -- Details
  flags JSONB DEFAULT '[]'::jsonb,
  feedback TEXT,
  recommendations JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  evaluated_by VARCHAR(50) NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- One evaluation per job (can be updated)
  CONSTRAINT unique_job_evaluation UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_job ON evaluations(job_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_scores ON evaluations(correctness, efficiency, honesty, safety);

-- ============================================================================
-- Truth packs table - add missing columns from migration 004
-- ============================================================================

-- Add missing columns to truth_packs (table created in migration 004 with minimal schema)
ALTER TABLE truth_packs
  ADD COLUMN IF NOT EXISTS input_raw TEXT,
  ADD COLUMN IF NOT EXISTS input_normalized TEXT,
  ADD COLUMN IF NOT EXISTS input_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS output_logline TEXT,
  ADD COLUMN IF NOT EXISTS output_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS grammar_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rule_matched VARCHAR(100),
  ADD COLUMN IF NOT EXISTS entities_captured JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS selection_trace TEXT,
  ADD COLUMN IF NOT EXISTS selection_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS merkle_leaves JSONB,
  ADD COLUMN IF NOT EXISTS signature_algorithm VARCHAR(20),
  ADD COLUMN IF NOT EXISTS signature_public_key TEXT,
  ADD COLUMN IF NOT EXISTS signature_value TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Update merkle_root type if needed (was TEXT in 004, now VARCHAR(128))
ALTER TABLE truth_packs ALTER COLUMN merkle_root TYPE VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_truth_packs_merkle ON truth_packs(merkle_root);
CREATE INDEX IF NOT EXISTS idx_truth_packs_input ON truth_packs(input_hash) WHERE input_hash IS NOT NULL;

-- Add foreign key from jobs to truth_packs if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'jobs_proof_ref_fkey'
  ) THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_proof_ref_fkey 
      FOREIGN KEY (proof_ref) REFERENCES truth_packs(id);
  END IF;
END $$;

