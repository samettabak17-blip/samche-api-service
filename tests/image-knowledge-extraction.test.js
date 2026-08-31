import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_KNOWLEDGE_EXTRACTION_VERSION,
  validateImageKnowledgeInput,
  validateImageKnowledgeExtraction,
  createFakeImageKnowledgeExtractor,
} from '../services/image-knowledge-extraction.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sourceHash = 'a'.repeat(64);

function file({ name = 'screenshot.jpg', mime = 'image/jpeg', bytes = jpeg } = {}) {
  return { originalname: name, mimetype: mime, size: bytes.length, buffer: bytes };
}

function extraction(overrides = {}) {
  return {
    extractionVersion: IMAGE_KNOWLEDGE_EXTRACTION_VERSION,
    sourceHash,
    mimeType: 'image/jpeg',
    text: 'Business response. Customer question.',
    segments: [
      { order: 0, text: 'Business response.', role: 'BUSINESS', confidence: 0.98 },
      { order: 1, text: 'Customer question.', role: 'CUSTOMER', confidence: 0.95 },
      { order: 2, text: 'Uncertain text.', role: 'UNKNOWN', confidence: 0.42 },
    ],
    extractionConfidence: 0.9,
    extractionMethod: 'FAKE_TEST_EXTRACTOR',
    ...overrides,
  };
}

test('accepts JPG, JPEG, and PNG with matching MIME and magic bytes', () => {
  assert.equal(validateImageKnowledgeInput(file()).extension, 'jpg');
  assert.equal(validateImageKnowledgeInput(file({ name: 'screen.jpeg' })).extension, 'jpeg');
  assert.equal(validateImageKnowledgeInput(file({ name: 'screen.png', mime: 'image/png', bytes: png })).extension, 'png');
});

test('rejects invalid extensions and MIME types', () => {
  assert.throws(() => validateImageKnowledgeInput(file({ name: 'screen.gif' })), { code: 'IMAGE_EXTENSION_UNSUPPORTED' });
  assert.throws(() => validateImageKnowledgeInput(file({ mime: 'image/webp' })), { code: 'IMAGE_MIME_UNSUPPORTED' });
});

test('rejects MIME/signature mismatches', () => {
  assert.throws(() => validateImageKnowledgeInput(file({ name: 'screen.jpg', mime: 'image/jpeg', bytes: png })), { code: 'IMAGE_SIGNATURE_MISMATCH' });
  assert.throws(() => validateImageKnowledgeInput(file({ name: 'screen.png', mime: 'image/png', bytes: jpeg })), { code: 'IMAGE_SIGNATURE_MISMATCH' });
});

test('rejects oversized images', () => {
  assert.throws(() => validateImageKnowledgeInput({ ...file(), size: 25 * 1024 * 1024 + 1, buffer: Buffer.alloc(25 * 1024 * 1024 + 1) }), { code: 'IMAGE_SIZE_INVALID' });
});

test('accepts canonical BUSINESS, CUSTOMER, and UNKNOWN segments in deterministic order', () => {
  const result = validateImageKnowledgeExtraction(extraction());
  assert.deepEqual(result.segments.map((segment) => segment.role), ['BUSINESS', 'CUSTOMER', 'UNKNOWN']);
  assert.deepEqual(result.segments.map((segment) => segment.order), [0, 1, 2]);
});

test('rejects invalid roles, confidence, missing source hash, and malformed output', () => {
  assert.throws(() => validateImageKnowledgeExtraction(extraction({ segments: [{ order: 0, text: 'x', role: 'SYSTEM', confidence: 0.5 }] })), { code: 'IMAGE_EXTRACTION_ROLE_INVALID' });
  assert.throws(() => validateImageKnowledgeExtraction(extraction({ extractionConfidence: 1.1 })), { code: 'IMAGE_EXTRACTION_CONFIDENCE_INVALID' });
  assert.throws(() => validateImageKnowledgeExtraction(extraction({ sourceHash: null })), { code: 'IMAGE_EXTRACTION_SOURCE_HASH_INVALID' });
  assert.throws(() => validateImageKnowledgeExtraction({}), { code: 'IMAGE_EXTRACTION_VERSION_INVALID' });
});

test('requires non-empty normalized text and preserves segment ordering', () => {
  const result = validateImageKnowledgeExtraction(extraction({ text: '  first\n\nsecond  ', segments: [
    { order: 2, text: 'second', role: 'UNKNOWN', confidence: 0.5 },
    { order: 3, text: 'third', role: 'BUSINESS', confidence: 0.6 },
  ] }));
  assert.equal(result.text, 'first\n\nsecond');
  assert.deepEqual(result.segments.map(({ order }) => order), [2, 3]);
  assert.throws(() => validateImageKnowledgeExtraction(extraction({ text: '   ' })), { code: 'IMAGE_EXTRACTION_TEXT_EMPTY' });
});

test('fake extractor validates deterministic fixtures without provider or network calls', async () => {
  const extractor = createFakeImageKnowledgeExtractor(extraction());
  const result = await extractor.extract({ bytes: jpeg, mimeType: 'image/jpeg', sourceHash });
  assert.equal(result.extractionMethod, 'FAKE_TEST_EXTRACTOR');
  assert.equal(result.sourceHash, sourceHash);
});
