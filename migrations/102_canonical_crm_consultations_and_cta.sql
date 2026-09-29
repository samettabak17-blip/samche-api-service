-- Migration 102: Canonical CRM Consultations & Customer-Initiated WhatsApp CTA
-- Fully idempotent, multi-tenant generic, preserving all historical records.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lead_id UUID,
  contact_id UUID,
  conversation_id UUID,
  channel_type VARCHAR(40) NOT NULL DEFAULT 'INSTAGRAM',
  status VARCHAR(40) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  customer_name VARCHAR(255),
  instagram_username VARCHAR(255),
  phone VARCHAR(64),
  service_requested VARCHAR(255),
  activity VARCHAR(255),
  requested_time VARCHAR(255),
  timezone VARCHAR(80),
  notes TEXT,
  cta_destination VARCHAR(64),
  cta_url TEXT,
  cta_prefilled_text TEXT,
  cta_delivered_at TIMESTAMPTZ,
  cta_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_crm_consultations_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT uq_crm_consultations_conversation UNIQUE (tenant_id, conversation_id),
  CONSTRAINT fk_crm_consultations_lead FOREIGN KEY (lead_id, tenant_id)
    REFERENCES crm_leads(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_consultations_contact FOREIGN KEY (contact_id, tenant_id)
    REFERENCES crm_contacts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_consultations_conversation FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_crm_consultations_tenant_status ON crm_consultations(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_consultations_tenant_lead ON crm_consultations(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_consultations_tenant_created ON crm_consultations(tenant_id, created_at DESC);

-- Update crm_activities CHECK constraint to support CONSULTATION_CREATED
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'crm_activities'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE crm_activities DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE crm_activities
    ADD CONSTRAINT ck_crm_activities_event_type
    CHECK (event_type IN (
      'CONVERSATION_STARTED', 'LEAD_CREATED', 'LEAD_SCORE_UPDATED', 'LEAD_BECAME_HOT',
      'LEAD_ASSIGNED', 'PIPELINE_STAGE_CHANGED', 'CONVERSATION_TAKEOVER',
      'HUMAN_REPLY', 'AI_QUALIFICATION', 'DEAL_CREATED', 'DEAL_WON', 'DEAL_LOST', 'NOTE_ADDED',
      'CONSULTATION_CREATED'
    ));
END $$;

-- Configure generic qualified_lead_contact_cta in Instagram channel integrations for SamChe / staging
UPDATE channel_integrations
   SET config = jsonb_set(
     COALESCE(config, '{}'::jsonb),
     '{qualified_lead_contact_cta}',
     jsonb_build_object(
       'enabled', true,
       'provider', 'WHATSAPP',
       'destination', '+971527288586',
       'contact_name', 'Samed Bey',
       'button_label', 'WhatsApp''tan İletişime Geç',
       'dm_response_text', 'Bilgilerinizi aldım. Aşağıdaki bağlantı üzerinden WhatsApp''tan doğrudan iletişime geçebilirsiniz:'
     ),
     true
   )
 WHERE integration_type = 'INSTAGRAM';

COMMIT;
