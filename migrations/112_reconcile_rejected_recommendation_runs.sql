-- Migration 112: Reconcile historical generation runs whose produced assistant recommendation was rejected.
-- Ensures uq_knowledge_generation_runs_success_fingerprint permits new recommendation generation attempts
-- across all tenants whose previous recommendation was rejected. Idempotent and restart-safe.

BEGIN;

UPDATE knowledge_generation_runs run
   SET status = 'FAILED', error_code = 'RECOMMENDATION_REJECTED'
  FROM assistant_knowledge_recommendations rec
 WHERE rec.generation_run_id = run.id
   AND rec.tenant_id = run.tenant_id
   AND rec.status = 'REJECTED'
   AND run.status = 'SUCCEEDED'
   AND run.target_type = 'RECOMMENDATION';

UPDATE knowledge_processing_jobs job
   SET status = 'PENDING', attempts = 0, available_at = CURRENT_TIMESTAMP, last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
 WHERE job.job_type = 'GENERATE_ASSISTANT_RECOMMENDATION'
   AND job.status IN ('FAILED', 'PROCESSING');

COMMIT;
