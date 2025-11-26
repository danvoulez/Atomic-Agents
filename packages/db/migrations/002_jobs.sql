CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  goal TEXT NOT NULL,
  mode VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting_human','succeeded','failed','aborted','cancelling')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
