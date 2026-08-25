-- Persisted customer-requested WhatsApp human-support lifecycle state.
-- Manual operator takeover does not populate these fields.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS human_attention_state VARCHAR(20) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS human_attention_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_attention_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_support_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_support_last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_support_warning_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_support_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_support_topic_summary VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_conversations_human_attention_state'
       AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT ck_conversations_human_attention_state
      CHECK (human_attention_state IN ('NONE', 'REQUESTED', 'ACKNOWLEDGED', 'RESOLVED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_human_attention
  ON conversations(tenant_id, human_attention_state, status);
