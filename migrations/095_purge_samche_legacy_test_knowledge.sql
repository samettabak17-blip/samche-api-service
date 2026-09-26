-- Migration 095: Purge All Legacy and Synthetic Test Knowledge from SamChe Staging Tenant
-- Completely removes historical Task 6, Nova Crest, PDF Manual Acceptance Test, and synthetic fixture data.
-- Preserves all 7 legitimate canonical SamChe knowledge sources, embeddings, and active assistant configurations.
-- Safe, bounded, auditable, and idempotent.

BEGIN;

DO $$
DECLARE
  t_id UUID;
  legacy_doc_ids UUID[];
  legitimate_titles TEXT[] := ARRAY[
    'SamChe Company Kurumsal Profil, İletişim ve Banka Bilgileri',
    'Dubai ve BAE Oturum Türleri ve Sponsorlu Oturum Çözümleri',
    'BAE Aile Vizeleri (Family Visa) ve Sağlık Sigortası Sistemi',
    'Umm Al Quwain Freelance Permit ve Meslek Diploma Eşleştirme Tablosu',
    'BAE Şirket Kurulumu — Mainland ve Free Zone Karşılaştırması',
    'Şirket Kurulumu Sonrası Süreçler — Banka Hesabı, Kurumlar Vergisi ve Muhasebe',
    'SamChe Danışmanlık Ücreti, Randevu ve Hizmet Kuralları'
  ];
