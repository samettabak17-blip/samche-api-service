CREATE INDEX IF NOT EXISTS idx_conversation_messages_tenant_created
  ON conversation_messages (tenant_id, created_at DESC);
