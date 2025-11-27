-- Migration: Link Vercel Template tasks ↔ Atomic Agents jobs
-- Purpose: Enable fusion of both systems while keeping schemas separate

-- ============================================================================
-- ADD LINK COLUMNS
-- ============================================================================

-- Add job_id to tasks (if tasks table exists from Vercel Template)
-- This will be created when we merge the schemas
DO $$
BEGIN
    -- Create tasks table if it doesn't exist (from Vercel Template)
    IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'tasks') THEN
        CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            prompt TEXT NOT NULL,
            title TEXT,
            repo_url TEXT,
            selected_agent TEXT DEFAULT 'coordinator',
            selected_model TEXT,
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error', 'stopped')),
            logs JSONB DEFAULT '[]'::jsonb,
            branch_name TEXT,
            sandbox_id TEXT,
            pr_url TEXT,
            pr_number INTEGER,
            pr_status TEXT,
            progress INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            -- Link to Atomic Agents job
            job_id UUID REFERENCES jobs(id) ON DELETE SET NULL
        );
        
        CREATE INDEX idx_tasks_user_id ON tasks(user_id);
        CREATE INDEX idx_tasks_status ON tasks(status);
        CREATE INDEX idx_tasks_job_id ON tasks(job_id);
        CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
    ELSE
        -- Add job_id column if tasks table exists but column doesn't
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'tasks' AND column_name = 'job_id'
        ) THEN
            ALTER TABLE tasks ADD COLUMN job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks(job_id);
        END IF;
    END IF;
END $$;

-- Add task_id to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS task_id TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_task_id ON jobs(task_id);

-- ============================================================================
-- CREATE UNIFIED VIEW
-- ============================================================================

-- Drop existing view if exists
DROP VIEW IF EXISTS task_details;

-- Create unified view for UI queries
CREATE VIEW task_details AS
SELECT 
    t.id,
    t.user_id,
    t.prompt,
    t.title,
    t.repo_url,
    t.selected_agent,
    t.selected_model,
    t.status AS task_status,
    t.logs,
    t.branch_name,
    t.sandbox_id,
    t.pr_url,
    t.pr_number,
    t.pr_status,
    t.progress,
    t.created_at,
    t.updated_at,
    t.completed_at,
    -- Atomic Agents job info
    j.id AS job_id,
    j.trace_id,
    j.mode,
    j.agent_type,
    j.status AS job_status,
    j.repo_path,
    j.goal,
    j.step_cap,
    j.token_cap,
    j.cost_cap_cents,
    j.steps_used,
    j.tokens_used,
    j.cost_used_cents,
    j.current_action,
    j.started_at AS job_started_at,
    j.finished_at AS job_completed_at,
    j.logline_span,
    j.span_hash,
    -- Aggregated events
    e.events,
    e.event_count,
    e.total_tokens,
    e.total_cost_cents,
    -- Evaluation scores (if exists)
    ev.correctness,
    ev.efficiency,
    ev.honesty,
    ev.safety,
    -- Calculate overall_score as average of available scores
    CASE 
        WHEN ev.correctness IS NOT NULL THEN 
            (COALESCE(ev.correctness, 0) + COALESCE(ev.efficiency, 0) + 
             COALESCE(ev.honesty, 0) + COALESCE(ev.safety, 0)) / 4.0
        ELSE NULL 
    END AS overall_score,
    ev.flags AS evaluation_flags,
    ev.feedback AS evaluation_feedback
FROM tasks t
LEFT JOIN jobs j ON t.job_id = j.id
LEFT JOIN LATERAL (
    SELECT 
        json_agg(
            json_build_object(
                'id', id,
                'kind', kind,
                'tool_name', tool_name,
                'summary', summary,
                'params', params,
                'result', result,
                'tokens_used', tokens_used,
                'cost_cents', cost_cents,
                'duration_ms', duration_ms,
                'created_at', created_at
            ) ORDER BY created_at
        ) AS events,
        COUNT(*) AS event_count,
        COALESCE(SUM(tokens_used), 0) AS total_tokens,
        COALESCE(SUM(cost_cents), 0) AS total_cost_cents
    FROM events 
    WHERE job_id = j.id
) e ON true
LEFT JOIN evaluations ev ON ev.job_id = j.id
WHERE t.deleted_at IS NULL;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to sync task status from job
CREATE OR REPLACE FUNCTION sync_task_status_from_job()
RETURNS TRIGGER AS $$
BEGIN
    -- Update linked task when job status changes
    UPDATE tasks 
    SET 
        status = CASE NEW.status
            WHEN 'queued' THEN 'pending'
            WHEN 'running' THEN 'processing'
            WHEN 'succeeded' THEN 'completed'
            WHEN 'failed' THEN 'error'
            WHEN 'cancelled' THEN 'stopped'
            WHEN 'waiting_human' THEN 'processing'
            ELSE 'processing'
        END,
        updated_at = NOW(),
        completed_at = CASE 
            WHEN NEW.status IN ('succeeded', 'failed', 'cancelled') THEN NOW()
            ELSE completed_at
        END
    WHERE job_id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for job status sync
DROP TRIGGER IF EXISTS job_status_sync_trigger ON jobs;
CREATE TRIGGER job_status_sync_trigger
    AFTER UPDATE OF status ON jobs
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION sync_task_status_from_job();

-- Function to calculate task progress from job budget
CREATE OR REPLACE FUNCTION calculate_task_progress(job_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
    job_record RECORD;
    progress INTEGER;
BEGIN
    SELECT steps_used, step_cap INTO job_record
    FROM jobs WHERE id = job_id_param;
    
    IF job_record IS NULL OR job_record.step_cap = 0 THEN
        RETURN 0;
    END IF;
    
    progress := LEAST(100, (job_record.steps_used::FLOAT / job_record.step_cap * 100)::INTEGER);
    RETURN progress;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE tasks IS 'Vercel Template tasks - UI/UX friendly task representation';
COMMENT ON COLUMN tasks.job_id IS 'Link to Atomic Agents job for backend processing';
COMMENT ON COLUMN jobs.task_id IS 'Link to Vercel Template task for UI display';
COMMENT ON VIEW task_details IS 'Unified view combining tasks (Vercel) with jobs/events (Atomic)';

