-- Persist the most recent reliable customer language independently from
-- substantive conversation continuity. Media-only turns use this value.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_reliable_customer_language VARCHAR(16),
  ADD COLUMN IF NOT EXISTS last_reliable_customer_language_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_last_reliable_customer_language
  ON conversations(tenant_id, last_reliable_customer_language_at DESC)
  WHERE last_reliable_customer_language IS NOT NULL;
