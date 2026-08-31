import crypto from 'node:crypto';
import { validateImageKnowledgeInput } from './image-knowledge-extraction.js';

const MAX_KNOWLEDGE_SOURCE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_UPLOADS = Object.freeze({
  'application/pdf': { extension: 'pdf', signature: (bytes) => bytes.subarray(0, 5).toString('ascii') === '%PDF-' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: 'docx',
    signature: (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04,
  },
  'text/plain': {
    extension: 'txt',
    signature: (bytes) => !bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0),
  },
});

export class KnowledgeSourceIngestionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizedMime(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function bytesOf(file) {
  if (!Buffer.isBuffer(file?.buffer)) {
    throw new KnowledgeSourceIngestionError('KNOWLEDGE_SOURCE_FILE_REQUIRED', 'A knowledge source file is required');
  }
  return file.buffer;
}

export function validateKnowledgeUpload(file) {
  const buffer = bytesOf(file);
  const mimeType = normalizedMime(file?.mimetype);
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
    return validateImageKnowledgeInput(file);
  }
  const definition = SUPPORTED_UPLOADS[mimeType];
  const size = Number(file?.size ?? buffer.length);

  if (!definition) {
    throw new KnowledgeSourceIngestionError('KNOWLEDGE_SOURCE_TYPE_UNSUPPORTED', 'Only PDF, DOCX, and TXT knowledge sources are supported');
  }
  if (!Number.isInteger(size) || size <= 0 || size > MAX_KNOWLEDGE_SOURCE_BYTES || buffer.length !== size) {
    throw new KnowledgeSourceIngestionError('KNOWLEDGE_SOURCE_SIZE_INVALID', 'Knowledge source size is invalid');
  }
  if (!definition.signature(buffer)) {
    throw new KnowledgeSourceIngestionError('KNOWLEDGE_SOURCE_TYPE_MISMATCH', 'Knowledge source bytes do not match the declared file type');
  }

  return { buffer, mimeType, extension: definition.extension, sizeBytes: size };
}

export function buildKnowledgeStorageKey({ tenantId, sourceId, contentHash, extension }) {
  if (!tenantId || !sourceId || !/^[a-f0-9]{64}$/i.test(String(contentHash)) || !/^(pdf|docx|txt|jpg|jpeg|png)$/.test(String(extension))) {
    throw new KnowledgeSourceIngestionError('KNOWLEDGE_SOURCE_KEY_INVALID', 'Knowledge source storage key cannot be created');
  }
  return `knowledge/${tenantId}/${sourceId}/${String(contentHash).toLowerCase()}.${extension}`;
}

export function hashKnowledgeSource(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function normalizeManualKnowledge(value) {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    throw new KnowledgeSourceIngestionError('KNOWLEDGE_SOURCE_EMPTY', 'Knowledge content is required');
  }
  return text;
}

export const KNOWLEDGE_SOURCE_LIMITS = Object.freeze({
  maxUploadBytes: MAX_KNOWLEDGE_SOURCE_BYTES,
  supportedMimeTypes: Object.freeze([...Object.keys(SUPPORTED_UPLOADS), 'image/jpeg', 'image/png']),
});
