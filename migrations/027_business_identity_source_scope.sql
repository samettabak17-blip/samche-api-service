-- Task 6: explicit tenant Business Identity and exact Business Profile source scope.
CREATE TABLE IF NOT EXISTS business_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  display_name VARCHAR(255) NOT NULL,
  normalized_identity VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, normalized_identity)
);

CREATE TABLE IF NOT EXISTS knowledge_source_business_identities (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  business_identity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_id, business_identity_id),
  CONSTRAINT fk_source_business_identity_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_source_business_identity_identity
    FOREIGN KEY (business_identity_id, tenant_id)
    REFERENCES business_identities(id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS business_identity_source_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  business_identity_id UUID NOT NULL,
  source_id UUID NOT NULL,
  content_hash CHAR(64),
  detected_identity VARCHAR(255) NOT NULL,
  normalized_detected_identity VARCHAR(255) NOT NULL,
  confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  safe_evidence TEXT,
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('GEMINI', 'OPENAI')),
  model VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, business_identity_id, source_id, content_hash),
  CONSTRAINT fk_business_identity_evidence_identity
    FOREIGN KEY (business_identity_id, tenant_id)
    REFERENCES business_identities(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_business_identity_evidence_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE
);

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS business_identity_id UUID;

ALTER TABLE business_profile_versions
  ADD COLUMN IF NOT EXISTS source_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS identity_resolution_status VARCHAR(40) NOT NULL DEFAULT 'LEGACY_UNSCOPED';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_tenant_id_key') THEN
    ALTER TABLE business_profiles DROP CONSTRAINT business_profiles_tenant_id_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_profiles_identity') THEN
    ALTER TABLE business_profiles ADD CONSTRAINT fk_business_profiles_identity
      FOREIGN KEY (business_identity_id, tenant_id)
      REFERENCES business_identities(id, tenant_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_business_profiles_tenant_identity') THEN
    ALTER TABLE business_profiles ADD CONSTRAINT uq_business_profiles_tenant_identity
      UNIQUE (tenant_id, business_identity_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_profile_identity_resolution') THEN
    ALTER TABLE business_profile_versions ADD CONSTRAINT chk_business_profile_identity_resolution
      CHECK (identity_resolution_status IN ('LEGACY_UNSCOPED', 'RESOLVED', 'IDENTITY_RESOLUTION_REQUIRED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_business_identities_tenant_status
  ON business_identities (tenant_id, status, display_name);
CREATE INDEX IF NOT EXISTS idx_source_business_identities_identity
  ON knowledge_source_business_identities (tenant_id, business_identity_id, source_id);
CREATE INDEX IF NOT EXISTS idx_business_identity_evidence_source
  ON business_identity_source_evidence (tenant_id, source_id, updated_at DESC);
