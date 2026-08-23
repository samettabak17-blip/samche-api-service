import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentText } from '../services/conversation-document-extraction-service.js';

test('normalizes plain-text documents without invoking a model', async () => {
  const result = await extractDocumentText({
    mimeType: 'text/plain',
    bytes: Buffer.from('  License activity\r\nE-commerce  '),
    contentHash: 'a'.repeat(64),
  });
  assert.deepEqual(result, {
    status: 'READY',
    method: 'TEXT_DIRECT',
    extractedText: 'License activity\nE-commerce',
    extractionHash: 'a'.repeat(64),
    reused: false,
  });
});

test('reuses an immutable extraction checkpoint without re-extracting', async () => {
  let calls = 0;
  const result = await extractDocumentText({
    mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-'),
    contentHash: 'b'.repeat(64),
    existing: { extraction_hash: 'b'.repeat(64), processing_status: 'READY', extracted_text: 'Already stored' },
    extractPdf: async () => { calls += 1; return 'never'; },
  });
  assert.equal(calls, 0);
  assert.equal(result.reused, true);
  assert.equal(result.extractedText, 'Already stored');
});

test('rejects empty document extraction rather than pretending content is understood', async () => {
  await assert.rejects(
    () => extractDocumentText({ mimeType: 'text/plain', bytes: Buffer.from('   '), contentHash: 'c'.repeat(64) }),
    { code: 'RESOURCE_EXTRACTION_EMPTY' }
  );
});
