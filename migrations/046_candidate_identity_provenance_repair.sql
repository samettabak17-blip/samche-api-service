-- Repair approved image-derived source provenance without inferring from tenant scope.
-- A candidate is eligible only when every trusted identity link visible through its
-- materialized source/evidence chain resolves to exactly one Business Identity.
WITH candidate_identity_links AS (
  SELECT candidate.tenant_id,
         candidate.id AS candidate_id,
         candidate.approved_source_id,
         array_agg(DISTINCT identity_link.business_identity_id) AS identity_ids
    FROM knowledge_candidates candidate
    JOIN knowledge_candidate_image_evidence evidence
      ON evidence.tenant_id = candidate.tenant_id
     AND evidence.candidate_id = candidate.id
    JOIN knowledge_source_business_identities identity_link
      ON identity_link.tenant_id = evidence.tenant_id
     AND identity_link.source_id = evidence.source_id
   WHERE candidate.status = 'APPROVED'
     AND candidate.approved_source_id IS NOT NULL
   GROUP BY candidate.tenant_id, candidate.id, candidate.approved_source_id
  HAVING COUNT(DISTINCT identity_link.business_identity_id) = 1
)
INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
SELECT tenant_id, approved_source_id, identity_ids[1]
  FROM candidate_identity_links
ON CONFLICT DO NOTHING;

-- Also retain the same deterministic identity on the original evidence source.
-- This makes either side of the candidate -> evidence -> source chain resolvable
-- while preserving multi-brand/conflict fail-closed behavior.
WITH candidate_identity_links AS (
  SELECT candidate.tenant_id,
         candidate.id AS candidate_id,
         array_agg(DISTINCT identity_link.business_identity_id) AS identity_ids
    FROM knowledge_candidates candidate
    JOIN knowledge_candidate_image_evidence evidence
      ON evidence.tenant_id = candidate.tenant_id
     AND evidence.candidate_id = candidate.id
    JOIN knowledge_source_business_identities identity_link
      ON identity_link.tenant_id = evidence.tenant_id
     AND identity_link.source_id = evidence.source_id
   WHERE candidate.status = 'APPROVED'
   GROUP BY candidate.tenant_id, candidate.id
  HAVING COUNT(DISTINCT identity_link.business_identity_id) = 1
)
INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
SELECT evidence.tenant_id, evidence.source_id, links.identity_ids[1]
  FROM candidate_identity_links links
  JOIN knowledge_candidate_image_evidence evidence
    ON evidence.tenant_id = links.tenant_id
   AND evidence.candidate_id = links.candidate_id
ON CONFLICT DO NOTHING;
