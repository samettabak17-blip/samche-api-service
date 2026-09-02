import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('source identity assignment migration is additive, auditable, and never tenant-inferred', async () => {
  const sql = await readFile(new URL('../migrations/049_source_business_identity_assignment.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE knowledge_source_business_identities[\s\S]*assigned_by_user_id/i);
  assert.match(sql, /assignment_origin/i);
  assert.match(sql, /knowledge_source_business_identity_assignment_events/i);
  assert.match(sql, /business_identity_id UUID/i);
  assert.doesNotMatch(sql, /INSERT INTO knowledge_source_business_identities[\s\S]*FROM tenants/i);
});
