-- Task 6: approval is historical; activation is the only runtime authority.
-- Existing assistant prompts remain the fallback until an explicitly ACTIVE configuration is applied.
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS active_version_id UUID,
  ADD COLUMN IF NOT EXISTS activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE business_profile_versions
  ADD COLUMN IF NOT EXISTS activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_version_id UUID;

CREATE TABLE IF NOT EXISTS assistant_configuration_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  configuration_data JSONB NOT NULL,
  source_profile_version_id UUID,
  source_recommendation_id UUID,
  generated_by VARCHAR(32) NOT NULL DEFAULT 'AI',
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'ACTIVE', 'REJECTED', 'SUPERSEDED')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  supersedes_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id),
  CONSTRAINT fk_assistant_configuration_versions_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_assistant_configuration_versions_profile
    FOREIGN KEY (source_profile_version_id, tenant_id)
    REFERENCES business_profile_versions(id, tenant_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_assistant_configuration_versions_recommendation
    FOREIGN KEY (source_recommendation_id, tenant_id)
    REFERENCES assistant_knowledge_recommendations(id, tenant_id)
    ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_profiles_active_version') THEN
    ALTER TABLE business_profiles
      ADD CONSTRAINT fk_business_profiles_active_version
      FOREIGN KEY (active_version_id, tenant_id)
      REFERENCES business_profile_versions(id, tenant_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_profile_versions_superseded_by') THEN
    ALTER TABLE business_profile_versions
      ADD CONSTRAINT fk_business_profile_versions_superseded_by
      FOREIGN KEY (superseded_by_version_id, tenant_id)
      REFERENCES business_profile_versions(id, tenant_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_assistant_configuration_versions_supersedes') THEN
    ALTER TABLE assistant_configuration_versions
      ADD CONSTRAINT fk_assistant_configuration_versions_supersedes
      FOREIGN KEY (supersedes_version_id, tenant_id)
      REFERENCES assistant_configuration_versions(id, tenant_id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE ai_assistants
  ADD COLUMN IF NOT EXISTS active_configuration_version_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_assistants_active_configuration_version') THEN
    ALTER TABLE ai_assistants
      ADD CONSTRAINT fk_ai_assistants_active_configuration_version
      FOREIGN KEY (active_configuration_version_id, tenant_id)
      REFERENCES assistant_configuration_versions(id, tenant_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_configuration_versions_one_active
  ON assistant_configuration_versions (tenant_id, assistant_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_assistant_configuration_versions_review
  ON assistant_configuration_versions (tenant_id, assistant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_profiles_active
  ON business_profiles (tenant_id, active_version_id)
  WHERE active_version_id IS NOT NULL;
