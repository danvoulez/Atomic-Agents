-- Migration: Add trigger for real-time dashboard updates via LISTEN/NOTIFY
-- This powers the SSE endpoint for live job status updates

-- Create notification function for events
CREATE OR REPLACE FUNCTION notify_dashboard_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Send notification with job_id and event details
  PERFORM pg_notify(
    'dashboard_events',
    json_build_object(
      'job_id', NEW.job_id,
      'type', 'event',
      'data', json_build_object(
        'id', NEW.id,
        'created_at', NEW.created_at,
        'kind', NEW.kind,
        'summary', NEW.summary,
        'tool_name', NEW.tool_name
      )
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create notification function for job status changes
CREATE OR REPLACE FUNCTION notify_job_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM pg_notify(
      'dashboard_events',
      json_build_object(
        'job_id', NEW.id,
        'type', 'status_change',
        'data', json_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'steps_used', NEW.steps_used,
          'tokens_used', NEW.tokens_used,
          'cost_used_cents', NEW.cost_used_cents
        )
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on events table
DROP TRIGGER IF EXISTS events_notify_trigger ON events;
CREATE TRIGGER events_notify_trigger
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_dashboard_event();

-- Create trigger on jobs table for status changes
DROP TRIGGER IF EXISTS jobs_status_notify_trigger ON jobs;
CREATE TRIGGER jobs_status_notify_trigger
  AFTER UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_status_change();

-- Add comment explaining the triggers
COMMENT ON FUNCTION notify_dashboard_event() IS
  'Sends PostgreSQL NOTIFY on events insert for real-time dashboard streaming';
COMMENT ON FUNCTION notify_job_status_change() IS
  'Sends PostgreSQL NOTIFY on job status change for real-time dashboard updates';
