import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KnowledgeSourceIngestionError,
  buildKnowledgeStorageKey,
  validateKnowledgeUpload,
} from '../services/knowledge-source-ingestion-service.js';

test('rejects a file whose declared PDF MIME type does not match its binary signature before storage', () => {
  assert.throws(
    () => validateKnowledgeUpload({
      originalname: 'policy.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('PK\x03\x04not-a-pdf'),
      size: 16,
    }),
    (error) => error instanceof KnowledgeSourceIngestionError && error.code === 'KNOWLEDGE_SOURCE_TYPE_MISMATCH'
  );
});

test('accepts a real PDF signature and derives a tenant-safe storage key without exposing the original filename', () => {
  const file = validateKnowledgeUpload({
    originalname: '../../customer-policy.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nminimal'),
    size: 16,
  });

  const key = buildKnowledgeStorageKey({
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    contentHash: 'a'.repeat(64),
    extension: file.extension,
  });

  assert.equal(file.mimeType, 'application/pdf');
  assert.equal(file.extension, 'pdf');
  assert.match(key, /^knowledge\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\/a{64}\.pdf$/);
  assert.doesNotMatch(key, /customer-policy/i);
});

test('does not accept a DOCX upload unless it has a ZIP container signature', () => {
  assert.throws(
    () => validateKnowledgeUpload({
      originalname: 'guide.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('not-a-zip'),
      size: 9,
    }),
    (error) => error instanceof KnowledgeSourceIngestionError && error.code === 'KNOWLEDGE_SOURCE_TYPE_MISMATCH'
  );
});
