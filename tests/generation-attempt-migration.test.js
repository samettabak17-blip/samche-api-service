import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../migrations/029_generation_attempt_observability.sql', import.meta.url), 'utf8');
const assistantSql = fs.readFileSync(new URL('../migrations/031_assistant_generation_hardening.sql', import.meta.url), 'utf8');

test('generation attempt migration is restart-safe and records bounded observability metadata', () => {
  for (const column of ['business_identity_id', 'request_fingerprint', 'stage', 'prompt_character_count', 'source_count', 'elapsed_ms']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, 'i'));
  }
  assert.match(sql, /IDENTITY_ANALYSIS/);
  assert.match(sql, /PROFILE_GENERATION/);
  assert.match(sql, /PERSISTENCE/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_generation_runs_active_fingerprint/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_generation_runs_success_fingerprint/i);
  assert.match(sql, /business_identity_source_evidence[\s\S]*ADD COLUMN IF NOT EXISTS analysis_schema_version/i);
});

test('assistant generation hardening migration adds bounded stages and run relations', () => {
  assert.match(assistantSql, /DROP CONSTRAINT IF EXISTS chk_knowledge_generation_run_stage/i);
  for (const stage of ['PROFILE_CONTEXT', 'RECOMMENDATION_GENERATION', 'CONFIGURATION_GENERATION']) assert.match(assistantSql, new RegExp(stage));
  assert.match(assistantSql, /uq_assistant_recommendations_generation_run/i);
  assert.match(assistantSql, /uq_assistant_configurations_generation_run/i);
});
