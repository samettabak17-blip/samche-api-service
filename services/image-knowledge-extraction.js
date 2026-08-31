const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_TYPES = Object.freeze({
  'image/jpeg': Object.freeze({ extensions: new Set(['jpg', 'jpeg']), signature: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }),
  'image/png': Object.freeze({ extensions: new Set(['png']), signature: (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }),
});
const ROLES = new Set(['BUSINESS', 'CUSTOMER', 'UNKNOWN']);
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
export const IMAGE_KNOWLEDGE_EXTRACTION_VERSION = '1';

export class ImageKnowledgeExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageKnowledgeExtractionError';
    this.code = code;
  }
}

function normalizedMime(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function extensionOf(filename) {
  const basename = String(filename ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  const match = /\.([a-z0-9]+)$/i.exec(basename);
  return match?.[1]?.toLowerCase() ?? '';
}

function normalizeText(value, code) {
  const normalized = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) throw new ImageKnowledgeExtractionError(code, 'Image extraction text is required');
  return normalized;
}

function boundedConfidence(value, code) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ImageKnowledgeExtractionError(code, 'Image extraction confidence is invalid');
  }
  return confidence;
}

export function validateImageKnowledgeInput(file) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
    throw new ImageKnowledgeExtractionError('IMAGE_INPUT_REQUIRED', 'An image is required');
  }
  const mimeType = normalizedMime(file?.mimetype);
  const definition = IMAGE_MIME_TYPES[mimeType];
  if (!definition) throw new ImageKnowledgeExtractionError('IMAGE_MIME_UNSUPPORTED', 'Image MIME type is unsupported');
  const extension = extensionOf(file?.originalname);
  if (!definition.extensions.has(extension)) {
    throw new ImageKnowledgeExtractionError('IMAGE_EXTENSION_UNSUPPORTED', 'Image extension is unsupported');
  }
  const size = Number(file?.size ?? file.buffer.length);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES || size !== file.buffer.length) {
    throw new ImageKnowledgeExtractionError('IMAGE_SIZE_INVALID', 'Image size is invalid');
  }
  if (!definition.signature(file.buffer)) {
    throw new ImageKnowledgeExtractionError('IMAGE_SIGNATURE_MISMATCH', 'Image bytes do not match the declared type');
  }
  return { buffer: file.buffer, mimeType, extension, sizeBytes: size };
}

function normalizeLocator(locator) {
  if (locator === undefined) return undefined;
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) {
    throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_LOCATOR_INVALID', 'Image extraction source locator is invalid');
  }
  const result = {};
  for (const key of ['page', 'x', 'y', 'width', 'height']) {
    if (locator[key] === undefined) continue;
    const number = Number(locator[key]);
    if (!Number.isFinite(number) || number < 0) throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_LOCATOR_INVALID', 'Image extraction source locator is invalid');
    result[key] = number;
  }
  return result;
}

export function validateImageKnowledgeExtraction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_OUTPUT_INVALID', 'Image extraction output is invalid');
  }
  if (String(value.extractionVersion ?? '') !== IMAGE_KNOWLEDGE_EXTRACTION_VERSION) {
    throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_VERSION_INVALID', 'Image extraction version is invalid');
  }
  const sourceHash = String(value.sourceHash ?? '').toLowerCase();
  if (!HASH_PATTERN.test(sourceHash)) throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_SOURCE_HASH_INVALID', 'Image extraction source hash is invalid');
  const mimeType = normalizedMime(value.mimeType);
  if (!IMAGE_MIME_TYPES[mimeType]) throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_MIME_INVALID', 'Image extraction MIME type is invalid');
  const text = normalizeText(value.text, 'IMAGE_EXTRACTION_TEXT_EMPTY');
  if (!Array.isArray(value.segments)) throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_SEGMENTS_INVALID', 'Image extraction segments are invalid');
  const segments = value.segments.map((segment) => {
    if (!segment || typeof segment !== 'object' || !Number.isInteger(segment.order) || segment.order < 0) {
      throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_SEGMENT_INVALID', 'Image extraction segment is invalid');
    }
    const role = String(segment.role ?? '').toUpperCase();
    if (!ROLES.has(role)) throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_ROLE_INVALID', 'Image extraction role is invalid');
    return {
      order: segment.order,
      text: normalizeText(segment.text, 'IMAGE_EXTRACTION_SEGMENT_TEXT_EMPTY'),
      role,
      confidence: boundedConfidence(segment.confidence, 'IMAGE_EXTRACTION_CONFIDENCE_INVALID'),
      ...(segment.sourceLocator === undefined ? {} : { sourceLocator: normalizeLocator(segment.sourceLocator) }),
    };
  });
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index - 1].order >= segments[index].order) {
      throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_ORDER_INVALID', 'Image extraction segment order is invalid');
    }
  }
  return {
    extractionVersion: IMAGE_KNOWLEDGE_EXTRACTION_VERSION,
    sourceHash,
    mimeType,
    text,
    segments,
    extractionConfidence: boundedConfidence(value.extractionConfidence, 'IMAGE_EXTRACTION_CONFIDENCE_INVALID'),
    extractionMethod: String(value.extractionMethod ?? '').trim().slice(0, 128) || (() => { throw new ImageKnowledgeExtractionError('IMAGE_EXTRACTION_METHOD_INVALID', 'Image extraction method is invalid'); })(),
  };
}

export function createFakeImageKnowledgeExtractor(result) {
  const canonical = validateImageKnowledgeExtraction(result);
  return Object.freeze({
    async extract() {
      return structuredClone(canonical);
    },
  });
}

export const IMAGE_KNOWLEDGE_LIMITS = Object.freeze({
  maxImageBytes: MAX_IMAGE_BYTES,
  supportedMimeTypes: Object.freeze(Object.keys(IMAGE_MIME_TYPES)),
});
