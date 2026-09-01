-- Preserve Business Identity provenance for already approved image-derived facts.
-- Only deterministic source -> candidate -> evidence relationships are copied;
-- tenant membership is deliberately not used as an identity signal.
INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
SELECT DISTINCT candidate.tenant_id, candidate.approved_source_id, identity_link.business_identity_id
  FROM knowledge_candidates candidate
  JOIN knowledge_candidate_image_evidence evidence
    ON evidence.tenant_id = candidate.tenant_id
   AND evidence.candidate_id = candidate.id
  JOIN knowledge_source_business_identities identity_link
    ON identity_link.tenant_id = evidence.tenant_id
   AND identity_link.source_id = evidence.source_id
 WHERE candidate.status = 'APPROVED'
   AND candidate.approved_source_id IS NOT NULL
ON CONFLICT DO NOTHING;
