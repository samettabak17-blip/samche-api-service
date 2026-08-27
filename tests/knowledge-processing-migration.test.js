import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('knowledge ingestion jobs are tenant-scoped, idempotent, and preserve source processing states', async () => {
  const migration = await readFile(new URL('../migrations/018_knowledge_source_processing.sql', import.meta.url), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge_processing_jobs/i);
  assert.match(migration, /tenant_id UUID NOT NULL REFERENCES tenants\(id\)/i);
  assert.match(migration, /FOREIGN KEY \(source_id, tenant_id\)[\s\S]*REFERENCES knowledge_base_documents\(id, tenant_id\)/i);
  assert.match(migration, /UNIQUE \(tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version\)/i);
});
