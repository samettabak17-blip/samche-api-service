-- Assistant Configuration generation is an assistant/profile scoped review task.
-- It uses the existing semantic worker queue and therefore has no source row.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_assistant_configuration_identity
  ON knowledge_processing_jobs (tenant_id, job_type, content_hash, embedding_model, embedding_version)
  WHERE job_type = 'GENERATE_ASSISTANT_CONFIGURATION';

CREATE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_assistant_configuration_claim
  ON knowledge_processing_jobs (status, available_at, created_at)
  WHERE status = 'PENDING' AND job_type = 'GENERATE_ASSISTANT_CONFIGURATION';
