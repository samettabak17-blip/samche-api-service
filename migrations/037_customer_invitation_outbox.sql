-- Durable SMTP delivery intent. The envelope is AES-GCM ciphertext, never plaintext token material.
BEGIN;

CREATE TABLE IF NOT EXISTS customer_invitation_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES customer_invitations(id) ON DELETE RESTRICT,
  template_version VARCHAR(32) NOT NULL DEFAULT 'INVITATION_V1',
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_DELIVERY'
    CHECK (status IN ('PENDING_DELIVERY', 'SENDING', 'SENT', 'DELIVERY_FAILED', 'CANCELLED')),
  encrypted_envelope_ciphertext TEXT,
  envelope_iv VARCHAR(64),
  envelope_auth_tag VARCHAR(64),
  envelope_key_version VARCHAR(32),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  provider_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_invitation_outbox_envelope_check CHECK (
    (status = 'PENDING_DELIVERY' AND encrypted_envelope_ciphertext IS NOT NULL AND envelope_iv IS NOT NULL AND envelope_auth_tag IS NOT NULL)
    OR status <> 'PENDING_DELIVERY'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_invitation_outbox_delivery
  ON customer_invitation_outbox (invitation_id, template_version);
CREATE INDEX IF NOT EXISTS idx_customer_invitation_outbox_due
  ON customer_invitation_outbox (status, next_attempt_at);

COMMIT;
