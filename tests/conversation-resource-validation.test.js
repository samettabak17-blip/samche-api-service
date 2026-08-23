import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversationStorageKey,
  validateConversationUpload,
} from '../services/conversation-resource-validation.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const resourceId = '33333333-3333-4333-8333-333333333333';

test('accepts a real PDF signature rather than trusting its filename', () => {
  const buffer = Buffer.from('%PDF-1.7\n');
  const result = validateConversationUpload({
    originalname: '../../license.png',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
  });
  assert.equal(result.mediaCategory, 'DOCUMENT');
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.originalFilename, 'license.png');
});

test('rejects a declared image that has no matching image signature', () => {
  assert.throws(
    () => validateConversationUpload({
      originalname: 'screen.png',
      mimetype: 'image/png',
      size: 8,
      buffer: Buffer.from('%PDF-1.7'),
    }),
    { code: 'RESOURCE_FILE_SIGNATURE_INVALID' }
  );
});

test('enforces attachment count and generated keys never include customer filenames', () => {
  assert.throws(
    () => validateConversationUpload({
      originalname: 'note.txt',
      mimetype: 'text/plain',
      size: 5,
      buffer: Buffer.from('hello'),
    }, { attachmentCount: 5 }),
    { code: 'RESOURCE_ATTACHMENT_LIMIT_EXCEEDED' }
  );
  const key = buildConversationStorageKey({ tenantId, conversationId, resourceId });
  assert.equal(key, `conversation-resources/${tenantId}/${conversationId}/${resourceId}`);
  assert.equal(key.includes('note.txt'), false);
});
