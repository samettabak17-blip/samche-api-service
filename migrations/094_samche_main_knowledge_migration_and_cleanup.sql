-- Migration 094: SamChe Main Controlled Knowledge Migration & Legacy Test Data Cleanup
-- Fully idempotent, tenant-scoped, and safe for live staging and historical tenants.

BEGIN;

DO $$
DECLARE
  t_id UUID;
  b_ident_id UUID;
  bp_id UUID;
  bpv_id UUID;
  ast_id UUID;
  acv_id UUID;
  src_1_id UUID := 'a1000001-0000-4000-8000-000000000001'::uuid;
  src_2_id UUID := 'a1000001-0000-4000-8000-000000000002'::uuid;
  src_3_id UUID := 'a1000001-0000-4000-8000-000000000003'::uuid;
  src_4_id UUID := 'a1000001-0000-4000-8000-000000000004'::uuid;
  src_5_id UUID := 'a1000001-0000-4000-8000-000000000005'::uuid;
  src_6_id UUID := 'a1000001-0000-4000-8000-000000000006'::uuid;
  src_7_id UUID := 'a1000001-0000-4000-8000-000000000007'::uuid;
  src_ids UUID[];
  legacy_src_ids UUID[];
  legacy_bpv_ids UUID[];
  legacy_acv_ids UUID[];
