import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation provenance migration keeps runs tenant scoped and links every generated lifecycle artifact', async () => {
  const migration = await readFile(new URL('../migrations/022_knowledge_generation_provenance.sql', import.meta.url), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_generation_runs/i);
  assert.match(migration, /tenant_id UUID NOT NULL REFERENCES tenants\(id\)/i);
  assert.match(migration, /prompt_hash CHAR\(64\) NOT NULL/i);
  assert.match(migration, /input_provenance JSONB NOT NULL/i);
  assert.match(migration, /status IN \('RUNNING', 'SUCCEEDED', 'FAILED'\)/i);
  assert.match(migration, /ALTER TABLE business_profile_versions[\s\S]*generation_run_id/i);
  assert.match(migration, /ALTER TABLE assistant_knowledge_recommendations[\s\S]*generation_run_id/i);
  assert.match(migration, /ALTER TABLE assistant_configuration_versions[\s\S]*generation_run_id/i);
  assert.doesNotMatch(migration, /prompt\s+TEXT/i);
});
