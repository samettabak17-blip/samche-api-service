-- Task 6: persist only safe provider-boundary timing/status metadata.
ALTER TABLE knowledge_generation_runs
  ADD COLUMN IF NOT EXISTS provider_telemetry JSONB NOT NULL DEFAULT '{}'::jsonb;
