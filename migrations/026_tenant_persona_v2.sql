-- Task 6 tenant persona contracts. Additive and restart-safe; existing artifacts remain schema v1.
ALTER TABLE business_profile_versions
  ADD COLUMN IF NOT EXISTS schema_version SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE assistant_knowledge_recommendations
  ADD COLUMN IF NOT EXISTS schema_version SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE assistant_configuration_versions
  ADD COLUMN IF NOT EXISTS schema_version SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_profile_schema_version') THEN
    ALTER TABLE business_profile_versions
      ADD CONSTRAINT chk_business_profile_schema_version CHECK (schema_version >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_assistant_recommendation_schema_version') THEN
    ALTER TABLE assistant_knowledge_recommendations
      ADD CONSTRAINT chk_assistant_recommendation_schema_version CHECK (schema_version >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_assistant_configuration_schema_version') THEN
    ALTER TABLE assistant_configuration_versions
      ADD CONSTRAINT chk_assistant_configuration_schema_version CHECK (schema_version >= 1);
  END IF;
END $$;
