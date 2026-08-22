-- CRM + Lead Engine foundation (staging)
-- This migration is intentionally idempotent because all migrations execute at service startup.

CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  identity_kind VARCHAR(40) NOT NULL CHECK (identity_kind IN ('EMAIL', 'PHONE', 'EXTERNAL_CUSTOMER', 'ANONYMOUS_SESSION')),
  identity_hash CHAR(64) NOT NULL,
  first_name VARCHAR(120),
  last_name VARCHAR(120),
  display_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(64),
  language VARCHAR(32),
  country VARCHAR(100),
  source VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_crm_contacts_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_crm_contacts_identity UNIQUE (tenant_id, identity_hash)
);

CREATE TABLE IF NOT EXISTS crm_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  website VARCHAR(255),
  industry VARCHAR(160),
  country VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_crm_companies_id_tenant UNIQUE (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  stage_key VARCHAR(40) NOT NULL CHECK (stage_key IN ('NEW_LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST')),
  name VARCHAR(100) NOT NULL,
  position SMALLINT NOT NULL CHECK (position > 0),
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_crm_pipeline_stages_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_crm_pipeline_stage_key UNIQUE (tenant_id, stage_key),
  CONSTRAINT uq_crm_pipeline_stage_position UNIQUE (tenant_id, position)
);

CREATE OR REPLACE FUNCTION ensure_crm_default_pipeline(target_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO crm_pipeline_stages (tenant_id, stage_key, name, position, is_terminal)
  VALUES
    (target_tenant_id, 'NEW_LEAD', 'New Lead', 10, FALSE),
    (target_tenant_id, 'QUALIFIED', 'Qualified', 20, FALSE),
    (target_tenant_id, 'PROPOSAL', 'Proposal', 30, FALSE),
    (target_tenant_id, 'NEGOTIATION', 'Negotiation', 40, FALSE),
    (target_tenant_id, 'WON', 'Won', 50, TRUE),
    (target_tenant_id, 'LOST', 'Lost', 60, TRUE)
  ON CONFLICT (tenant_id, stage_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_default_pipeline_for_new_tenant()
RETURNS trigger AS $$
BEGIN
  PERFORM ensure_crm_default_pipeline(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tenants_crm_default_pipeline') THEN
    CREATE TRIGGER trg_tenants_crm_default_pipeline
      AFTER INSERT ON tenants
      FOR EACH ROW EXECUTE FUNCTION create_default_pipeline_for_new_tenant();
  END IF;
END $$;

SELECT ensure_crm_default_pipeline(id) FROM tenants;

CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL,
  company_id UUID,
  conversation_id UUID,
  source_channel VARCHAR(80),
  status VARCHAR(40) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'closed')),
  lead_score SMALLINT NOT NULL DEFAULT 0 CHECK (lead_score BETWEEN 0 AND 100),
  temperature VARCHAR(20) NOT NULL DEFAULT 'COLD' CHECK (temperature IN ('HOT', 'WARM', 'COLD', 'UNQUALIFIED')),
  intent VARCHAR(120),
  budget_text TEXT,
  normalized_budget NUMERIC(14,2),
  budget_currency CHAR(3),
  timeline VARCHAR(120),
  service_interest VARCHAR(255),
  assigned_user_id UUID,
  pipeline_stage_id UUID NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_crm_leads_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_crm_leads_conversation UNIQUE (tenant_id, conversation_id),
  CONSTRAINT fk_crm_leads_contact FOREIGN KEY (contact_id, tenant_id)
    REFERENCES crm_contacts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_leads_company FOREIGN KEY (company_id, tenant_id)
    REFERENCES crm_companies(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_leads_conversation FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_leads_assigned_user FOREIGN KEY (tenant_id, assigned_user_id)
    REFERENCES tenant_users(tenant_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_leads_pipeline_stage FOREIGN KEY (pipeline_stage_id, tenant_id)
    REFERENCES crm_pipeline_stages(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS crm_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  pipeline_stage_id UUID NOT NULL,
  value NUMERIC(14,2),
  currency CHAR(3),
  expected_close_date DATE,
  owner_user_id UUID,
  status VARCHAR(40) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_crm_deals_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT fk_crm_deals_lead FOREIGN KEY (lead_id, tenant_id)
    REFERENCES crm_leads(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_deals_pipeline_stage FOREIGN KEY (pipeline_stage_id, tenant_id)
    REFERENCES crm_pipeline_stages(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_deals_owner FOREIGN KEY (tenant_id, owner_user_id)
    REFERENCES tenant_users(tenant_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lead_id UUID,
  conversation_id UUID,
  actor_user_id UUID,
  event_type VARCHAR(60) NOT NULL CHECK (event_type IN (
    'CONVERSATION_STARTED', 'LEAD_CREATED', 'LEAD_SCORE_UPDATED', 'LEAD_BECAME_HOT',
    'LEAD_ASSIGNED', 'PIPELINE_STAGE_CHANGED', 'CONVERSATION_TAKEOVER',
    'HUMAN_REPLY', 'AI_QUALIFICATION', 'DEAL_CREATED', 'DEAL_WON', 'DEAL_LOST', 'NOTE_ADDED'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_crm_activities_lead FOREIGN KEY (lead_id, tenant_id)
    REFERENCES crm_leads(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_activities_conversation FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_activities_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS crm_lead_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  analysis_hash CHAR(64) NOT NULL,
  analyzed_customer_message_count INTEGER NOT NULL CHECK (analyzed_customer_message_count >= 0),
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  recommended_action TEXT,
  provider VARCHAR(80),
  model VARCHAR(160),
  model_version VARCHAR(160),
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_crm_lead_analyses_checkpoint UNIQUE (tenant_id, lead_id, analysis_hash),
  CONSTRAINT fk_crm_lead_analyses_lead FOREIGN KEY (lead_id, tenant_id)
    REFERENCES crm_leads(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_lead_analyses_conversation FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id) ON DELETE RESTRICT
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversations_crm_contact') THEN
    ALTER TABLE conversations
      ADD CONSTRAINT fk_conversations_crm_contact
      FOREIGN KEY (contact_id, tenant_id)
      REFERENCES crm_contacts(id, tenant_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_tenant_created ON crm_contacts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_stage ON crm_leads(tenant_id, pipeline_stage_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_temperature ON crm_leads(tenant_id, temperature, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_stage ON crm_deals(tenant_id, pipeline_stage_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_tenant_lead ON crm_activities(tenant_id, lead_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_crm_lead_analyses_latest ON crm_lead_analyses(tenant_id, lead_id, analyzed_at DESC);

