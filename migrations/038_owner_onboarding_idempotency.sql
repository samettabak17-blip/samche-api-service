BEGIN;

CREATE TABLE IF NOT EXISTS owner_onboarding_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROCESSING'
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  response_json JSONB,
  tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_owner_onboarding_idempotency_expiry
  ON owner_onboarding_idempotency (expires_at);

COMMIT;
