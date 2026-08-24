ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS communication_language VARCHAR(16) NOT NULL DEFAULT 'und',
  ADD COLUMN IF NOT EXISTS communication_language_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_communication_language
  ON conversations(tenant_id, communication_language);
