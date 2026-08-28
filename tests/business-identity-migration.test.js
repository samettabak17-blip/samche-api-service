import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('business identity migration adds tenant-scoped source scope and conflict safety', async () => {
  const sql = await readFile(new URL('../migrations/027_business_identity_source_scope.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS business_identities/i);
  assert.match(sql, /UNIQUE \(id, tenant_id\)/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS knowledge_source_business_identities/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS business_identity_source_evidence/i);
  assert.match(sql, /FOREIGN KEY \(source_id, tenant_id\)/i);
  assert.match(sql, /FOREIGN KEY \(business_identity_id, tenant_id\)/i);
  assert.match(sql, /ALTER TABLE business_profiles[\s\S]*business_identity_id/i);
  assert.match(sql, /ALTER TABLE business_profile_versions[\s\S]*source_scope JSONB/i);
  assert.match(sql, /identity_resolution_status/i);
  assert.match(sql, /IDENTITY_RESOLUTION_REQUIRED/i);
});
