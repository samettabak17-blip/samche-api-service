-- Track processing attempts on durable contextual follow-up jobs for maximum-attempt protection.
ALTER TABLE conversation_scheduled_jobs
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
