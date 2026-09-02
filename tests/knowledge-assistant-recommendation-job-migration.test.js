import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('assistant recommendation jobs extend the canonical processing queue without a source anchor', () => {
  const migration = fs.readFileSync(new URL('../migrations/052_assistant_recommendation_generation_jobs.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER COLUMN source_id DROP NOT NULL/i);
  assert.match(migration, /GENERATE_ASSISTANT_RECOMMENDATION/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_assistant_recommendation_identity/i);
  assert.match(migration, /WHERE job_type = 'GENERATE_ASSISTANT_RECOMMENDATION'/i);
});
