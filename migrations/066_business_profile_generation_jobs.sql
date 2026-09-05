-- Business Identity analysis and Business Profile generation are provider-bound
-- work. They use the existing durable Knowledge queue rather than an HTTP
-- request lifetime.
BEGIN;

ALTER TABLE knowledge_processing_jobs
  DROP CONSTRAINT IF EXISTS knowledge_processing_jobs_job_type_check;

ALTER TABLE knowledge_processing_jobs
  ADD CONSTRAINT knowledge_processing_jobs_job_type_check
  CHECK (job_type IN (
    'INDEX_SOURCE',
    'GENERATE_IMAGE_CANDIDATES',
    'GENERATE_BUSINESS_PROFILE',
    'GENERATE_ASSISTANT_RECOMMENDATION',
    'GENERATE_ASSISTANT_CONFIGURATION'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_business_profile_identity
  ON knowledge_processing_jobs (tenant_id, job_type, content_hash, embedding_model, embedding_version)
  WHERE job_type = 'GENERATE_BUSINESS_PROFILE';

CREATE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_business_profile_claim
  ON knowledge_processing_jobs (status, available_at, created_at)
  WHERE status = 'PENDING' AND job_type = 'GENERATE_BUSINESS_PROFILE';

COMMIT;
