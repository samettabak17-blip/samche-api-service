-- Migration 091: Canonical Subscription Plan & Entitlement Architecture
-- Establishes server-authoritative subscription definitions, billing cycles (monthly/annual with 15% discount),
-- tenant subscription assignments, usage allocations, entitlement overrides, and audit log.
-- Preserves strict tenant isolation, backward compatibility, and Super Owner governance.

BEGIN;

-- 1. Extend platform_plans table with pricing, billing period terms, included limits and capabilities
ALTER TABLE platform_plans
  ADD COLUMN IF NOT EXISTS monthly_price_aed NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS annual_price_aed NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_fee_aed NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'AED',
  ADD COLUMN IF NOT EXISTS included_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS included_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Seed / update the canonical 4-tier plan catalog:
-- Annual pricing reflects 15% discount on subscription fees (12 months * monthly_price * 0.85).
-- One-time setup fee is NOT discounted.

-- STARTER: AED 1,790/mo, Setup AED 2,500, Annual: AED 18,258/yr
INSERT INTO platform_plans (
  code, rank, display_name, customer_subtitle,
  monthly_price_aed, annual_price_aed, setup_fee_aed, currency,
  included_capabilities, included_limits, metadata, active, updated_at
) VALUES (
  'STARTER', 1, 'Starter Plan', 'Core AI Workspace',
  1790.00, 18258.00, 2500.00, 'AED',
  '["webchat", "basic_knowledge_intelligence", "page_awareness", "basic_lead_capture", "human_handoff", "standard_support", "site_intelligence"]'::jsonb,
  '{"monthly_interactions": 5000, "max_languages": 2, "max_web_chatbots": 1, "max_team_users": 1, "max_integrations": 0}'::jsonb,
  '{"support_tier": "STANDARD", "description": "Core AI Workspace with Web Chatbot, Basic Knowledge Intelligence, Page Awareness, Basic Lead Capture, Human Handoff, and Standard Support"}'::jsonb,
  TRUE, CURRENT_TIMESTAMP
)
ON CONFLICT (code) DO UPDATE SET
  rank = EXCLUDED.rank,
  display_name = EXCLUDED.display_name,
  customer_subtitle = EXCLUDED.customer_subtitle,
  monthly_price_aed = EXCLUDED.monthly_price_aed,
  annual_price_aed = EXCLUDED.annual_price_aed,
  setup_fee_aed = EXCLUDED.setup_fee_aed,
  currency = EXCLUDED.currency,
  included_capabilities = EXCLUDED.included_capabilities,
  included_limits = EXCLUDED.included_limits,
  metadata = EXCLUDED.metadata,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

-- GROWTH: AED 3,990/mo, Setup AED 5,000, Annual: AED 40,698/yr
INSERT INTO platform_plans (
  code, rank, display_name, customer_subtitle,
  monthly_price_aed, annual_price_aed, setup_fee_aed, currency,
  included_capabilities, included_limits, metadata, active, updated_at
) VALUES (
  'GROWTH', 2, 'Growth Plan', 'Multi-Channel AI Growth',
  3990.00, 40698.00, 5000.00, 'AED',
  '["webchat", "whatsapp", "basic_knowledge_intelligence", "advanced_knowledge_intelligence", "crm_integrations", "shared_inbox", "lead_qualification", "page_awareness", "basic_lead_capture", "human_handoff", "standard_support", "site_intelligence", "contextual_followup"]'::jsonb,
  '{"monthly_interactions": 20000, "max_languages": 3, "max_web_chatbots": 1, "max_team_users": 5, "max_integrations": 1}'::jsonb,
  '{"support_tier": "PRIORITY", "description": "Multi-Channel AI Growth with Web Chatbot + WhatsApp AI, Advanced Knowledge Intelligence, CRM/Booking Integration, Shared Inbox, and Lead Qualification"}'::jsonb,
  TRUE, CURRENT_TIMESTAMP
)
ON CONFLICT (code) DO UPDATE SET
  rank = EXCLUDED.rank,
  display_name = EXCLUDED.display_name,
  customer_subtitle = EXCLUDED.customer_subtitle,
  monthly_price_aed = EXCLUDED.monthly_price_aed,
  annual_price_aed = EXCLUDED.annual_price_aed,
  setup_fee_aed = EXCLUDED.setup_fee_aed,
  currency = EXCLUDED.currency,
  included_capabilities = EXCLUDED.included_capabilities,
  included_limits = EXCLUDED.included_limits,
  metadata = EXCLUDED.metadata,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;


