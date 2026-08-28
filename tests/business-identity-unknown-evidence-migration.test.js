import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('unknown identity evidence remains auditable and migration is restart-safe', async () => {
  const sql = await readFile(new URL('../migrations/028_business_identity_unknown_evidence.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER COLUMN normalized_detected_identity DROP NOT NULL/i);
  assert.doesNotMatch(sql, /DELETE|DROP TABLE|TRUNCATE/i);
});
