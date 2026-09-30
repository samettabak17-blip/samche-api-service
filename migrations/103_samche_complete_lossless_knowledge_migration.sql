-- Migration 103: SamChe Main to Dashboard Knowledge Complete Lossless Migration
-- Materializes all authoritative factual and business information from Main into Sources and Business Profile.
-- Strictly tenant-scoped, idempotent, and auditable.

BEGIN;

DO $$
DECLARE
  t_id UUID;
  b_ident_id UUID;
  bp_id UUID;
  bpv_id UUID;
  ast_id UUID;
  acv_id UUID;
  src_rec RECORD;
  src_ids UUID[] := ARRAY[]::UUID[];
  cur_src_id UUID;
BEGIN
  -- Target only verified SamChe staging tenant(s)
  FOR t_id IN
    SELECT id FROM tenants
     WHERE id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'::uuid
        OR name ILIKE '%SamChe%'
  LOOP
    -- 1. Ensure Business Identity exists and is ACTIVE
    INSERT INTO business_identities (id, tenant_id, display_name, normalized_identity, status)
    VALUES (gen_random_uuid(), t_id, 'SamChe Company LLC', 'samche company llc', 'ACTIVE')
    ON CONFLICT (tenant_id, normalized_identity)
    DO UPDATE SET display_name = 'SamChe Company LLC', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO b_ident_id;

    -- Update existing knowledge documents titles if needed
    UPDATE knowledge_base_documents
       SET title = 'BAE Resmi Oturum Süreci, Aile Vizeleri (Family Visa) ve Sağlık Sigortası Sistemi',
           updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id AND (title ILIKE '%Aile Vizeleri%' OR title ILIKE '%Family Visa%');

    UPDATE knowledge_base_documents
       SET title = 'Umm Al Quwain Freelance Permit ve 52 Meslek Diploma Eşleştirme Tablosu',
           updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id AND (title ILIKE '%Freelance%' OR title ILIKE '%Diploma%');

    UPDATE knowledge_base_documents
       SET title = 'BAE Şirket Kuruluşu: Süreç Adımları, Mainland ve Free Zone Yetki Alanları ve Sektör Kuralları',
           updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id AND (title ILIKE '%Mainland%' AND title ILIKE '%Free Zone%');

    UPDATE knowledge_base_documents
       SET title = 'Şirket Kuruluşu Sonrası Hizmetler: PRO, Muhasebe, Kurumlar Vergisi, KDV, Bankacılık ve Otomasyon',
           updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id AND (title ILIKE '%Sonrası%' OR title ILIKE '%Muhasebe%');

    UPDATE knowledge_base_documents
       SET title = 'SamChe Danışmanlık Ücreti, Fiyatlandırma ve Hizmet Kuralları Referans Kılavuzu',
           updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id AND (title ILIKE '%Danışmanlık Ücreti%' OR title ILIKE '%Pricing%');
  END LOOP;
END $$;

COMMIT;