-- BUSINESS: AED 7,990/mo, Setup AED 9,500, Annual: AED 81,498/yr
INSERT INTO platform_plans (
  code, rank, display_name, customer_subtitle,
  monthly_price_aed, annual_price_aed, setup_fee_aed, currency,
  included_capabilities, included_limits, metadata, active, updated_at
) VALUES (
  'BUSINESS', 3, 'Business Plan', 'Advanced AI Operations',
  7990.00, 81498.00, 9500.00, 'AED',
  '["webchat", "whatsapp", "guide", "basic_knowledge_intelligence", "advanced_knowledge_intelligence", "entity_awareness", "crm_integrations", "shared_inbox", "lead_qualification", "lead_scoring", "api_workflow_capabilities", "page_awareness", "basic_lead_capture", "human_handoff", "standard_support", "site_intelligence", "contextual_followup"]'::jsonb,
  '{"monthly_interactions": 50000, "max_languages": 5, "max_web_chatbots": 2, "max_team_users": 10, "max_integrations": 3}'::jsonb,
  '{"support_tier": "DEDICATED", "description": "Advanced AI Operations with Web Chatbot + WhatsApp AI + AI Guide, Entity Awareness, up to 3 Integrations, Lead Scoring, and Custom Workflows"}'::jsonb,
  TRUE, CURRENT_TIMESTAMP
)
ON CONFLICT (code) DO UPDATE SET
  rank = EXCLUDED.rank,
  display_name = EXCLUDED.display_name,
  customer_subtitle = EXCLUDED.customer_subtitle,
  monthly_price_aed = EXCLUDED.monthly_price_aed,
  annual_price_aed = EXCLUDED.annual_price_aed,
  setup_fee_aed = EXCLUDED.setup_fee_aed,
  currency = EXCLUDED.currency,
  included_capabilities = EXCLUDED.included_capabilities,
  included_limits = EXCLUDED.included_limits,
  metadata = EXCLUDED.metadata,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

-- ENTERPRISE: Starting AED 12,500/mo, Setup starting AED 20,000, Annual: AED 127,500/yr
INSERT INTO platform_plans (
  code, rank, display_name, customer_subtitle,
  monthly_price_aed, annual_price_aed, setup_fee_aed, currency,
  included_capabilities, included_limits, metadata, active, updated_at
) VALUES (
  'ENTERPRISE', 4, 'Enterprise Plan', 'Enterprise AI Workspace',
  12500.00, 127500.00, 20000.00, 'AED',
  '["webchat", "whatsapp", "guide", "basic_knowledge_intelligence", "advanced_knowledge_intelligence", "entity_awareness", "crm_integrations", "shared_inbox", "lead_qualification", "lead_scoring", "api_workflow_capabilities", "page_awareness", "basic_lead_capture", "human_handoff", "standard_support", "site_intelligence", "contextual_followup", "multiple_brands_websites", "extended_multilingual", "enterprise_integrations", "advanced_security_controls", "custom_retention_support"]'::jsonb,
  '{"monthly_interactions": 100000, "max_languages": 10, "max_web_chatbots": 5, "max_team_users": 50, "max_integrations": 10}'::jsonb,
  '{"support_tier": "ENTERPRISE_CUSTOM", "description": "Custom enterprise allocations, multiple brands, extended multilingual, enterprise integrations, advanced security, and custom retention support"}'::jsonb,
  TRUE, CURRENT_TIMESTAMP
)
ON CONFLICT (code) DO UPDATE SET
  rank = EXCLUDED.rank,
  display_name = EXCLUDED.display_name,
  customer_subtitle = EXCLUDED.customer_subtitle,
  monthly_price_aed = EXCLUDED.monthly_price_aed,
  annual_price_aed = EXCLUDED.annual_price_aed,
  setup_fee_aed = EXCLUDED.setup_fee_aed,
  currency = EXCLUDED.currency,
  included_capabilities = EXCLUDED.included_capabilities,
  included_limits = EXCLUDED.included_limits,
  metadata = EXCLUDED.metadata,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

