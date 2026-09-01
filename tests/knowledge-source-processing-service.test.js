import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { claimNextKnowledgeProcessingJob, persistImageExtractionSegments, processKnowledgeProcessingJob, streamToBuffer } from '../services/knowledge-source-processing-service.js';

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
  assert.match(calls[0].sql, /job_type\s*<>\s*'GENERATE_IMAGE_CANDIDATES'/i);
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
  const transactionCalls = [];
  const storedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const sourceHash = crypto.createHash('sha256').update(storedPng).digest('hex');
  const client = { async query(sql, params = []) { transactionCalls.push({ sql, params }); return { rows: [] }; }, release() {} };
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, tenant_id, source_type/i.test(sql)) return { rows: [{ id: 'source-1', tenant_id: 'tenant-a', source_type: 'DOCUMENT', content: '', mime_type: 'image/png', storage_key: 'private/image', content_hash: sourceHash, enabled: true, status: 'active', processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const imageExtractor = { async extract(input) {
    assert.equal(input.mimeType, 'image/png');
    assert.equal(input.sourceHash, sourceHash);
    return {
      extractionVersion: '1', sourceHash, mimeType: 'image/png',
      text: 'Business statement.', segments: [{ order: 0, text: 'Business statement.', role: 'BUSINESS', confidence: 0.9 }],
      extractionConfidence: 0.9, extractionMethod: 'FAKE_TEST_EXTRACTOR',
    };
  } };
  let indexCalled = false;
  const result = await processKnowledgeProcessingJob({
    database,
    storage: { async get() { return storedPng; } },
    job: { id: 'job-1', tenant_id: 'tenant-a', source_id: 'source-1' },
    imageExtractor,
    index: async () => { indexCalled = true; },
  });
  assert.equal(result.status, 'READY');
  assert.equal(indexCalled, false);
  assert.ok(transactionCalls.some(({ sql }) => /SET content = \$3[\s\S]*extraction_method/i.test(sql)));
  assert.ok(transactionCalls.some(({ sql }) => /SET content = \$3[\s\S]*processing_status = 'READY'/i.test(sql)));
  assert.ok(transactionCalls.some(({ sql }) => /INSERT INTO knowledge_source_extraction_segments/i.test(sql)));
  assert.ok(transactionCalls.some(({ sql }) => /is_current = FALSE/i.test(sql)));
  assert.ok(transactionCalls.some(({ sql }) => /SET status = 'READY'/i.test(sql) && /knowledge_processing_jobs/i.test(sql)));
  assert.ok(calls.every(({ params }) => !params.includes('tenant-b')));
});

test('fails closed when retrieved image bytes do not match the persisted original source hash', async () => {
  const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const corrupted = Buffer.from([...original, 0]);
  const sourceHash = crypto.createHash('sha256').update(original).digest('hex');
  let extractorCalled = false;
  const calls = [];
  const database = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id, tenant_id, source_type/i.test(sql)) return { rows: [{ id: 'source-1', tenant_id: 'tenant-a', source_type: 'DOCUMENT', content: '', mime_type: 'image/png', storage_key: 'private/image', content_hash: sourceHash, enabled: true, status: 'active', processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    return { rows: [] };
  } };
  await assert.rejects(() => processKnowledgeProcessingJob({
    database,
    storage: { async get() { return corrupted; } },
    job: { id: 'job-1', tenant_id: 'tenant-a', source_id: 'source-1' },
    imageExtractor: { async extract() { extractorCalled = true; } },
  }), { code: 'IMAGE_SOURCE_HASH_INVALID' });
  assert.equal(extractorCalled, false);
  assert.ok(calls.some(({ sql, params }) => /SET processing_status = 'FAILED'/i.test(sql) && params.includes('IMAGE_SOURCE_HASH_INVALID')));
});

test('image extraction failure fails the source and processing job without indexing', async () => {
  const calls = [];
  const storedJpeg = Buffer.from([0xff, 0xd8, 0xff]);
  const sourceHash = crypto.createHash('sha256').update(storedJpeg).digest('hex');
  const database = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id, tenant_id, source_type/i.test(sql)) return { rows: [{ id: 'source-1', tenant_id: 'tenant-a', source_type: 'DOCUMENT', content: '', mime_type: 'image/jpeg', storage_key: 'private/image', content_hash: sourceHash, enabled: true, status: 'active', processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    return { rows: [] };
  } };
  await assert.rejects(() => processKnowledgeProcessingJob({
    database,
    storage: { async get() { return storedJpeg; } },
    job: { id: 'job-1', tenant_id: 'tenant-a', source_id: 'source-1' },
    imageExtractor: { async extract() { throw Object.assign(new Error('invalid'), { code: 'IMAGE_EXTRACTION_OUTPUT_INVALID' }); } },
    index: async () => assert.fail('image failure must not index'),
  }), { code: 'IMAGE_EXTRACTION_OUTPUT_INVALID' });
  assert.ok(calls.some(({ sql, params }) => /SET processing_status = 'FAILED'/i.test(sql) && params.includes('IMAGE_EXTRACTION_OUTPUT_INVALID')));
});

test('tenant-scoped source lookup fails closed instead of processing another tenant image', async () => {
  let extractorCalled = false;
  const calls = [];
  const database = { async query(sql, params = []) { calls.push({ sql, params }); return { rows: [] }; } };
  const result = await processKnowledgeProcessingJob({
    database,
    job: { id: 'job-1', tenant_id: 'tenant-a', source_id: 'source-b' },
    imageExtractor: { async extract() { extractorCalled = true; } },
  });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(extractorCalled, false);
  assert.deepEqual(calls[0].params, ['source-b', 'tenant-a']);
});

test('replacing an image hash retires prior current segments before inserting the new extraction', async () => {
  const transactionCalls = [];
  const database = { async connect() { return { async query(sql, params = []) { transactionCalls.push({ sql, params }); return { rows: [] }; }, release() {} }; } };
  const source = { id: 'source-1', tenant_id: 'tenant-a' };
  await persistImageExtractionSegments({
    database, source, job: { id: 'job-1', tenant_id: 'tenant-a' }, extraction: {
      extractionVersion: '1', sourceHash: 'd'.repeat(64), text: 'New fact.',
      extractionMethod: 'FAKE_TEST_EXTRACTOR', extractionConfidence: 0.9,
      segments: [{ order: 0, text: 'New fact.', role: 'BUSINESS', confidence: 0.9 }],
    },
  });
  const retireIndex = transactionCalls.findIndex(({ sql }) => /SET is_current = FALSE/i.test(sql));
  const insertIndex = transactionCalls.findIndex(({ sql }) => /INSERT INTO knowledge_source_extraction_segments/i.test(sql));
  assert.ok(retireIndex >= 0 && insertIndex > retireIndex);
  assert.equal(transactionCalls[insertIndex].params[3], 'd'.repeat(64));
});

test('image re-extraction does not delete segments still referenced by candidate evidence', () => {
  const source = fs.readFileSync(new URL('../services/knowledge-source-processing-service.js', import.meta.url), 'utf8');
  assert.match(source, /DELETE FROM knowledge_source_extraction_segments[\s\S]*NOT EXISTS[\s\S]*knowledge_candidate_image_evidence/i);
});

test('segment persistence rolls back on partial failure and reports processing failure', async () => {
  const transactionCalls = [];
  const storedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const sourceHash = crypto.createHash('sha256').update(storedPng).digest('hex');
  const database = {
    async query(sql, params = []) {
      transactionCalls.push({ sql, params });
      if (/SELECT id, tenant_id, source_type/i.test(sql)) return { rows: [{ id: 'source-1', tenant_id: 'tenant-a', source_type: 'DOCUMENT', content: '', mime_type: 'image/png', storage_key: 'private/image', content_hash: sourceHash, enabled: true, status: 'active', processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
      return { rows: [] };
    },
    async connect() {
      return { async query(sql, params = []) {
        transactionCalls.push({ sql, params });
        if (/INSERT INTO knowledge_source_extraction_segments/i.test(sql) && transactionCalls.filter(({ sql: item }) => /INSERT INTO knowledge_source_extraction_segments/i.test(item)).length === 2) throw Object.assign(new Error('segment write failed'), { code: 'SEGMENT_WRITE_FAILED' });
        return { rows: [] };
      }, release() {} };
    },
  };
  await assert.rejects(() => processKnowledgeProcessingJob({
    database,
    storage: { async get() { return storedPng; } },
    job: { id: 'job-1', tenant_id: 'tenant-a', source_id: 'source-1' },
    imageExtractor: { async extract() { return {
      extractionVersion: '1', sourceHash, mimeType: 'image/png', text: 'One. Two.', extractionConfidence: 0.8, extractionMethod: 'FAKE',
      segments: [{ order: 0, text: 'One.', role: 'BUSINESS', confidence: 0.8 }, { order: 1, text: 'Two.', role: 'UNKNOWN', confidence: 0.7 }],
    }; } },
  }), { code: 'SEGMENT_WRITE_FAILED' });
  assert.ok(transactionCalls.some(({ sql }) => /^ROLLBACK$/i.test(sql.trim())));
  assert.ok(transactionCalls.some(({ sql, params }) => /SET processing_status = 'FAILED'/i.test(sql) && params.includes('SEGMENT_WRITE_FAILED')));
});
