CREATE TABLE IF NOT EXISTS tenant_plan_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  previous_plan_code VARCHAR(32) NOT NULL REFERENCES platform_plans(code),
  new_plan_code VARCHAR(32) NOT NULL REFERENCES platform_plans(code),
  changed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_source VARCHAR(48) NOT NULL CHECK (change_source IN ('OWNER_MANUAL_CHANGE')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_change_audit_tenant
  ON tenant_plan_change_audit (tenant_id, changed_at DESC);
