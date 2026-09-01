BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONSUMED', 'REVOKED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_pending_user ON password_reset_tokens(user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry ON password_reset_tokens(status, expires_at);

ALTER TABLE customer_invitation_outbox ALTER COLUMN invitation_id DROP NOT NULL;
ALTER TABLE customer_invitation_outbox ADD COLUMN IF NOT EXISTS password_reset_token_id UUID REFERENCES password_reset_tokens(id) ON DELETE RESTRICT;
ALTER TABLE customer_invitation_outbox DROP CONSTRAINT IF EXISTS customer_invitation_outbox_authority_check;
ALTER TABLE customer_invitation_outbox ADD CONSTRAINT customer_invitation_outbox_authority_check CHECK (
  (invitation_id IS NOT NULL AND password_reset_token_id IS NULL)
  OR (invitation_id IS NULL AND password_reset_token_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_outbox_delivery ON customer_invitation_outbox(password_reset_token_id, template_version) WHERE password_reset_token_id IS NOT NULL;

COMMIT;
