import crypto from 'node:crypto';

export class ConversationResourceValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MAX_ATTACHMENT_COUNT = 4;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const supportedMimeTypes = new Map([
  ['application/pdf', 'DOCUMENT'],
  ['text/plain', 'DOCUMENT'],
  ['image/jpeg', 'IMAGE'],
  ['image/png', 'IMAGE'],
  ['image/webp', 'IMAGE'],
]);

function isPdf(buffer) {
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function isPng(buffer) {
  return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isWebp(buffer) {
  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

function isText(buffer) {
  if (!buffer.length) return false;
  return !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
}

function hasExpectedSignature(mimeType, buffer) {
  if (mimeType === 'application/pdf') return isPdf(buffer);
  if (mimeType === 'image/png') return isPng(buffer);
  if (mimeType === 'image/jpeg') return isJpeg(buffer);
  if (mimeType === 'image/webp') return isWebp(buffer);
  if (mimeType === 'text/plain') return isText(buffer);
  return false;
}

function safeDisplayFilename(name) {
  const finalPart = String(name ?? '').replace(/\\/g, '/').split('/').pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  return finalPart.slice(0, 255) || 'attachment';
}

export function validateConversationUpload(file, { attachmentCount = 1 } = {}) {
  if (!Number.isInteger(attachmentCount) || attachmentCount < 1 || attachmentCount > MAX_ATTACHMENT_COUNT) {
    throw new ConversationResourceValidationError('RESOURCE_ATTACHMENT_LIMIT_EXCEEDED', `A message may contain at most ${MAX_ATTACHMENT_COUNT} attachments`);
  }
  if (!file || !Buffer.isBuffer(file.buffer) || !Number.isInteger(file.size)) {
    throw new ConversationResourceValidationError('RESOURCE_FILE_MALFORMED', 'Attachment payload is malformed');
  }
  if (file.size <= 0 || file.buffer.length === 0 || file.size !== file.buffer.length) {
    throw new ConversationResourceValidationError('RESOURCE_FILE_EMPTY', 'Attachment must contain data');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ConversationResourceValidationError('RESOURCE_FILE_TOO_LARGE', 'Attachment exceeds the maximum size');
  }
  const mediaCategory = supportedMimeTypes.get(file.mimetype);
  if (!mediaCategory) {
    throw new ConversationResourceValidationError('RESOURCE_MEDIA_TYPE_UNSUPPORTED', 'Attachment type is not supported');
  }
  if (!hasExpectedSignature(file.mimetype, file.buffer)) {
    throw new ConversationResourceValidationError('RESOURCE_FILE_SIGNATURE_INVALID', 'Attachment content does not match its declared type');
  }
  return {
    mediaCategory,
    mimeType: file.mimetype,
    originalFilename: safeDisplayFilename(file.originalname),
    sizeBytes: file.size,
    contentHash: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  };
}

export function buildConversationStorageKey({ tenantId, conversationId, resourceId }) {
  return `conversation-resources/${tenantId}/${conversationId}/${resourceId}`;
}

export const conversationResourceLimits = Object.freeze({ MAX_ATTACHMENT_COUNT, MAX_FILE_BYTES });
