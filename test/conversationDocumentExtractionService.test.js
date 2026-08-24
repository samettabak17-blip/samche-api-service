import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  ConversationResourceExtractionError,
  extractDocumentText,
  getPdfParserRuntimeInfo,
} from '../services/conversation-document-extraction-service.js';

const knownGoodPdf = fs.readFileSync(new URL('./fixtures/pdf-extraction-known-good.pdf', import.meta.url));

test('reports the exact supported PDF parser runtime contract', async () => {
  const runtime = await getPdfParserRuntimeInfo();
  assert.equal(runtime.parser_version, '2.4.5');
  assert.equal(runtime.parser_callable, true);
});

test('extracts the known-good PDF Buffer through the production adapter', async () => {
  assert.equal(Buffer.isBuffer(knownGoodPdf), true);
  const result = await extractDocumentText({
    mimeType: 'application/pdf',
    bytes: knownGoodPdf,
    contentHash: crypto.createHash('sha256').update(knownGoodPdf).digest('hex'),
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.method, 'PDF_TEXT');
  assert.match(result.extractedText, /SC-WP-92817/);
  assert.match(result.extractedText, /37,450 AED/);
});

test('normalizes malformed PDF parser failures without leaking parser details', async () => {
  await assert.rejects(
    extractDocumentText({
      mimeType: 'application/pdf',
      bytes: Buffer.from('not a PDF'),
      contentHash: 'malformed',
    }),
    (error) => error instanceof ConversationResourceExtractionError
      && error.code === 'RESOURCE_EXTRACTION_FAILED',
  );
});

test('rejects a document with no usable extracted text', async () => {
  await assert.rejects(
    extractDocumentText({
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-empty'),
      contentHash: 'empty',
      extractPdf: async () => ' \n\t ',
    }),
    (error) => error instanceof ConversationResourceExtractionError
      && error.code === 'RESOURCE_EXTRACTION_EMPTY',
  );
});
