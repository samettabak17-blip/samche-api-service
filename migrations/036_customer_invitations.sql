-- Tenant-scoped invitation authority. Raw invitation tokens are never stored here.
BEGIN;

CREATE TABLE IF NOT EXISTS customer_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  tenant_role VARCHAR(16) NOT NULL CHECK (tenant_role IN ('ADMIN', 'AGENT')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONSUMED', 'REVOKED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_invitations_lifecycle_timestamps_check CHECK (
    (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
    AND (status <> 'REVOKED' OR revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_invitations_pending_user_tenant
  ON customer_invitations (user_id, tenant_id)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_customer_invitations_token_hash ON customer_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_customer_invitations_tenant_user_status ON customer_invitations (tenant_id, user_id, status);

COMMIT;
