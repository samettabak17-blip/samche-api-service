-- Opaque, scoped public Guide resume tokens. Browser storage never carries
-- Guide context, tenant facts or provider state; it stores only the token.
CREATE TABLE IF NOT EXISTS guide_public_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  session_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  domain_id UUID NOT NULL REFERENCES guide_domains(id) ON DELETE RESTRICT,
  experience_version INTEGER NOT NULL CHECK (experience_version > 0),
  preview_mode BOOLEAN NOT NULL DEFAULT FALSE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_guide_public_session_assistant
    FOREIGN KEY (assistant_id, tenant_id) REFERENCES ai_assistants(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_guide_public_session_channel
    FOREIGN KEY (channel_id, tenant_id) REFERENCES tenant_channels(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_guide_public_sessions_scope_expiry
  ON guide_public_sessions (tenant_id, assistant_id, channel_id, domain_id, experience_version, preview_mode, expires_at);
