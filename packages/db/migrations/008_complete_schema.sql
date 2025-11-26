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
-- Truth packs table (if not exists from migration 004)
-- ============================================================================

CREATE TABLE IF NOT EXISTS truth_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Content
  input_raw TEXT NOT NULL,
  input_normalized TEXT NOT NULL,
  input_hash VARCHAR(64) NOT NULL,
  
  output_logline TEXT NOT NULL,
  output_hash VARCHAR(64) NOT NULL,
  
  -- Translation trace
  grammar_id VARCHAR(100) NOT NULL,
  rule_matched VARCHAR(100),
  entities_captured JSONB DEFAULT '{}'::jsonb,
  selection_trace TEXT,
  selection_hash VARCHAR(64),
  
  -- Merkle commitment
  merkle_root VARCHAR(128) NOT NULL,
  merkle_leaves JSONB NOT NULL,
  
  -- Optional signature
  signature_algorithm VARCHAR(20),
  signature_public_key TEXT,
  signature_value TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_truth_packs_merkle ON truth_packs(merkle_root);
CREATE INDEX IF NOT EXISTS idx_truth_packs_input ON truth_packs(input_hash);

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

