-- Live Inbox + Human Handoff (staging)
-- This migration is intentionally idempotent because migrations run at service startup.

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'tenant_channels'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%channel_type%'
  LOOP
    EXECUTE format('ALTER TABLE tenant_channels DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_tenant_channels_channel_type'
      AND conrelid = 'tenant_channels'::regclass
  ) THEN
    ALTER TABLE tenant_channels
      ADD CONSTRAINT ck_tenant_channels_channel_type
      CHECK (channel_type IN ('WEB_CHAT', 'WHATSAPP', 'SAMCHEGUIDE'));
  END IF;
END $$;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handling_mode VARCHAR(20) NOT NULL DEFAULT 'AI',
  ADD COLUMN IF NOT EXISTS assigned_agent_user_id UUID,
  ADD COLUMN IF NOT EXISTS handoff_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handoff_reason VARCHAR(255),
  ADD COLUMN IF NOT EXISTS handling_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_conversations_handling_mode'
      AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT ck_conversations_handling_mode
      CHECK (handling_mode IN ('AI', 'HUMAN', 'PAUSED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_conversations_assigned_agent'
      AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT fk_conversations_assigned_agent
      FOREIGN KEY (tenant_id, assigned_agent_user_id)
      REFERENCES tenant_users(tenant_id, user_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS actor_user_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_conversation_messages_actor'
      AND conrelid = 'conversation_messages'::regclass
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT fk_conversation_messages_actor
      FOREIGN KEY (actor_user_id)
      REFERENCES users(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS channel_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key VARCHAR(100) NOT NULL UNIQUE,
  integration_type VARCHAR(50) NOT NULL CHECK (integration_type IN ('SAMCHEGUIDE')),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel_id UUID NOT NULL,
  assistant_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_channel_integrations_channel
    FOREIGN KEY (channel_id, tenant_id)
    REFERENCES tenant_channels(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_channel_integrations_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS conversation_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  actor_user_id UUID,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
    'TAKEOVER', 'RETURN_TO_AI', 'PAUSE', 'RESUME', 'CLOSE',
    'ASSIGNMENT', 'HANDOFF_REQUESTED', 'HUMAN_MESSAGE'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_conversation_audit_events_conversation
    FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_conversation_audit_events_actor
    FOREIGN KEY (actor_user_id)
    REFERENCES users(id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_messages_idempotency
  ON conversation_messages(conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_activity
  ON conversations(tenant_id, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_handling
  ON conversations(tenant_id, handling_mode, status);

CREATE INDEX IF NOT EXISTS idx_channel_integrations_tenant
  ON channel_integrations(tenant_id, enabled);

CREATE INDEX IF NOT EXISTS idx_conversation_audit_events_conversation
  ON conversation_audit_events(tenant_id, conversation_id, created_at ASC);
