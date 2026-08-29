import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../migrations/029_generation_attempt_observability.sql', import.meta.url), 'utf8');

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
