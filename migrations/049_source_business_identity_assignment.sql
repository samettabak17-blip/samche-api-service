-- Explicit, human-confirmed source ownership. Tenant membership is never used
-- to infer this relationship; a source has one current explicit identity.
ALTER TABLE knowledge_source_business_identities
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assignment_origin VARCHAR(64) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';

ALTER TABLE knowledge_candidate_image_evidence
  ADD COLUMN IF NOT EXISTS business_identity_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_image_evidence_business_identity') THEN
    ALTER TABLE knowledge_candidate_image_evidence
      ADD CONSTRAINT fk_image_evidence_business_identity
      FOREIGN KEY (business_identity_id, tenant_id)
      REFERENCES business_identities(id, tenant_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_source_business_identity_assignment_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  previous_business_identity_id UUID,
  new_business_identity_id UUID NOT NULL,
  changed_by_user_id UUID NOT NULL,
  change_origin VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_source_identity_assignment_event_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_source_identity_assignment_event_new_identity
    FOREIGN KEY (new_business_identity_id, tenant_id)
    REFERENCES business_identities(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_source_business_identity_assignment_events_source
  ON knowledge_source_business_identity_assignment_events (tenant_id, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_evidence_business_identity
  ON knowledge_candidate_image_evidence (tenant_id, business_identity_id)
  WHERE business_identity_id IS NOT NULL;
