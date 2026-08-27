import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('knowledge gap deduplication migration is additive and tenant scoped', async () => {
  const sql = await readFile(new URL('../migrations/020_knowledge_gap_deduplication.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS dedupe_key/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_gaps_tenant_dedupe/i);
  assert.match(sql, /ON knowledge_gaps \(tenant_id, dedupe_key\)/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE/i);
});

