-- Assistant recommendation job types are longer than the original source-job
-- vocabulary. Widening is additive and preserves existing job values/checks.
ALTER TABLE knowledge_processing_jobs
  ALTER COLUMN job_type TYPE VARCHAR(48);
