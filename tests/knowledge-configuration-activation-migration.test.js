import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('active configuration migration separates approval from runtime activation and preserves version history', async () => {
  const migration = await readFile(new URL('../migrations/019_knowledge_configuration_activation.sql', import.meta.url), 'utf8');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS active_version_id UUID/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assistant_configuration_versions/i);
  assert.match(migration, /status IN \('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'ACTIVE', 'REJECTED', 'SUPERSEDED'\)/i);
  assert.match(migration, /supersedes_version_id UUID/i);
  assert.match(migration, /activated_by UUID/i);
  assert.match(migration, /activated_at TIMESTAMPTZ/i);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS.*active/i);
});
