-- Durable, tenant-scoped escalation authority. Delivery transports consume
-- instances asynchronously and cannot roll back a customer support request.
CREATE TABLE IF NOT EXISTS human_support_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  current_level INTEGER NOT NULL DEFAULT 0 CHECK (current_level >= 0),
  next_due_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(255) NOT NULL,
  policy_id UUID,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, conversation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS human_support_escalation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type VARCHAR(64) NOT NULL DEFAULT 'HUMAN_SUPPORT_REQUESTED', enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, event_type)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_human_support_escalation_policy') THEN
    ALTER TABLE human_support_escalations ADD CONSTRAINT fk_human_support_escalation_policy FOREIGN KEY (policy_id) REFERENCES human_support_escalation_policies(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS human_support_escalation_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), policy_id UUID NOT NULL REFERENCES human_support_escalation_policies(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, level_order INTEGER NOT NULL,
  recipient_rule VARCHAR(64) NOT NULL,
  recipient_target JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledgement_timeout_seconds INTEGER NOT NULL CHECK (acknowledgement_timeout_seconds >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE (policy_id, level_order)
);
ALTER TABLE human_support_escalation_levels
  ADD COLUMN IF NOT EXISTS recipient_target JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS human_support_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  escalation_id UUID NOT NULL REFERENCES human_support_escalations(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT, level_order INTEGER NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL, processing_started_at TIMESTAMPTZ, status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'RETRY', 'FAILED', 'CANCELLED')), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, idempotency_key)
);

-- Platform-default policy data, inherited by every tenant without a manual
-- customer-specific insert. An existing tenant policy (including disabled) wins.
INSERT INTO human_support_escalation_policies (tenant_id, event_type, enabled)
SELECT t.id, 'HUMAN_SUPPORT_REQUESTED', TRUE FROM tenants t
ON CONFLICT (tenant_id, event_type) DO NOTHING;

INSERT INTO human_support_escalation_levels (policy_id, tenant_id, level_order, recipient_rule, acknowledgement_timeout_seconds)
SELECT p.id, p.tenant_id, 1, 'ASSIGNED_OWNER', 300
FROM human_support_escalation_policies p
ON CONFLICT (policy_id, level_order) DO NOTHING;

CREATE OR REPLACE FUNCTION provision_human_support_escalation_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_uuid UUID;
BEGIN
  INSERT INTO human_support_escalation_policies (tenant_id, event_type, enabled)
  VALUES (NEW.id, 'HUMAN_SUPPORT_REQUESTED', TRUE)
  ON CONFLICT (tenant_id, event_type) DO NOTHING
  RETURNING id INTO policy_uuid;
  IF policy_uuid IS NULL THEN
    SELECT id INTO policy_uuid FROM human_support_escalation_policies
      WHERE tenant_id = NEW.id AND event_type = 'HUMAN_SUPPORT_REQUESTED';
  END IF;
  INSERT INTO human_support_escalation_levels (policy_id, tenant_id, level_order, recipient_rule, acknowledgement_timeout_seconds)
  VALUES (policy_uuid, NEW.id, 1, 'ASSIGNED_OWNER', 300)
  ON CONFLICT (policy_id, level_order) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tenants_human_support_escalation_policy ON tenants;
CREATE TRIGGER trg_tenants_human_support_escalation_policy
AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION provision_human_support_escalation_policy();

CREATE INDEX IF NOT EXISTS idx_human_support_escalations_due
  ON human_support_escalations(status, next_due_at);

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'conversation_audit_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE conversation_audit_events DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  ALTER TABLE conversation_audit_events ADD CONSTRAINT ck_conversation_audit_events_event_type
    CHECK (event_type IN ('TAKEOVER','RETURN_TO_AI','PAUSE','RESUME','CLOSE','ASSIGNMENT','HANDOFF_REQUESTED','HUMAN_MESSAGE','HUMAN_SUPPORT_ACKNOWLEDGED','HUMAN_SUPPORT_REQUESTED'));
END $$;
