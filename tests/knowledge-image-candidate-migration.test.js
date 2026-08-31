import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/034_knowledge_image_candidates.sql', import.meta.url), 'utf8');

test('image candidate migration is additive and tenant-safe', () => {
  assert.match(migration, /ALTER TABLE knowledge_candidates[\s\S]*candidate_fingerprint/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*candidate_fingerprint/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_candidate_image_evidence/i);
  assert.match(migration, /role VARCHAR\(16\)[\s\S]*BUSINESS[\s\S]*CUSTOMER[\s\S]*UNKNOWN/i);
  assert.match(migration, /evidence_kind VARCHAR\(24\)[\s\S]*PRIMARY[\s\S]*SUPPORTING_CONTEXT/i);
  assert.match(migration, /FOREIGN KEY \(source_id, tenant_id\)[\s\S]*knowledge_base_documents\(id, tenant_id\)/i);
});
