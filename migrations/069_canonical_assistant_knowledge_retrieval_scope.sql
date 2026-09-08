-- Approved canonical knowledge in an assistant's active Business Profile or matching
-- its active Business Identity belongs to the assistant's runtime knowledge scope.
-- This converges historical active configurations idempotently and preserves tenant isolation.
INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
SELECT DISTINCT a.tenant_id, s.id, a.id
  FROM ai_assistants a
  JOIN assistant_configuration_versions acv
    ON acv.id = a.active_configuration_version_id
   AND acv.tenant_id = a.tenant_id
   AND acv.assistant_id = a.id
   AND acv.status = 'ACTIVE'
  JOIN business_profile_versions bpv
    ON bpv.id = acv.source_profile_version_id
   AND bpv.tenant_id = acv.tenant_id
   AND bpv.status = 'APPROVED'
  JOIN business_profiles bp
    ON bp.tenant_id = a.tenant_id
   AND bp.active_version_id = bpv.id
  JOIN knowledge_base_documents s
    ON s.tenant_id = a.tenant_id
   AND s.enabled = TRUE
   AND s.status = 'active'
   AND s.processing_status = 'READY'
   AND s.indexing_status = 'READY'
   AND (
     s.id::text = ANY(SELECT jsonb_array_elements_text(bpv.source_scope->'source_ids'))
     OR EXISTS (
       SELECT 1 FROM knowledge_materialized_source_provenance kmsp
        WHERE kmsp.tenant_id = s.tenant_id
          AND kmsp.materialized_source_id = s.id
          AND kmsp.original_source_id::text = ANY(SELECT jsonb_array_elements_text(bpv.source_scope->'source_ids'))
     )
     OR (
       s.source_type = 'CONVERSATION_CANDIDATE'
       AND EXISTS (
         SELECT 1 FROM knowledge_source_business_identities ksbi
          WHERE ksbi.tenant_id = s.tenant_id
            AND ksbi.source_id = s.id
            AND ksbi.business_identity_id = bp.business_identity_id
       )
     )
   )
 WHERE NOT EXISTS (
   SELECT 1 FROM knowledge_source_assistants existing
    WHERE existing.tenant_id = a.tenant_id
      AND existing.source_id = s.id
      AND existing.assistant_id = a.id
 )
ON CONFLICT (tenant_id, source_id, assistant_id) DO NOTHING;
