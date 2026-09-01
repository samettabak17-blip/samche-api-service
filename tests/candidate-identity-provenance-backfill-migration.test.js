import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('candidate identity provenance backfill is deterministic and never uses tenant-only inheritance', async () => {
  const sql = await readFile(new URL('../migrations/042_candidate_identity_provenance_backfill.sql', import.meta.url), 'utf8');

  assert.match(sql, /knowledge_candidate_image_evidence/i);
  assert.match(sql, /knowledge_source_business_identities/i);
  assert.match(sql, /candidate\.approved_source_id/i);
  assert.match(sql, /ON CONFLICT DO NOTHING/i);
  assert.doesNotMatch(sql, /WHERE\s+candidate\.tenant_id\s*=\s*identity_link\.tenant_id\s*$/im);
});

test('provenance repair backfills both materialized and original sources from one trusted identity', async () => {
  const sql = await readFile(new URL('../migrations/046_candidate_identity_provenance_repair.sql', import.meta.url), 'utf8');

  assert.match(sql, /knowledge_candidate_image_evidence/i);
  assert.match(sql, /candidate\.approved_source_id/i);
  assert.match(sql, /knowledge_source_business_identities/i);
  assert.match(sql, /COUNT\s*\(DISTINCT\s+identity_link\.business_identity_id\)/i);
  assert.match(sql, /HAVING\s+COUNT\s*\(DISTINCT\s+identity_link\.business_identity_id\)\s*=\s*1/i);
  assert.match(sql, /ON CONFLICT DO NOTHING/i);
  assert.doesNotMatch(sql, /candidate\.tenant_id\s*=\s*identity_link\.tenant_id\s*$/im);
});
