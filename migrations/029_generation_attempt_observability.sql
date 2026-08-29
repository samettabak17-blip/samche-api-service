-- Task 6: bounded generation-attempt observability and duplicate-safe scoped generation.
ALTER TABLE knowledge_generation_runs
  ADD COLUMN IF NOT EXISTS business_identity_id UUID,
  ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64),
  ADD COLUMN IF NOT EXISTS stage VARCHAR(32),
  ADD COLUMN IF NOT EXISTS prompt_character_count INTEGER,
  ADD COLUMN IF NOT EXISTS source_count INTEGER,
  ADD COLUMN IF NOT EXISTS elapsed_ms BIGINT;

ALTER TABLE business_identity_source_evidence
  ADD COLUMN IF NOT EXISTS analysis_schema_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_knowledge_generation_run_stage') THEN
    ALTER TABLE knowledge_generation_runs ADD CONSTRAINT chk_knowledge_generation_run_stage
      CHECK (stage IS NULL OR stage IN ('IDENTITY_ANALYSIS', 'PROFILE_GENERATION', 'PERSISTENCE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_knowledge_generation_run_counts') THEN
    ALTER TABLE knowledge_generation_runs ADD CONSTRAINT chk_knowledge_generation_run_counts
      CHECK ((prompt_character_count IS NULL OR prompt_character_count >= 0)
         AND (source_count IS NULL OR source_count >= 0)
         AND (elapsed_ms IS NULL OR elapsed_ms >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_knowledge_generation_run_business_identity') THEN
    ALTER TABLE knowledge_generation_runs ADD CONSTRAINT fk_knowledge_generation_run_business_identity
      FOREIGN KEY (business_identity_id, tenant_id)
      REFERENCES business_identities(id, tenant_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_generation_runs_active_fingerprint
  ON knowledge_generation_runs (tenant_id, target_type, request_fingerprint)
  WHERE request_fingerprint IS NOT NULL AND status = 'RUNNING';

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_generation_runs_success_fingerprint
  ON knowledge_generation_runs (tenant_id, target_type, request_fingerprint)
  WHERE request_fingerprint IS NOT NULL AND status = 'SUCCEEDED';

CREATE INDEX IF NOT EXISTS idx_knowledge_generation_runs_fingerprint
  ON knowledge_generation_runs (tenant_id, target_type, request_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_identity_evidence_exact_scope
  ON business_identity_source_evidence
    (tenant_id, business_identity_id, source_id, content_hash, provider, model, analysis_schema_version);
