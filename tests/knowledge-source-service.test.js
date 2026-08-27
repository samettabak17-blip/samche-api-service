import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploadedKnowledgeSource } from '../services/knowledge-source-service.js';

test('stores a validated document privately and queues canonical indexing without exposing the original filename in the key', async () => {
  const calls = [];
  const writes = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/INSERT INTO knowledge_base_documents/i.test(sql)) return { rows: [{ id: params[0], tenant_id: params[1] }] };
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
