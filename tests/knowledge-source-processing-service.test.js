import test from 'node:test';
import assert from 'node:assert/strict';
import { claimNextKnowledgeProcessingJob, processKnowledgeProcessingJob, streamToBuffer } from '../services/knowledge-source-processing-service.js';

test('claims only one pending knowledge job with SKIP LOCKED to keep tenant processing isolated', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 'job-1', tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] };
    },
  };

  const job = await claimNextKnowledgeProcessingJob(database);
  assert.equal(job.id, 'job-1');
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/i);
  assert.match(calls[0].sql, /status = 'PENDING'/i);
});

test('reads a private object stream without coercing its binary data to text', async () => {
  const body = (async function* stream() {
    yield Buffer.from([0, 1, 2]);
    yield Buffer.from([3, 255]);
  }());

  const bytes = await streamToBuffer(body);
  assert.deepEqual([...bytes], [0, 1, 2, 3, 255]);
});

test('routes image sources through the canonical extractor and leaves them non-indexed', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, tenant_id, source_type/i.test(sql)) return { rows: [{ id: 'source-1', tenant_id: 'tenant-a', source_type: 'DOCUMENT', content: '', mime_type: 'image/png', storage_key: 'private/image', content_hash: 'b'.repeat(64), enabled: true, status: 'active', processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
      return { rows: [] };
    },
  };
  const imageExtractor = { async extract(input) {
    assert.equal(input.mimeType, 'image/png');
    return {
      extractionVersion: '1', sourceHash: 'b'.repeat(64), mimeType: 'image/png',
      text: 'Business statement.', segments: [{ order: 0, text: 'Business statement.', role: 'BUSINESS', confidence: 0.9 }],
      extractionConfidence: 0.9, extractionMethod: 'FAKE_TEST_EXTRACTOR',
    };
  } };
  let indexCalled = false;
  const result = await processKnowledgeProcessingJob({
    database,
    storage: { async get() { return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); } },
    job: { id: 'job-1', tenant_id: 'tenant-a', source_id: 'source-1' },
    imageExtractor,
    index: async () => { indexCalled = true; },
  });
  assert.equal(result.status, 'READY');
  assert.equal(indexCalled, false);
  assert.ok(calls.some(({ sql }) => /SET content = \$3[\s\S]*extraction_method/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /SET status = \$3/i.test(sql) && /knowledge_processing_jobs/i.test(sql)));
  assert.ok(calls.every(({ params }) => !params.includes('tenant-b')));
});

test('image extraction failure fails the source and processing job without indexing', async () => {
  const calls = [];
  const database = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id, tenant_id, source_type/i.test(sql)) return { rows: [{ id: 'source-1', tenant_id: 'tenant-a', source_type: 'DOCUMENT', content: '', mime_type: 'image/jpeg', storage_key: 'private/image', content_hash: 'c'.repeat(64), enabled: true, status: 'active', processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    return { rows: [] };
  } };
  await assert.rejects(() => processKnowledgeProcessingJob({
    database,
    storage: { async get() { return Buffer.from([0xff, 0xd8, 0xff]); } },
    job: { id: 'job-1', tenant_id: 'tenant-a', source_id: 'source-1' },
    imageExtractor: { async extract() { throw Object.assign(new Error('invalid'), { code: 'IMAGE_EXTRACTION_OUTPUT_INVALID' }); } },
    index: async () => assert.fail('image failure must not index'),
  }), { code: 'IMAGE_EXTRACTION_OUTPUT_INVALID' });
  assert.ok(calls.some(({ sql, params }) => /SET processing_status = 'FAILED'/i.test(sql) && params.includes('IMAGE_EXTRACTION_OUTPUT_INVALID')));
});
