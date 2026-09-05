-- Durable, tenant-scoped scheduling for contextual AI outreach. Existing
-- conversation history remains untouched; duplicate schedule identities are ignored.
CREATE TABLE IF NOT EXISTS conversation_scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL REFERENCES ai_assistants(id) ON DELETE RESTRICT,
  channel_id UUID NOT NULL REFERENCES tenant_channels(id) ON DELETE RESTRICT,
  job_type VARCHAR(64) NOT NULL CHECK (job_type IN ('CONTEXTUAL_FOLLOW_UP')),
  stage VARCHAR(32) NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'DELIVERED', 'FAILED', 'CANCELLED')),
  processing_started_at TIMESTAMPTZ,
  generated_message_id UUID REFERENCES conversation_messages(id) ON DELETE RESTRICT,
  delivered_at TIMESTAMPTZ,
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE conversation_scheduled_jobs
  ADD COLUMN IF NOT EXISTS generated_message_id UUID REFERENCES conversation_messages(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_conversation_scheduled_jobs_due
  ON conversation_scheduled_jobs (status, due_at);
