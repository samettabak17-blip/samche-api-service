CREATE TABLE IF NOT EXISTS knowledge_gap_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  channel_type VARCHAR(24) NOT NULL CHECK (channel_type IN ('WHATSAPP', 'WEB_CHAT', 'AI_GUIDE')),
  signal_type VARCHAR(48) NOT NULL,
  redacted_question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, conversation_id, message_id, signal_type),
  FOREIGN KEY (assistant_id, tenant_id) REFERENCES ai_assistants(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (conversation_id, tenant_id) REFERENCES conversations(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (message_id, tenant_id) REFERENCES conversation_messages(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_knowledge_gap_signals_tenant_assistant
  ON knowledge_gap_signals (tenant_id, assistant_id, created_at DESC);

