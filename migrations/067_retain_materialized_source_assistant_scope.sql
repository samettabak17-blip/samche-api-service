-- Approved image-derived knowledge keeps the explicit assistant scope of its
-- original source. This repairs historical materialized sources idempotently;
-- it never infers scope from tenant membership or identity uniqueness.
INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
SELECT DISTINCT provenance.tenant_id, provenance.materialized_source_id, assignment.assistant_id
  FROM knowledge_materialized_source_provenance provenance
  JOIN knowledge_source_assistants assignment
    ON assignment.tenant_id = provenance.tenant_id
   AND assignment.source_id = provenance.original_source_id
 WHERE NOT EXISTS (
   SELECT 1
     FROM knowledge_source_assistants existing
    WHERE existing.tenant_id = provenance.tenant_id
      AND existing.source_id = provenance.materialized_source_id
      AND existing.assistant_id = assignment.assistant_id
 )
ON CONFLICT (tenant_id, source_id, assistant_id) DO NOTHING;