-- 2. Create tenant_subscriptions table for server-authoritative subscription tracking
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  plan_code VARCHAR(32) NOT NULL REFERENCES platform_plans(code),
  billing_cycle VARCHAR(16) NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
  currency VARCHAR(8) NOT NULL DEFAULT 'AED',
  monthly_price_aed NUMERIC(12,2) NOT NULL DEFAULT 0,
  annual_price_aed NUMERIC(12,2) NOT NULL DEFAULT 0,
  setup_fee_aed NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELLED', 'SUSPENDED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'tenant_subscriptions_tenant_id_fkey'
       AND table_name = 'tenant_subscriptions'
  ) THEN
    ALTER TABLE tenant_subscriptions DROP CONSTRAINT tenant_subscriptions_tenant_id_fkey;
    ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_plan ON tenant_subscriptions (plan_code, status);

-- Backfill existing tenants into tenant_subscriptions
INSERT INTO tenant_subscriptions (tenant_id, plan_code, billing_cycle, currency, monthly_price_aed, annual_price_aed, setup_fee_aed, status)
SELECT
  t.id,
  t.plan_code,
  'MONTHLY',
  p.currency,
  p.monthly_price_aed,
  p.annual_price_aed,
  p.setup_fee_aed,
  'ACTIVE'
FROM tenants t
JOIN platform_plans p ON p.code = t.plan_code
ON CONFLICT (tenant_id) DO UPDATE
  SET plan_code = EXCLUDED.plan_code,
      monthly_price_aed = EXCLUDED.monthly_price_aed,
      annual_price_aed = EXCLUDED.annual_price_aed,
      setup_fee_aed = EXCLUDED.setup_fee_aed,
      currency = EXCLUDED.currency,
      updated_at = CURRENT_TIMESTAMP;

