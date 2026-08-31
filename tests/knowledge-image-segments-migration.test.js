import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/033_knowledge_image_segments.sql', import.meta.url), 'utf8');

test('image segment migration is additive, tenant-scoped, and restart-safe', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_source_extraction_segments/i);
  assert.match(migration, /tenant_id UUID NOT NULL REFERENCES tenants\(id\)/i);
  assert.match(migration, /FOREIGN KEY \(source_id, tenant_id\)[\s\S]*REFERENCES knowledge_base_documents\(id, tenant_id\)/i);
  assert.match(migration, /role VARCHAR\(16\)[\s\S]*BUSINESS[\s\S]*CUSTOMER[\s\S]*UNKNOWN/i);
  assert.match(migration, /is_current BOOLEAN NOT NULL DEFAULT TRUE/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/i);
});
