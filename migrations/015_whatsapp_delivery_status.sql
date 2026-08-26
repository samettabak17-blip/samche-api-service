-- Provider-correlated outbound WhatsApp delivery state.
-- The message identifier comes exclusively from the Graph API response and is
-- later updated only by tenant-mapped WhatsApp status webhooks.
ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_failure_code VARCHAR(80);

ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS chk_conversation_message_delivery_status;

ALTER TABLE conversation_messages
  ADD CONSTRAINT chk_conversation_message_delivery_status
  CHECK (delivery_status IS NULL OR delivery_status IN ('SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'));

CREATE INDEX IF NOT EXISTS idx_conversation_messages_tenant_external_message
  ON conversation_messages (tenant_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
