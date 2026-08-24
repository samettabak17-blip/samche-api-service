import crypto from 'node:crypto';

export class ConversationResourceExtractionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 200000);
}

function sanitizePdfParserMessage(value) {
  const raw = String(value ?? '');
  if (!raw || raw.includes('://') || raw.includes('\\n') || raw.includes('\\r')) return 'PDF parser failure';
  const firstLine = raw.split(/[\\r\\n]/, 1)[0].trim();
  return firstLine.length <= 180 && !firstLine.includes('=') ? firstLine : 'PDF parser failure';
}

export function buildSafePdfExtractionDiagnostic({ mimeType, byteLength, error, extractedCharacterCount = null }) {
  return {
    parser_name: 'pdf-parse',
    parser_version: null,
    mime_type: mimeType,
    byte_length: Number(byteLength) || 0,
    exception_name: error?.name ?? 'Error',
    exception_code: error?.code ?? null,
    sanitized_exception_message: sanitizePdfParserMessage(error?.message),
    extracted_character_count: Number.isInteger(extractedCharacterCount) ? extractedCharacterCount : null,
    extraction_phase: 'pdf_parse',
  };
}

function emitStagingPdfExtractionDiagnostic(diagnostic) {
  if (process.env.NODE_ENV === 'staging' || process.env.RENDER_SERVICE_NAME === 'samche-api-staging') {
    console.error('WHATSAPP_PDF_EXTRACTION_FAILURE', JSON.stringify(diagnostic));
  }
}

async function defaultPdfExtractor(bytes) {
  const module = await import('pdf-parse');
  const parse = module.default ?? module;
  const result = await parse(bytes);
  return result.text;
}

async function defaultDocxExtractor(bytes) {
  const module = await import('mammoth');
  const mammoth = module.default ?? module;
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value;
}

export async function extractDocumentText({
  mimeType, bytes, contentHash, existing = null,
  extractPdf = defaultPdfExtractor,
  extractDocx = defaultDocxExtractor,
}) {
  if (existing?.processing_status === 'READY' && existing.extraction_hash === contentHash && existing.extracted_text) {
    return {
      status: 'READY',
      method: existing.processing_method ?? 'REUSED',
      extractedText: existing.extracted_text,
      extractionHash: contentHash,
      reused: true,
    };
  }

  let text;
  let method;
  try {
    if (mimeType === 'text/plain') {
      text = bytes.toString('utf8');
      method = 'TEXT_DIRECT';
    } else if (mimeType === 'application/pdf') {
      text = await extractPdf(bytes);
      method = 'PDF_TEXT';
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = await extractDocx(bytes);
      method = 'DOCX_TEXT';
    } else {
      throw new ConversationResourceExtractionError('RESOURCE_EXTRACTION_UNSUPPORTED', 'Document type cannot be extracted');
    }
  } catch (error) {
    if (mimeType === 'application/pdf') emitStagingPdfExtractionDiagnostic(buildSafePdfExtractionDiagnostic({ mimeType, byteLength: bytes?.length, error }));
    if (error instanceof ConversationResourceExtractionError) throw error;
    throw new ConversationResourceExtractionError('RESOURCE_EXTRACTION_FAILED', 'Document could not be processed');
  }

  const extractedText = normalizeText(text);
  if (!extractedText) {
    throw new ConversationResourceExtractionError('RESOURCE_EXTRACTION_EMPTY', 'Document does not contain readable text');
  }

  return {
    status: 'READY',
    method,
    extractedText,
    extractionHash: contentHash ?? crypto.createHash('sha256').update(bytes).digest('hex'),
    reused: false,
  };
}
