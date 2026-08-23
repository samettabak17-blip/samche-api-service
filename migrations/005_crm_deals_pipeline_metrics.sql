-- CRM Deals / Pipeline / Metrics extension (staging)
-- Extends the existing CRM foundation without replacing its tables or routes.

ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS probability SMALLINT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS source VARCHAR(80);
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE crm_deals d
   SET contact_id = l.contact_id
  FROM crm_leads l
 WHERE d.contact_id IS NULL
   AND l.id = d.lead_id
   AND l.tenant_id = d.tenant_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm_deals WHERE contact_id IS NULL) THEN
    RAISE EXCEPTION 'crm_deals contact backfill failed';
  END IF;
END $$;

ALTER TABLE crm_deals ALTER COLUMN contact_id SET NOT NULL;
ALTER TABLE crm_deals ALTER COLUMN lead_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_deals_contact') THEN
    ALTER TABLE crm_deals
      ADD CONSTRAINT fk_crm_deals_contact
      FOREIGN KEY (contact_id, tenant_id)
      REFERENCES crm_contacts(id, tenant_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_deals_probability') THEN
    ALTER TABLE crm_deals
      ADD CONSTRAINT chk_crm_deals_probability
      CHECK (probability IS NULL OR probability BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_contact ON crm_deals(tenant_id, contact_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_owner ON crm_deals(tenant_id, owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_open_stage
  ON crm_deals(tenant_id, pipeline_stage_id, updated_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_created ON crm_deals(tenant_id, created_at DESC);
