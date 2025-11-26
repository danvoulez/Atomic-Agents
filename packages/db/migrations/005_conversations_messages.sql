ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
