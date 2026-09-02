-- Assistant Recommendation generation is profile/assistant scoped rather than source scoped.
-- Existing source processing rows remain unchanged; NULL is used only for this canonical job type.
ALTER TABLE knowledge_processing_jobs
  ALTER COLUMN source_id DROP NOT NULL;

ALTER TABLE knowledge_processing_jobs
  DROP CONSTRAINT IF EXISTS knowledge_processing_jobs_job_type_check;

ALTER TABLE knowledge_processing_jobs
  ADD CONSTRAINT knowledge_processing_jobs_job_type_check
  CHECK (job_type IN (
    'INDEX_SOURCE',
    'GENERATE_IMAGE_CANDIDATES',
    'GENERATE_ASSISTANT_RECOMMENDATION',
    'GENERATE_ASSISTANT_CONFIGURATION'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_assistant_recommendation_identity
  ON knowledge_processing_jobs (tenant_id, job_type, content_hash, embedding_model, embedding_version)
  WHERE job_type = 'GENERATE_ASSISTANT_RECOMMENDATION';

CREATE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_assistant_recommendation_claim
  ON knowledge_processing_jobs (status, available_at, created_at)
  WHERE status = 'PENDING' AND job_type = 'GENERATE_ASSISTANT_RECOMMENDATION';
