-- Task 6 Slice 4: image extraction candidate provenance and deterministic dedupe.
ALTER TABLE knowledge_candidates
  ADD COLUMN IF NOT EXISTS candidate_fingerprint CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_candidates_tenant_fingerprint
  ON knowledge_candidates (tenant_id, candidate_fingerprint)
  WHERE candidate_fingerprint IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_knowledge_image_segments_id_tenant') THEN
    ALTER TABLE knowledge_source_extraction_segments
      ADD CONSTRAINT uq_knowledge_image_segments_id_tenant UNIQUE (id, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_candidate_image_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL,
  source_id UUID NOT NULL,
  segment_id UUID NOT NULL,
  extraction_version VARCHAR(32) NOT NULL,
  extraction_hash CHAR(64) NOT NULL,
  segment_order INTEGER NOT NULL CHECK (segment_order >= 0),
  role VARCHAR(16) NOT NULL CHECK (role IN ('BUSINESS', 'CUSTOMER', 'UNKNOWN')),
  role_confidence NUMERIC(4,3) NOT NULL CHECK (role_confidence >= 0 AND role_confidence <= 1),
  normalized_text TEXT NOT NULL,
  evidence_kind VARCHAR(24) NOT NULL CHECK (evidence_kind IN ('PRIMARY', 'SUPPORTING_CONTEXT')),
  source_locator JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_knowledge_image_evidence_candidate
    FOREIGN KEY (candidate_id, tenant_id)
    REFERENCES knowledge_candidates(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_image_evidence_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_image_evidence_segment
    FOREIGN KEY (segment_id, tenant_id)
    REFERENCES knowledge_source_extraction_segments(id, tenant_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_image_evidence_segment_kind
  ON knowledge_candidate_image_evidence (tenant_id, candidate_id, segment_id, evidence_kind);

CREATE INDEX IF NOT EXISTS idx_knowledge_image_evidence_candidate
  ON knowledge_candidate_image_evidence (tenant_id, candidate_id, segment_order);