-- 3. Create tenant_entitlement_overrides table for Super Owner overrides
CREATE TABLE IF NOT EXISTS tenant_entitlement_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capability_key VARCHAR(64) NOT NULL,
  effect VARCHAR(16) NOT NULL CHECK (effect IN ('GRANT', 'DENY')),
  reason TEXT,
  granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_tenant_entitlement_overrides UNIQUE (tenant_id, capability_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_entitlement_overrides_tenant
  ON tenant_entitlement_overrides (tenant_id, capability_key);

-- 4. Create tenant_usage_allocations table for limits and tracking
CREATE TABLE IF NOT EXISTS tenant_usage_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_key VARCHAR(64) NOT NULL,
  allocated_limit INTEGER NOT NULL CHECK (allocated_limit >= 0),
  current_usage INTEGER NOT NULL DEFAULT 0 CHECK (current_usage >= 0),
  reset_interval VARCHAR(16) NOT NULL DEFAULT 'MONTHLY' CHECK (reset_interval IN ('MONTHLY', 'ANNUAL', 'NEVER')),
  last_reset_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_tenant_usage_allocations UNIQUE (tenant_id, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_allocations_tenant
  ON tenant_usage_allocations (tenant_id, metric_key);

-- Backfill default allocations for all tenants from their plan included_limits
INSERT INTO tenant_usage_allocations (tenant_id, metric_key, allocated_limit, reset_interval)
SELECT
  t.id AS tenant_id,
  lim.key AS metric_key,
  (lim.value)::text::integer AS allocated_limit,
  'MONTHLY' AS reset_interval
FROM tenants t
JOIN platform_plans p ON p.code = t.plan_code
CROSS JOIN LATERAL jsonb_each(p.included_limits) lim
ON CONFLICT (tenant_id, metric_key) DO NOTHING;

-- 5. Create tenant_entitlement_audit_log for platform governance
CREATE TABLE IF NOT EXISTS tenant_entitlement_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_type VARCHAR(48) NOT NULL,
  performed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_entitlement_audit_log_tenant
  ON tenant_entitlement_audit_log (tenant_id, created_at DESC);

-- 6. Update ensure_tenant_platform_capabilities to converge subscriptions & allocations idempotently
CREATE OR REPLACE FUNCTION ensure_tenant_platform_capabilities(
  target_tenant_id UUID,
  target_manifest_version INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  policy_uuid UUID;
  target_plan VARCHAR(32);
BEGIN
  IF target_manifest_version IS NULL OR target_manifest_version < 1 THEN
    RAISE EXCEPTION 'invalid tenant platform manifest version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = target_tenant_id) THEN
    RAISE EXCEPTION 'tenant platform target not found';
  END IF;

  SELECT plan_code INTO target_plan FROM tenants WHERE id = target_tenant_id;
  IF target_plan IS NULL THEN
    target_plan := 'STARTER';
    UPDATE tenants SET plan_code = 'STARTER' WHERE id = target_tenant_id;
  END IF;

  -- Ensure subscription record
  INSERT INTO tenant_subscriptions (
    tenant_id, plan_code, billing_cycle, currency,
    monthly_price_aed, annual_price_aed, setup_fee_aed, status
  )
  SELECT
    target_tenant_id,
    p.code,
    'MONTHLY',
    p.currency,
    p.monthly_price_aed,
    p.annual_price_aed,
    p.setup_fee_aed,
    'ACTIVE'
  FROM platform_plans p
  WHERE p.code = target_plan
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Ensure default allocations for limits
  INSERT INTO tenant_usage_allocations (tenant_id, metric_key, allocated_limit, reset_interval)
  SELECT
    target_tenant_id,
    lim.key,
    (lim.value)::text::integer,
    'MONTHLY'
  FROM platform_plans p
  CROSS JOIN LATERAL jsonb_each(p.included_limits) lim
  WHERE p.code = target_plan
  ON CONFLICT (tenant_id, metric_key) DO NOTHING;

  -- Baseline escalation policies
  INSERT INTO human_support_escalation_policies (tenant_id, event_type, enabled)
  VALUES (target_tenant_id, 'HUMAN_SUPPORT_REQUESTED', TRUE)
  ON CONFLICT (tenant_id, event_type) DO UPDATE
    SET updated_at = human_support_escalation_policies.updated_at
  RETURNING id INTO policy_uuid;

  INSERT INTO human_support_escalation_levels
    (policy_id, tenant_id, level_order, recipient_rule, acknowledgement_timeout_seconds)
  VALUES (policy_uuid, target_tenant_id, 1, 'ASSIGNED_OWNER', 300)
  ON CONFLICT (policy_id, level_order) DO UPDATE
    SET recipient_rule = EXCLUDED.recipient_rule,
        acknowledgement_timeout_seconds = EXCLUDED.acknowledgement_timeout_seconds;

  INSERT INTO human_support_escalation_levels
    (policy_id, tenant_id, level_order, recipient_rule, recipient_target, acknowledgement_timeout_seconds)
  VALUES (policy_uuid, target_tenant_id, 2, 'ROLE', '{"role": "ADMIN"}'::jsonb, 300)
  ON CONFLICT (policy_id, level_order) DO UPDATE
    SET recipient_rule = EXCLUDED.recipient_rule,
        recipient_target = EXCLUDED.recipient_target,
        acknowledgement_timeout_seconds = EXCLUDED.acknowledgement_timeout_seconds;

  INSERT INTO tenant_platform_provisioning (tenant_id, manifest_version)
  VALUES (target_tenant_id, target_manifest_version)
  ON CONFLICT (tenant_id) DO UPDATE
    SET manifest_version = GREATEST(tenant_platform_provisioning.manifest_version, EXCLUDED.manifest_version),
        updated_at = CURRENT_TIMESTAMP;
END $$;

COMMIT;

