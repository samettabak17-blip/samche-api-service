-- Repair legacy approved image candidates that predate image-evidence persistence.
-- The only accepted recovery key is the original deterministic candidate fingerprint:
-- tenant_id : assistant_id-or-empty : source_id : extraction_hash : segment_order.
-- This deliberately does not infer identity from tenant membership or canonical text.
WITH candidate_segment_matches AS (
  SELECT candidate.tenant_id,
         candidate.id AS candidate_id,
         candidate.proposed_content,
         segment.id AS segment_id,
         segment.source_id,
         segment.extraction_version,
         segment.extraction_hash,
         segment.segment_order,
         segment.role,
         segment.role_confidence,
         segment.source_locator
    FROM knowledge_candidates candidate
    JOIN knowledge_source_extraction_segments segment
      ON segment.tenant_id = candidate.tenant_id
     AND segment.is_current = TRUE
     AND segment.role = 'BUSINESS'
    JOIN knowledge_base_documents source
      ON source.id = segment.source_id
     AND source.tenant_id = segment.tenant_id
   WHERE candidate.status = 'APPROVED'
     AND candidate.image_semantic_version = '1'
     AND candidate.candidate_fingerprint = encode(digest(
       candidate.tenant_id::text || ':' || COALESCE(candidate.assistant_id::text, '') || ':' ||
       segment.source_id::text || ':' || segment.extraction_hash || ':' || segment.segment_order::text,
       'sha256'
     ), 'hex')
     AND source.mime_type IN ('image/jpeg', 'image/png')
     AND NOT EXISTS (
       SELECT 1
         FROM knowledge_candidate_image_evidence existing
        WHERE existing.tenant_id = candidate.tenant_id
          AND existing.candidate_id = candidate.id
     )
), uniquely_matched_candidates AS (
  SELECT candidate_id
    FROM candidate_segment_matches
   GROUP BY candidate_id
  HAVING COUNT(*) = 1
)
INSERT INTO knowledge_candidate_image_evidence (
  tenant_id, candidate_id, source_id, segment_id, extraction_version, extraction_hash,
  segment_order, role, role_confidence, normalized_text, evidence_kind, source_locator,
  semantic_category, canonical_text
)
SELECT matched.tenant_id, matched.candidate_id, matched.source_id, matched.segment_id,
       matched.extraction_version, matched.extraction_hash, matched.segment_order,
       matched.role, matched.role_confidence, matched.proposed_content, 'PRIMARY',
       matched.source_locator, 'DURABLE_BUSINESS_FACT', matched.proposed_content
  FROM candidate_segment_matches matched
  JOIN uniquely_matched_candidates unique_match
    ON unique_match.candidate_id = matched.candidate_id
ON CONFLICT DO NOTHING;

-- Reconstruct materialized-source provenance only from the recovered evidence chain.
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

-- A materialized canonical source inherits a Business Identity only if all its
-- trusted original evidence sources resolve to exactly one explicit identity.
WITH candidate_identity_links AS (
  SELECT candidate.tenant_id,
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
