import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('configuration generation extends the existing processing queue safely', () => {
  const migration = fs.readFileSync(new URL('../migrations/055_assistant_configuration_generation_jobs.sql', import.meta.url), 'utf8');
  assert.match(migration, /GENERATE_ASSISTANT_CONFIGURATION/);
  assert.match(migration, /idx_knowledge_processing_jobs_assistant_configuration_identity/);
  assert.match(migration, /idx_knowledge_processing_jobs_assistant_configuration_claim/);
});
