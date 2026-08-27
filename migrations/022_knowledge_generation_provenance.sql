-- Task 6: persist safe, tenant-scoped provenance for every generated lifecycle artifact.
CREATE TABLE IF NOT EXISTS knowledge_generation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type VARCHAR(32) NOT NULL
    CHECK (target_type IN ('BUSINESS_PROFILE', 'RECOMMENDATION', 'ASSISTANT_CONFIGURATION')),
  target_id UUID,
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('GEMINI', 'OPENAI')),
  model VARCHAR(128) NOT NULL,
  prompt_hash CHAR(64) NOT NULL,
  input_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_hash CHAR(64),
  status VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  UNIQUE (id, tenant_id)
);

ALTER TABLE business_profile_versions
  ADD COLUMN IF NOT EXISTS generation_run_id UUID;

ALTER TABLE assistant_knowledge_recommendations
  ADD COLUMN IF NOT EXISTS generation_run_id UUID;

ALTER TABLE assistant_configuration_versions
  ADD COLUMN IF NOT EXISTS generation_run_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_profile_versions_generation_run') THEN
    ALTER TABLE business_profile_versions ADD CONSTRAINT fk_business_profile_versions_generation_run
      FOREIGN KEY (generation_run_id, tenant_id) REFERENCES knowledge_generation_runs(id, tenant_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_assistant_recommendations_generation_run') THEN
    ALTER TABLE assistant_knowledge_recommendations ADD CONSTRAINT fk_assistant_recommendations_generation_run
      FOREIGN KEY (generation_run_id, tenant_id) REFERENCES knowledge_generation_runs(id, tenant_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_assistant_configurations_generation_run') THEN
    ALTER TABLE assistant_configuration_versions ADD CONSTRAINT fk_assistant_configurations_generation_run
      FOREIGN KEY (generation_run_id, tenant_id) REFERENCES knowledge_generation_runs(id, tenant_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_knowledge_generation_runs_tenant_created
  ON knowledge_generation_runs (tenant_id, created_at DESC);
