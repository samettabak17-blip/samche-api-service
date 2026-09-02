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

CREATE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_semantic_claim
  ON knowledge_processing_jobs (status, available_at, created_at)
  WHERE status = 'PENDING' AND job_type = 'GENERATE_IMAGE_CANDIDATES';
