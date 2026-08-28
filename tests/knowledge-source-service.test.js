import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadedKnowledgeSource, enqueueKnowledgeIndexJob } from '../services/knowledge-source-service.js';

test('stores a validated document privately and queues canonical indexing without exposing the original filename in the key', async () => {
  const calls = [];
  const writes = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/INSERT INTO knowledge_base_documents/i.test(sql)) return { rows: [{ id: params[0], tenant_id: params[1], processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
      if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) return { rows: [{ id: 'job-1' }] };
      return { rows: [] };
    },
  };
  const storage = {
    async put(payload) { writes.push(payload); },
    async remove() { throw new Error('not expected'); },
  };

  const result = await createUploadedKnowledgeSource({
    database,
    storage,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    uploadedBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    title: 'Service policy',
    file: {
      originalname: '../../customer-private-policy.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nminimal'),
      size: 16,
    },
  });

  assert.equal(result.processingStatus, 'UPLOADED');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].mimeType, 'application/pdf');
  assert.doesNotMatch(writes[0].key, /customer-private-policy/i);
  assert.match(writes[0].key, /^knowledge\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\//);
  assert.equal(calls.filter(({ sql }) => /INSERT INTO knowledge_processing_jobs/i.test(sql)).length, 1);
});

test('explicit reindex requeues an existing READY job without stealing a PROCESSING job', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'job-1', status: 'PENDING' }] };
  } };
  const job = await enqueueKnowledgeIndexJob({
    database,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    contentHash: 'a'.repeat(64),
    metadata: { reindex: true },
    force: true,
  });
  assert.equal(job.status, 'PENDING');
  assert.equal(calls[0].params[6], true);
  assert.match(calls[0].sql, /WHEN knowledge_processing_jobs\.status = 'PROCESSING'/);
  assert.match(calls[0].sql, /WHEN \$7 THEN 'PENDING'/);
});