BEGIN
  -- Target only the verified SamChe staging tenant
  FOR t_id IN
    SELECT id FROM tenants
     WHERE id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'::uuid
        OR name = 'SamChe Company LLC'
  LOOP
    -- 1. Identify all legacy/test/synthetic knowledge base documents
    SELECT ARRAY_AGG(id) INTO legacy_doc_ids
      FROM knowledge_base_documents
     WHERE tenant_id = t_id
       AND NOT (title = ANY(legitimate_titles))
       AND (
         title ILIKE '%nova_crest%'
         OR title ILIKE '%Nova Crest%'
         OR title ILIKE '%PDF Manual Acceptance Test%'
         OR title ILIKE '%Manual Acceptance Test%'
         OR title ILIKE '%Meridian Arc%'
         OR title ILIKE '%Technology Consultancy%'
         OR title ILIKE '%Technology Services%'
         OR title ILIKE '%Legacy Tech%'
         OR title ILIKE '%Enterprise Architecture%'
         OR title ILIKE '%Silver Bridge%'
         OR title ILIKE '%Project Atlas%'
         OR title ILIKE '%Project Harbor%'
         OR title ILIKE '%Project Vela%'
         OR title ILIKE '%cobalt lantern%'
         OR title ILIKE '%task6_e2e%'
         OR title ILIKE '%__ci_%'
         OR content ILIKE '%Nova Crest%'
         OR content ILIKE '%Meridian Arc%'
         OR content ILIKE '%Foundation Launch Package%'
         OR content ILIKE '%Growth Accelerator Package%'
         OR content ILIKE '%Silver Bridge Protocol%'
         OR content ILIKE '%Enterprise Architecture Review%'
         OR content ILIKE '%Project Atlas%'
         OR content ILIKE '%Project Harbor%'
         OR content ILIKE '%Project Vela%'
         OR content ILIKE '%Additional team member onboarding%'
         OR content ILIKE '%cobalt lantern%'
         OR content ILIKE '%task6_e2e%'
       );

    IF legacy_doc_ids IS NOT NULL AND ARRAY_LENGTH(legacy_doc_ids, 1) > 0 THEN
      DELETE FROM knowledge_candidate_image_evidence WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_candidate_evidence WHERE tenant_id = t_id AND chunk_id IN (SELECT id FROM knowledge_chunks WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids));
      DELETE FROM knowledge_candidate_evidence WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_materialized_source_provenance WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM business_identity_source_evidence WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_source_business_identity_assignment_events WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_source_business_identities WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_source_assistants WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_source_extraction_segments WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_entity_media WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_entities WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_processing_jobs WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_chunks WHERE tenant_id = t_id AND source_id = ANY(legacy_doc_ids);
      DELETE FROM knowledge_base_documents WHERE tenant_id = t_id AND id = ANY(legacy_doc_ids);
    END IF;

    -- 2. Remove orphaned chunks/embeddings that still contain legacy fixture text
    DELETE FROM knowledge_candidate_evidence
     WHERE tenant_id = t_id
       AND chunk_id IN (
         SELECT id FROM knowledge_chunks
          WHERE tenant_id = t_id
            AND (
              content ILIKE '%Nova Crest%'
              OR content ILIKE '%Meridian Arc%'
              OR content ILIKE '%Foundation Launch Package%'
              OR content ILIKE '%Growth Accelerator Package%'
              OR content ILIKE '%Silver Bridge Protocol%'
              OR content ILIKE '%Enterprise Architecture Review%'
              OR content ILIKE '%Project Atlas%'
              OR content ILIKE '%Project Harbor%'
              OR content ILIKE '%Project Vela%'
              OR content ILIKE '%cobalt lantern%'
              OR content ILIKE '%task6_e2e%'
            )
       );

    DELETE FROM knowledge_chunks
     WHERE tenant_id = t_id
       AND (
         content ILIKE '%Nova Crest%'
         OR content ILIKE '%Meridian Arc%'
         OR content ILIKE '%Foundation Launch Package%'
         OR content ILIKE '%Growth Accelerator Package%'
         OR content ILIKE '%Silver Bridge Protocol%'
         OR content ILIKE '%Enterprise Architecture Review%'
         OR content ILIKE '%Project Atlas%'
         OR content ILIKE '%Project Harbor%'
         OR content ILIKE '%Project Vela%'
         OR content ILIKE '%cobalt lantern%'
         OR content ILIKE '%task6_e2e%'
       );

    -- 3. Remove legacy candidates and evidence
    DELETE FROM knowledge_candidate_evidence
     WHERE tenant_id = t_id
       AND candidate_id IN (
         SELECT id FROM knowledge_candidates
          WHERE tenant_id = t_id
            AND (
              proposed_title ILIKE '%Nova Crest%'
              OR proposed_title ILIKE '%Meridian Arc%'
              OR proposed_title ILIKE '%Foundation Launch%'
              OR proposed_title ILIKE '%Growth Accelerator%'
              OR proposed_title ILIKE '%Enterprise Architecture%'
              OR proposed_title ILIKE '%Silver Bridge Protocol%'
              OR proposed_content ILIKE '%Nova Crest%'
              OR proposed_content ILIKE '%Meridian Arc%'
              OR proposed_content ILIKE '%Foundation Launch Package%'
              OR proposed_content ILIKE '%Growth Accelerator Package%'
              OR proposed_content ILIKE '%Silver Bridge Protocol%'
              OR proposed_content ILIKE '%Enterprise Architecture Review%'
              OR proposed_content ILIKE '%Project Atlas%'
              OR proposed_content ILIKE '%Project Harbor%'
              OR proposed_content ILIKE '%Project Vela%'
            )
       );

    DELETE FROM knowledge_candidates
     WHERE tenant_id = t_id
       AND (
         proposed_title ILIKE '%Nova Crest%'
         OR proposed_title ILIKE '%Meridian Arc%'
         OR proposed_title ILIKE '%Foundation Launch%'
         OR proposed_title ILIKE '%Growth Accelerator%'
         OR proposed_title ILIKE '%Enterprise Architecture%'
         OR proposed_title ILIKE '%Silver Bridge Protocol%'
         OR proposed_content ILIKE '%Nova Crest%'
         OR proposed_content ILIKE '%Meridian Arc%'
         OR proposed_content ILIKE '%Foundation Launch Package%'
         OR proposed_content ILIKE '%Growth Accelerator Package%'
         OR proposed_content ILIKE '%Silver Bridge Protocol%'
         OR proposed_content ILIKE '%Enterprise Architecture Review%'
         OR proposed_content ILIKE '%Project Atlas%'
         OR proposed_content ILIKE '%Project Harbor%'
         OR proposed_content ILIKE '%Project Vela%'
       );


    -- 4. Remove legacy knowledge gaps and signals
    DELETE FROM knowledge_gap_signals
     WHERE tenant_id = t_id
       AND gap_id IN (
         SELECT id FROM knowledge_gaps
          WHERE tenant_id = t_id
            AND (
              query_text ILIKE '%Nova Crest%'
              OR query_text ILIKE '%Meridian Arc%'
              OR query_text ILIKE '%Foundation Launch%'
              OR query_text ILIKE '%Growth Accelerator%'
              OR query_text ILIKE '%Enterprise Architecture%'
              OR topic ILIKE '%Technology Consultancy%'
            )
       );

    DELETE FROM knowledge_gaps
     WHERE tenant_id = t_id
       AND (
         query_text ILIKE '%Nova Crest%'
         OR query_text ILIKE '%Meridian Arc%'
         OR query_text ILIKE '%Foundation Launch%'
         OR query_text ILIKE '%Growth Accelerator%'
         OR query_text ILIKE '%Enterprise Architecture%'
         OR topic ILIKE '%Technology Consultancy%'
       );

    -- 5. Clean up any superseded legacy business profile versions
    DELETE FROM business_profile_versions
     WHERE tenant_id = t_id
       AND (
         profile_data->>'company_identity' ILIKE '%Nova Crest%'
         OR profile_data->>'company_identity' ILIKE '%Meridian Arc%'
         OR profile_data->>'company_identity' ILIKE '%Technology Consultancy%'
         OR profile_data->>'industry' ILIKE '%Technology Consultancy%'
         OR profile_data::text ILIKE '%Foundation Launch Package%'
         OR profile_data::text ILIKE '%Growth Accelerator Package%'
         OR profile_data::text ILIKE '%Silver Bridge Protocol%'
       );

    -- 6. Clean up any superseded legacy assistant configuration versions
    DELETE FROM assistant_configuration_versions
     WHERE tenant_id = t_id
       AND (
         configuration_data->>'assistant_identity' ILIKE '%Technology Consultancy%'
         OR configuration_data->>'assistant_identity' ILIKE '%Nova Crest%'
         OR configuration_data->>'assistant_identity' ILIKE '%Meridian Arc%'
         OR configuration_data::text ILIKE '%Foundation Launch Package%'
         OR configuration_data::text ILIKE '%Growth Accelerator Package%'
         OR configuration_data::text ILIKE '%Silver Bridge Protocol%'
       );

    -- 7. Clean up any legacy assistant recommendations
    DELETE FROM assistant_knowledge_recommendations
     WHERE tenant_id = t_id
       AND (
         recommendation_data::text ILIKE '%Nova Crest%'
         OR recommendation_data::text ILIKE '%Meridian Arc%'
         OR recommendation_data::text ILIKE '%Foundation Launch Package%'
         OR recommendation_data::text ILIKE '%Growth Accelerator Package%'
         OR recommendation_data::text ILIKE '%Silver Bridge Protocol%'
         OR recommendation_data::text ILIKE '%Technology Consultancy%'
       );
  END LOOP;
END $$;

COMMIT;
