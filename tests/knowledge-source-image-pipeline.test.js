import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createUploadedKnowledgeSource } from '../services/knowledge-source-service.js';
import { processKnowledgeProcessingJob } from '../services/knowledge-source-processing-service.js';
import { IMAGE_KNOWLEDGE_EXTRACTION_VERSION } from '../services/image-knowledge-extraction.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0xff, 0xd9]);

function pipelineFixture() {
  const objects = new Map();
  let source;
  const writes = [];
  const database = {
    async query(sql, params = []) {
      if (/INSERT INTO knowledge_base_documents/i.test(sql)) {
        source = { id: params[0], tenant_id: params[1], source_type: 'DOCUMENT', content: '', original_filename: params[3], mime_type: params[4], size_bytes: params[5], storage_key: params[6], content_hash: params[7], enabled: true, status: 'active', processing_status: 'UPLOADED', indexing_status: 'PENDING' };
        return { rows: [{ id: source.id, tenant_id: source.tenant_id, processing_status: source.processing_status, indexing_status: source.indexing_status }] };
      }
      if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) return { rows: [{ id: 'job-image', status: 'PENDING' }] };
      if (/SELECT id, tenant_id, source_type/i.test(sql)) return { rows: [source] };
      return { rows: [] };
    },
    async connect() { return { async query() { return { rows: [] }; }, release() {} }; },
  };
  const storage = {
    async put({ key, body, mimeType }) { objects.set(key, Buffer.from(body)); writes.push({ key, body: Buffer.from(body), mimeType }); },
    async get({ key }) { return Buffer.from(objects.get(key)); },
  };
  return { database, storage, writes, get source() { return source; } };
}

for (const fixture of [
  { name: 'whatsapp.png', mimeType: 'image/png', bytes: png },
  { name: 'whatsapp.jpg', mimeType: 'image/jpeg', bytes: jpeg },
  { name: 'whatsapp.jpeg', mimeType: 'image/jpeg', bytes: jpeg },
]) {
  test(`persists and processes ${fixture.name} with original-byte hash integrity`, async () => {
    const testPipeline = pipelineFixture();
    const created = await createUploadedKnowledgeSource({
      database: testPipeline.database,
      storage: testPipeline.storage,
      tenantId,
      title: fixture.name,
      file: { originalname: fixture.name, mimetype: fixture.mimeType, size: fixture.bytes.length, buffer: fixture.bytes },
    });
    const expectedHash = crypto.createHash('sha256').update(fixture.bytes).digest('hex');
    assert.equal(testPipeline.source.content_hash, expectedHash);
    assert.deepEqual(testPipeline.writes[0].body, fixture.bytes);

    let extractionInput;
    const result = await processKnowledgeProcessingJob({
      database: testPipeline.database,
      storage: testPipeline.storage,
      job: { id: 'job-image', tenant_id: tenantId, source_id: created.id },
      imageExtractor: { async extract(input) {
        extractionInput = input;
        return {
          extractionVersion: IMAGE_KNOWLEDGE_EXTRACTION_VERSION,
          sourceHash: input.sourceHash,
          mimeType: input.mimeType,
          text: 'Business policy screenshot.',
          segments: [{ order: 0, text: 'Business policy screenshot.', role: 'BUSINESS', confidence: 0.99 }],
          extractionConfidence: 0.99,
          extractionMethod: 'FAKE_TEST_EXTRACTOR',
        };
      } },
    });

    assert.equal(result.status, 'READY');
    assert.deepEqual(extractionInput.bytes, fixture.bytes);
    assert.equal(extractionInput.sourceHash, expectedHash);
    assert.equal(extractionInput.mimeType, fixture.mimeType);
  });
}
