-- A failed pre-transaction approval could have created a conversation-derived
-- source without ever linking it to an approved candidate or its provenance.
-- Preserve the source record for audit, but keep only this deterministic,
-- unapproved orphan shape out of retrieval until a future atomic approval
-- materializes its own canonical source.
UPDATE knowledge_base_documents source
   SET status = 'inactive', enabled = FALSE, updated_at = CURRENT_TIMESTAMP
 WHERE source.source_type = 'CONVERSATION_CANDIDATE'
   AND source.status = 'active'
   AND source.enabled = TRUE
   AND NOT EXISTS (
     SELECT 1
       FROM knowledge_candidates candidate
      WHERE candidate.tenant_id = source.tenant_id
        AND candidate.approved_source_id = source.id
   )
   AND NOT EXISTS (
     SELECT 1
       FROM knowledge_materialized_source_provenance provenance
      WHERE provenance.tenant_id = source.tenant_id
        AND provenance.materialized_source_id = source.id
   )
   AND EXISTS (
     SELECT 1
       FROM knowledge_candidates candidate
      WHERE candidate.tenant_id = source.tenant_id
        AND candidate.status IN ('DRAFT', 'NEEDS_REVIEW')
        AND candidate.proposed_title = source.title
        AND candidate.proposed_content = source.content
   );
