-- Migration 077: Canonical Visitor Browsing Sessions and Universal Page / Entity Context
-- Provides tenant-scoped, session-isolated, TTL-controlled browsing context for Web Chat
-- and enables visitor entity awareness in conversations for human handoff.

CREATE TABLE IF NOT EXISTS web_chat_public_sessions (
  session_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  widget_key VARCHAR(255) NOT NULL,
  current_page JSONB,
  browsing_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_web_chat_public_session_assistant
    FOREIGN KEY (assistant_id, tenant_id) REFERENCES ai_assistants(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_web_chat_public_session_channel
    FOREIGN KEY (channel_id, tenant_id) REFERENCES tenant_channels(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_web_chat_public_sessions_tenant_lookup
  ON web_chat_public_sessions (tenant_id, session_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_web_chat_public_sessions_expiry
  ON web_chat_public_sessions (expires_at);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS visitor_context JSONB;
