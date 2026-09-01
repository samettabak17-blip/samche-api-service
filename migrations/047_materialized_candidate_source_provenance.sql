-- Retain the complete approved-candidate -> materialized-source -> original-source chain.
-- Identity remains derived from the original source's explicit trusted linkage;
-- this table deliberately never infers an identity from tenant membership.
CREATE TABLE IF NOT EXISTS knowledge_materialized_source_provenance (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  materialized_source_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  original_source_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, materialized_source_id, candidate_id, original_source_id),
  CONSTRAINT fk_materialized_candidate_source
    FOREIGN KEY (materialized_source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_materialized_candidate
    FOREIGN KEY (candidate_id, tenant_id)
    REFERENCES knowledge_candidates(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_materialized_original_source
    FOREIGN KEY (original_source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_materialized_candidate_provenance_original
  ON knowledge_materialized_source_provenance (tenant_id, original_source_id, materialized_source_id);

-- Deterministic repair for pre-provenance approved image candidates. The evidence
-- itself establishes the origin; no text or tenant-level identity assumption is used.
INSERT INTO knowledge_materialized_source_provenance
  (tenant_id, materialized_source_id, candidate_id, original_source_id)
SELECT DISTINCT candidate.tenant_id, candidate.approved_source_id, candidate.id, evidence.source_id
  FROM knowledge_candidates candidate
  JOIN knowledge_candidate_image_evidence evidence
    ON evidence.tenant_id = candidate.tenant_id
   AND evidence.candidate_id = candidate.id
 WHERE candidate.status = 'APPROVED'
   AND candidate.approved_source_id IS NOT NULL
ON CONFLICT DO NOTHING;
