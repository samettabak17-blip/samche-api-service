CREATE TABLE IF NOT EXISTS platform_plans (
  code VARCHAR(32) PRIMARY KEY,
  rank INTEGER NOT NULL UNIQUE CHECK (rank BETWEEN 1 AND 4),
  display_name VARCHAR(80) NOT NULL,
  customer_subtitle VARCHAR(120) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO platform_plans (code, rank, display_name, customer_subtitle) VALUES
  ('STARTER', 1, 'Starter Plan', 'Core AI Workspace'),
  ('GROWTH', 2, 'Growth Plan', 'Multi-Channel AI Growth'),
  ('BUSINESS', 3, 'Business Plan', 'Advanced AI Operations'),
  ('ENTERPRISE', 4, 'Enterprise Plan', 'Enterprise AI Workspace')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_code VARCHAR(32);
UPDATE tenants SET plan_code = 'STARTER' WHERE plan_code IS NULL;
ALTER TABLE tenants ALTER COLUMN plan_code SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenants_plan_code') THEN
    ALTER TABLE tenants ADD CONSTRAINT fk_tenants_plan_code FOREIGN KEY (plan_code) REFERENCES platform_plans(code);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_plan_upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  current_plan_code VARCHAR(32) NOT NULL REFERENCES platform_plans(code),
  requested_plan_code VARCHAR(32) NOT NULL REFERENCES platform_plans(code),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  previous_plan_code VARCHAR(32) REFERENCES platform_plans(code),
  new_plan_code VARCHAR(32) REFERENCES platform_plans(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_plan_upgrade_pending_target ON tenant_plan_upgrade_requests (tenant_id, requested_plan_code) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_tenant_plan_upgrade_review ON tenant_plan_upgrade_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_plan_upgrade_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES tenant_plan_upgrade_requests(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READ')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, recipient_user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_plan_upgrade_notifications_recipient
  ON tenant_plan_upgrade_notifications (recipient_user_id, status, created_at DESC);