BEGIN
  FOR t_id IN
    SELECT id FROM tenants
     WHERE id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'::uuid
        OR name ILIKE '%SamChe%'
  LOOP
    -- 1. Remove legacy test sources and dependencies
    SELECT ARRAY_AGG(id) INTO legacy_src_ids
      FROM knowledge_base_documents
     WHERE tenant_id = t_id
       AND (
         title ILIKE '%Technology Services%'
         OR title ILIKE '%Legacy Tech%'
         OR title ILIKE '%Enterprise Architecture%'
         OR content ILIKE '%Foundation Launch Package%'
         OR content ILIKE '%Growth Accelerator Package%'
         OR content ILIKE '%Silver Bridge Protocol%'
         OR content ILIKE '%Meridian Arc Technologies%'
         OR content ILIKE '%cobalt lantern%'
         OR content ILIKE '%task6_e2e%'
       );

    IF legacy_src_ids IS NOT NULL AND ARRAY_LENGTH(legacy_src_ids, 1) > 0 THEN
      DELETE FROM knowledge_chunks WHERE tenant_id = t_id AND source_id = ANY(legacy_src_ids);
      DELETE FROM knowledge_source_assistants WHERE tenant_id = t_id AND source_id = ANY(legacy_src_ids);
      DELETE FROM knowledge_source_business_identities WHERE tenant_id = t_id AND source_id = ANY(legacy_src_ids);
      DELETE FROM knowledge_base_documents WHERE tenant_id = t_id AND id = ANY(legacy_src_ids);
    END IF;

    -- 2. Remove legacy candidates with test terms
    DELETE FROM knowledge_candidates
     WHERE tenant_id = t_id
       AND (
         proposed_title ILIKE '%Foundation Launch%'
         OR proposed_content ILIKE '%Foundation Launch%'
         OR proposed_content ILIKE '%Silver Bridge Protocol%'
         OR proposed_content ILIKE '%Meridian Arc Technologies%'
       );

    -- 3. Identify and remove legacy business profile versions
    SELECT ARRAY_AGG(id) INTO legacy_bpv_ids
      FROM business_profile_versions
     WHERE tenant_id = t_id
       AND (
         profile_data::text ILIKE '%Technology Consultancy%'
         OR profile_data::text ILIKE '%Meridian Arc Technologies%'
         OR profile_data::text ILIKE '%Foundation Launch Package%'
         OR profile_data::text ILIKE '%Silver Bridge Protocol%'
       );

    IF legacy_bpv_ids IS NOT NULL AND ARRAY_LENGTH(legacy_bpv_ids, 1) > 0 THEN
      UPDATE business_profiles
         SET active_version_id = NULL
       WHERE tenant_id = t_id AND active_version_id = ANY(legacy_bpv_ids);
      UPDATE assistant_configuration_versions
         SET source_profile_version_id = NULL
       WHERE tenant_id = t_id AND source_profile_version_id = ANY(legacy_bpv_ids);
      DELETE FROM business_profile_versions WHERE tenant_id = t_id AND id = ANY(legacy_bpv_ids);
    END IF;

    -- 4. Identify and remove legacy assistant configuration versions
    SELECT ARRAY_AGG(id) INTO legacy_acv_ids
      FROM assistant_configuration_versions
     WHERE tenant_id = t_id
       AND (
         configuration_data::text ILIKE '%Foundation Launch Package%'
         OR configuration_data::text ILIKE '%Technology Consultancy%'
         OR configuration_data::text ILIKE '%Meridian Arc Technologies%'
       );

    IF legacy_acv_ids IS NOT NULL AND ARRAY_LENGTH(legacy_acv_ids, 1) > 0 THEN
      UPDATE ai_assistants
         SET active_configuration_version_id = NULL
       WHERE tenant_id = t_id AND active_configuration_version_id = ANY(legacy_acv_ids);
      DELETE FROM assistant_configuration_versions WHERE tenant_id = t_id AND id = ANY(legacy_acv_ids);
    END IF;

    -- 5. Ensure canonical Business Identity
    INSERT INTO business_identities (id, tenant_id, display_name, normalized_identity, status)
    VALUES (gen_random_uuid(), t_id, 'SamChe Company LLC', 'samche company llc', 'ACTIVE')
    ON CONFLICT (tenant_id, normalized_identity)
    DO UPDATE SET display_name = 'SamChe Company LLC', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO b_ident_id;

    -- 6. Upsert 7 Canonical Knowledge Base Documents
    INSERT INTO knowledge_base_documents (id, tenant_id, title, content, status, source_type, mime_type, content_hash, processing_status, indexing_status, enabled)
    VALUES
      (src_1_id, t_id, 'SamChe Company Kurumsal Profil, İletişim ve Banka Bilgileri', 'SamChe Company LLC Kurumsal Bilgileri:\n\nKurumsal Rol: "DANIŞMANLIK, BAŞVURU KOORDİNASYONU VE SÜREÇ YÖNETİMİ"\nİletişim: info@samchecompany.com / +971 50 179 38 80 / Sheikh Zayed Road Latifa Tower Office No 402, Dubai\nBanka: SamChe Company LLC, USD, Wio Bank IBAN AE210860000009726414926, BIC WIOBAEADXXX\nSponsor firma detayları gizlilik politikası gereği kota rezervasyonu ve ön başvuru öncesi açıklanmaz.', 'active', 'MANUAL', 'text/plain', 'c814b7e8894ce0b615d0315fe40f533a1e27150117fb79ea0b8fa047d92c733f', 'READY', 'READY', TRUE),
      (src_2_id, t_id, 'Dubai ve BAE Oturum Türleri ve Sponsorlu Oturum Çözümleri', 'Dubai ve BAE Oturum Seçenekleri:\nSponsorlu Oturum (2 Yıllık): Toplam 13.000 AED (1. 4.000 AED kota/dosya ~10 gün teklif mektubu, 2. 8.000 AED employment visa ~30 gün e-vize, 3. 1.000 AED ID/damgalama ~30 gün). NOC belgesi ile serbest çalışma/iş kurma imkanı.', 'active', 'MANUAL', 'text/plain', 'b83e4a9057b5fb9b23b4ea176a92849b2c6a6e709e995fb248380e2f5b5b0429', 'READY', 'READY', TRUE),
      (src_3_id, t_id, 'BAE Aile Vizeleri (Family Visa) ve Sağlık Sigortası Sistemi', 'Dubai ve BAE Aile Vizeleri (Family Visa):\nÇocuklar: 4.500 AED, Eş: 6.000 AED (2 yıllık). Family Visa sadece oturumdur, çalışma izni içermez. Sağlık sigortası oturum paketlerine dahil değildir, basic paket yıllık ~800 AED.', 'active', 'MANUAL', 'text/plain', 'f3e792c019a84a6b12f458e0a12e9b8f2c3a5b6d7e8f901a2b3c4d5e6f7a8b9c', 'READY', 'READY', TRUE),
      (src_4_id, t_id, 'Umm Al Quwain Freelance Permit ve Meslek Diploma Eşleştirme Tablosu', 'Umm Al Quwain Freelance Permit + Vize: Toplam 16.800 AED.\nMeslek Eşleştirme (39 Meslek):\nActor (Diploma: NO), Software System Developer (Diploma: YES), Web Developer (Diploma: YES), Journalist (Diploma: YES), Graphic Designer (Diploma: YES), Artist (Diploma: NO), Fashion Designer (Diploma: NO), Photographer (Diploma: YES), vb.', 'active', 'MANUAL', 'text/plain', 'd8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9', 'READY', 'READY', TRUE),
      (src_5_id, t_id, 'BAE Şirket Kuruluşu: Mainland ve Free Zone Yetki Alanları ve Sektör Kuralları', 'BAE Şirket Kuruluşu Yetki Alanları:\nMainland (DET): %100 yabancı mülkiyeti, yerel ortak zorunluluğu YOKTUR. Sadece Mainland sektörleri: Perakende Mağazaları, İnşaat/Müteahhitlik, Gayrimenkul Acenteleri, Turizm/Seyahat, Araç Kiralama, Güvenlik/CCTV, Temizlik, Klinik/Tıp Merkezleri.\nFree Zone: Sanal ofis/flexi-desk, %100 mülkiyet. Meydan (Özel Altın Lisansı 40.000 AED), Dubai South, Sharjah/IFZA, RAKEZ/Ajman.', 'active', 'MANUAL', 'text/plain', 'a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8', 'READY', 'READY', TRUE),
      (src_6_id, t_id, 'Şirket Kuruluşu Sonrası Hizmetler: Kurumlar Vergisi, KDV, Muhasebe ve Bankacılık', 'Şirket Kuruluşu Sonrası Hizmetler:\nKurumlar Vergisi: Tüm şirketler için zorunlu kayıt. 375.000 AED kâra kadar %0, üzeri %9. SamChe kayıt ücreti 1.300 AED, geç kalma cezası 10.000 AED.\nKDV: 375.000 AED ciro üzerinde zorunlu %5 KDV.\nMuhasebe: 5 yıl evrak saklama zorunlu.\nBanka: Wio Bank, ENBD, Mashreq, FAB hesap açılışı & KYC danışmanlığı 8.000 AED danışmanlık paketine dahildir.', 'active', 'MANUAL', 'text/plain', 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2', 'READY', 'READY', TRUE),
      (src_7_id, t_id, 'SamChe Danışmanlık Ücreti ve Fiyatlandırma Politikası Referans Kılavuzu', 'SamChe Danışmanlık Ücreti Politikası:\nFree Zone Danışmanlık: 8.000 AED (Banka hesabı & KYC desteği dahil; sadece sorulduğunda veya ısrarda söylenir).\nMainland Danışmanlık: Sektöre göre resmi teklif ile belirlenir.\nMaliyet Analizleri Zorunlu İfade: "Belirtilen maliyetlere danışmanlık ücreti dahil değildir."', 'active', 'MANUAL', 'text/plain', 'f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8', 'READY', 'READY', TRUE)
    ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title, content = EXCLUDED.content,
          content_hash = EXCLUDED.content_hash, status = 'active',
          processing_status = 'READY', indexing_status = 'READY', updated_at = CURRENT_TIMESTAMP;

    src_ids := ARRAY[src_1_id, src_2_id, src_3_id, src_4_id, src_5_id, src_6_id, src_7_id];

    INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
    SELECT t_id, unnest(src_ids), b_ident_id
    ON CONFLICT (tenant_id, source_id, business_identity_id) DO NOTHING;

    -- 7. Upsert Business Profile and Approved Clean Version
    INSERT INTO business_profiles (id, tenant_id, business_identity_id)
    VALUES (gen_random_uuid(), t_id, b_ident_id)
    ON CONFLICT (tenant_id, business_identity_id)
    DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO bp_id;

    INSERT INTO business_profile_versions (
      id, tenant_id, profile_id, schema_version, profile_data, evidence,
      source_scope, identity_resolution_status, generated_by, status
    ) VALUES (
      gen_random_uuid(), t_id, bp_id, 2,
      jsonb_build_object(
        'company_identity', 'SamChe Company LLC',
        'company_display_name', 'SamChe Company',
        'company_summary', 'Dubai ve BAE genelinde şirket kurulumu, 2 yıllık sponsorlu oturum, freelance permit, vize işlemleri, muhasebe, vergi, kurumsal bankacılık KYC danışmanlığı ve dijital büyüme çözümleri sunan resmi danışmanlık firması.',
        'industry', 'Management Consulting & Corporate Services',
        'business_type', 'Corporate Services Provider',
        'products', jsonb_build_array(
          'Meydan Free Zone Company Setup', 'Dubai South Company Setup', 'Sharjah / IFZA Company Setup',
          'RAKEZ & Ajman Company Setup', 'Mainland (DET) Company Setup', 'Meydan Gold Trading License (40.000 AED)',
          'Sponsored Residency 2-Year Package (13.000 AED)', 'Umm Al Quwain Freelance Permit + Visa (16.800 AED)',
          'Family Visa - Child (4.500 AED)', 'Family Visa - Spouse (6.000 AED)',
          'Corporate Tax Registration (1.300 AED)', 'VAT Advisory & Registration',
          'Accounting & Bookkeeping Services', 'Corporate Bank Account Opening & KYC Coordination'
        ),
        'services', jsonb_build_array(
          'Free Zone Company Formation & Licensing', 'Mainland Company Formation (DET) with 100% Foreign Ownership',
          '2-Year Sponsored Residency Coordination', 'NOC Issuance Coordination',
          'Umm Al Quwain Freelance Permit & Visa Processing', 'Family Visa Sponsorship',
          'Corporate Tax Registration & Compliance Support', 'VAT Registration & Advisory',
          'Corporate Bank Account Opening & KYC Support', 'Health Insurance Coordination',
          'Post-Incorporation Support & Business Development'
        ),
        'packages', jsonb_build_array(
          'Sponsored Residency: 13.000 AED', 'UAQ Freelance Permit + Visa: 16.800 AED',
          'Family Visa Child: 4.500 AED', 'Family Visa Spouse: 6.000 AED',
          'Free Zone Consulting Package: 8.000 AED', 'Meydan Gold Trading Package: 40.000 AED',
          'Corporate Tax Registration: 1.300 AED'
        ),
        'pricing_information', jsonb_build_array(
          'Sponsored Residency: 13.000 AED', 'UAQ Freelance Permit + Vize: 16.800 AED',
          'Aile Vizesi - Çocuk: 4.500 AED / 2 yıl', 'Aile Vizesi - Eş: 6.000 AED / 2 yıl',
          'Sağlık Sigortası (Basic): ~800 AED / yıl', 'Free Zone Danışmanlık Ücreti: 8.000 AED',
          'Meydan Altın Ticareti Lisansı: 40.000 AED', 'Kurumlar Vergisi Kayıt: 1.300 AED',
          'Mainland Danışmanlık Ücreti: Sektöre göre belirlenir'
        ),
        'policies', jsonb_build_array(
          'SamChe Company LLC sponsor firma değildir ve herhangi bir işveren olarak hareket etmez; rolü danışmanlık, başvuru koordinasyonu ve süreç yönetimidir.',
          'Sponsor firma adı, sektörü ve detayları kota rezervasyonu ve ön başvuru öncesinde gizlidir; resmi iş teklifi evrağında yer alır.',
          'Vize ve oturum süreçlerinde devlet kurumları adına kesin onay veya %100 garanti verilmez.',
          'Dubai’de iş arayanlara iş bulma hizmeti sağlanmaz.',
          'Mainland şirketler için yerel ortak (sponsor) zorunluluğu bulunmamaktadır (%100 yabancı mülkiyeti).',
          'Şirket kuruluşu maliyet hesaplamalarında danışmanlık ücreti dahil değildir ("Belirtilen maliyetlere danışmanlık ücreti dahil değildir").',
          'Banka bilgileri yalnızca evrak gönderme/ödeme yapma aşamasında veya açıkça sorulduğunda verilir.'
        ),
        'operating_information', 'Adres: Sheikh Zayed Road Latifa Tower Office No 402, Dubai, UAE. İletişim: info@samchecompany.com, +971 50 179 38 80 / +971 52 728 8586. Banka: SamChe Company LLC, USD, Wio Bank IBAN AE210860000009726414926, BIC WIOBAEADXXX.',
        'terminology', jsonb_build_array('Mainland', 'Free Zone', 'NOC', 'Emirates ID', 'Ejari', 'FTA'),
        'supported_languages', jsonb_build_array('tr', 'en', 'ar', 'es', 'fr', 'de', 'it', 'pt', 'ru'),
        'unsupported_claims', jsonb_build_array(
          'SamChe Company LLC sponsor firmadır veya işverendir',
          'Vize kesin çıkar veya devlet onayı garantidir',
          'Dubai’de iş bulma desteği sağlıyoruz',
          'Mainland şirketler için yerel sponsor zorunludur',
          'Free Zone otoritesi kampanyalarını/promosyonlarını takip edin'
        )
      ),
      '[]'::jsonb,
      jsonb_build_object('business_identity_id', b_ident_id, 'source_ids', src_ids),
      'RESOLVED', 'HUMAN', 'APPROVED'
    )
    RETURNING id INTO bpv_id;

    UPDATE business_profiles
       SET active_version_id = bpv_id, activated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = bp_id AND tenant_id = t_id;

    IF legacy_acv_ids IS NOT NULL AND ARRAY_LENGTH(legacy_acv_ids, 1) > 0 THEN
    -- 8. Upsert Staging Candidate Assistant & Configuration Version
    INSERT INTO ai_assistants (id, tenant_id, name, model, status)
    VALUES (gen_random_uuid(), t_id, 'SamChe AI Staging Candidate', 'gemini-2.5-pro', 'active')
    ON CONFLICT (tenant_id, name)
    DO UPDATE SET model = 'gemini-2.5-pro', status = 'active', updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO ast_id;

    INSERT INTO assistant_configuration_versions (
      id, tenant_id, assistant_id, schema_version, configuration_data,
      source_profile_version_id, generated_by, status, approved_at, activated_at
    ) VALUES (
      gen_random_uuid(), t_id, ast_id, 2,
      jsonb_build_object(
        'assistant_identity', 'SamChe AI',
        'role_and_purpose', 'SamChe Company LLC’nin kurumsal yapay zekâ danışmanısın. Profesyonel, stratejik, analitik ve yol gösterici cevaplar ver. Danışmanlık, başvuru koordinasyonu ve süreç yönetimi sağla.',
        'company_context', 'SamChe Company LLC, Dubai ve BAE genelinde şirket kurulumu, sponsorlu oturum, vize, muhasebe, vergi, kurumsal bankacılık KYC danışmanlığı ve dijital büyüme çözümleri sunan resmi danışmanlık firmasıdır.',
        'tone', 'Profesyonel, stratejik, kurumsal, analitik ve net.',
        'greeting', 'Merhaba, size nasıl yardımcı olabilirim?',
        'customer_handling', 'Açıklayıcı cevap ve devam sorusu kuralını uygula. Tek satırlı maddeler (•) kullan. Markdown link sözdizimini koru. Kullanıcı mesajındaki link/email bağlamı bozmaz.',
        'faq_guidance', 'Resmi BAE süreçlerini, vize adımlarını, maliyetleri ve prosedürleri onaylı bilgi tabanına sadık kalarak açıkla. Tahmin veya uydurma bilgi verme.',
        'qualification_guidance', 'Şirket kurulumunda sektör ve vize sayısını öğren; kullanıcı daha önce sektörünü belirttiyse tekrar sorma; kullanıcı istemeden iş planı veya resmi teklif sunma.',
        'fallback_guidance', 'Belirsiz mesajlarda kurumsal fallback metni kullan. Olumsuz yanıtlarda nazikçe kapanış yap ve sessiz kal.',
        'escalation_guidance', 'Canlı temsilci talebi veya işlem başlatma niyetinde konuya uygun aktarım mesajı üret ve sessiz kal.',
        'sales_guidance', 'Kullanıcı net şekilde işlem başlatmak istemedikçe canlı danışman teklif etme. Free Zone danışmanlık ücretini sadece sorulduğunda 8.000 AED (banka/KYC dahil) olarak belirt. Maliyet hesaplamalarında danışmanlık ücretinin dahil olmadığını belirt.',
        'follow_up_behavior', 'Ping ve follow-up mesajları yalnızca 4 kategoriye ayrılır: RESIDENCE, COMPANY, AI, GENERAL.',
        'scheduled_messaging_behavior', 'Follow-up mesajlarında yeni konu başlatma; kendini tanımlayan teknoloji ifadeleri kullanma.',
        'supported_languages', jsonb_build_array('tr', 'en', 'ar', 'es', 'fr', 'de', 'it', 'pt', 'ru'),
        'language_selection_policy', 'Tüm mesajlar ve yanıtlar kullanıcının yazdığı dilde (TR, EN, AR vb.) cevaplanacaktır.',
        'prohibited_claims', jsonb_build_array(
          'Vize çıkma garantisi veya %100 devlet onayı',
          'SamChe Company LLC sponsor firmadır veya işverendir',
          'Dubai’de iş bulma desteği veriyoruz',
          'Mainland şirketler için yerel sponsor zorunludur',
          'Freezone otoritesi kampanyalarını takip edin'
        ),
        'channel_adaptations', jsonb_build_object(
          'instagram', jsonb_build_object(
            'presentation_policy', 'NATURAL_CONVERSATION',
            'formatting', 'concise conversational plain text without markdown headers',
            'transparency', 'truthful AI disclosure when explicitly asked, no false human claims, no unsolicited AI intro boilerplate',
            'dm_referral_awareness', true
          ),
          'whatsapp', jsonb_build_object(
            'formatting', 'plain text with bullet points'
          ),
          'web_chat', jsonb_build_object('widget_style', 'standard'),
          'samcheguide', jsonb_build_object('guide_experience', 'enabled')
        )
      ),
      bpv_id, 'HUMAN', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING id INTO acv_id;

    UPDATE ai_assistants
       SET active_configuration_version_id = acv_id, updated_at = CURRENT_TIMESTAMP
     WHERE id = ast_id AND tenant_id = t_id;

    INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
    SELECT t_id, unnest(src_ids), ast_id
    ON CONFLICT (tenant_id, source_id, assistant_id) DO NOTHING;

      UPDATE ai_assistants
         SET active_configuration_version_id = NULL
       WHERE tenant_id = t_id AND active_configuration_version_id = ANY(legacy_acv_ids);
      DELETE FROM assistant_configuration_versions WHERE tenant_id = t_id AND id = ANY(legacy_acv_ids);
    END IF;

    -- 5. Ensure canonical Business Identity
    INSERT INTO business_identities (id, tenant_id, display_name, normalized_identity, status)
    VALUES (gen_random_uuid(), t_id, 'SamChe Company LLC', 'samche company llc', 'ACTIVE')
    ON CONFLICT (tenant_id, normalized_identity)
    DO UPDATE SET display_name = 'SamChe Company LLC', status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO b_ident_id;
  END LOOP;
END $$;

COMMIT;
