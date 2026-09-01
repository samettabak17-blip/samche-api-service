import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('legacy approved image candidates recover evidence only through their deterministic source-segment fingerprint', async () => {
  const sql = await readFile(new URL('../migrations/048_legacy_image_candidate_evidence_repair.sql', import.meta.url), 'utf8');

  assert.match(sql, /knowledge_candidate_image_evidence/i);
  assert.match(sql, /knowledge_source_extraction_segments/i);
  assert.match(sql, /candidate_fingerprint/i);
  assert.match(sql, /encode\s*\(\s*digest/i);
  assert.match(sql, /COUNT\s*\(\*\)\s*=\s*1/i);
  assert.match(sql, /candidate\.status\s*=\s*'APPROVED'/i);
  assert.match(sql, /candidate\.image_semantic_version\s*=\s*'1'/i);
  assert.match(sql, /knowledge_materialized_source_provenance/i);
  assert.match(sql, /knowledge_source_business_identities/i);
  assert.match(sql, /ON CONFLICT DO NOTHING/i);
});

test('legacy evidence repair never assigns a Business Identity from tenant membership or canonical text', async () => {
  const sql = await readFile(new URL('../migrations/048_legacy_image_candidate_evidence_repair.sql', import.meta.url), 'utf8');

  assert.doesNotMatch(sql, /JOIN\s+business_identities\b/i);
  assert.doesNotMatch(sql, /proposed_content\s+(ILIKE|LIKE)/i);
  assert.doesNotMatch(sql, /proposed_title\s+(ILIKE|LIKE)/i);
});
