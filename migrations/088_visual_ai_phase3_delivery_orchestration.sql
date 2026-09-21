-- Migration 088: Visual AI Phase 3 durable output convergence.
BEGIN;

ALTER TABLE visual_ai_generation_jobs
  ADD COLUMN IF NOT EXISTS output_message_id UUID,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED', 'NOT_REQUIRED')),
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS delivery_failure_code VARCHAR(80);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'visual_ai_generation_jobs'::regclass
       AND conname = 'fk_visual_ai_jobs_output_message'
  ) THEN
    ALTER TABLE visual_ai_generation_jobs
      ADD CONSTRAINT fk_visual_ai_jobs_output_message
      FOREIGN KEY (output_message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_ai_jobs_generated_resource
  ON visual_ai_generation_jobs (generated_resource_id) WHERE generated_resource_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_ai_jobs_output_message
  ON visual_ai_generation_jobs (output_message_id) WHERE output_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visual_ai_jobs_provider_message
  ON visual_ai_generation_jobs (tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

COMMIT;
