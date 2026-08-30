-- Task 6: stage-aware Assistant Recommendation / Configuration generation.
-- Restart-safe: replace only the bounded stage check; existing data remains valid.
ALTER TABLE knowledge_generation_runs
  DROP CONSTRAINT IF EXISTS chk_knowledge_generation_run_stage;

ALTER TABLE knowledge_generation_runs
  ADD CONSTRAINT chk_knowledge_generation_run_stage
  CHECK (stage IS NULL OR stage IN (
    'IDENTITY_ANALYSIS', 'PROFILE_GENERATION', 'PROFILE_CONTEXT',
    'RECOMMENDATION_GENERATION', 'CONFIGURATION_GENERATION', 'PERSISTENCE'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_recommendations_generation_run
  ON assistant_knowledge_recommendations (generation_run_id)
  WHERE generation_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_configurations_generation_run
  ON assistant_configuration_versions (generation_run_id)
  WHERE generation_run_id IS NOT NULL;
