-- Migration 108: Update SamChe approved YouTube guidance URL across Knowledge and Configurations
-- Replaces legacy youtube.com/@sametttbk with owner-approved https://ytbe.app/u9j8qB2S.
-- Idempotent, safe, and generic.

DO $$
BEGIN
  -- 1. Knowledge Base Documents
  UPDATE knowledge_base_documents
     SET content = REPLACE(REPLACE(REPLACE(content,
           'https://www.youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'https://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'http://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
         updated_at = CURRENT_TIMESTAMP
   WHERE content LIKE '%youtube.com/@sametttbk%';

  -- 2. Knowledge Chunks
  UPDATE knowledge_chunks
     SET normalized_text = REPLACE(REPLACE(REPLACE(normalized_text,
           'https://www.youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'https://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'http://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
         updated_at = CURRENT_TIMESTAMP
   WHERE normalized_text LIKE '%youtube.com/@sametttbk%';

  -- 3. Assistant Configuration Versions
  UPDATE assistant_configuration_versions
     SET configuration_data = REPLACE(REPLACE(REPLACE(configuration_data::text,
           'https://www.youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'https://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'http://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S')::jsonb,
         updated_at = CURRENT_TIMESTAMP
   WHERE configuration_data::text LIKE '%youtube.com/@sametttbk%';

  -- 4. Business Profile Versions
  UPDATE business_profile_versions
     SET profile_data = REPLACE(REPLACE(REPLACE(profile_data::text,
           'https://www.youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'https://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S'),
           'http://youtube.com/@sametttbk', 'https://ytbe.app/u9j8qB2S')::jsonb,
         updated_at = CURRENT_TIMESTAMP
   WHERE profile_data::text LIKE '%youtube.com/@sametttbk%';
END $$;
