import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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

function resolvedPdfParseVersion() {
  try { return require('pdf-parse/package.json').version ?? null; } catch { return null; }
}

function classifyPdfParserError(error) {
  const name = String(error?.name ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  if (/password/.test(message)) return 'PASSWORD_PROTECTED';
  if (/xref/.test(message)) return 'INVALID_XREF';
  if (/invalid.*pdf|invalidpdf/.test(message)) return 'INVALID_PDF';
  if (/format/.test(message)) return 'FORMAT_ERROR';
  if (/missing.*data/.test(message)) return 'MISSING_DATA';
  if (name === 'UnknownErrorException') return 'PDFJS_UNKNOWN_ERROR';
  return 'OTHER_PARSER_ERROR';
}

function safePdfParserMessage(error) {
  const message = String(error?.message ?? '');
  return { message_length: message.length, message_fingerprint: crypto.createHash('sha256').update(message).digest('hex').slice(0, 16), sanitized_exception_message: classifyPdfParserError(error) };
}

export function buildSafePdfExtractionDiagnostic({ mimeType, byteLength, error, extractedCharacterCount = null }) {
  return {
    parser_name: 'pdf-parse',
    parser_version: resolvedPdfParseVersion(),
    mime_type: mimeType,
    byte_length: Number(byteLength) || 0,
    exception_name: error?.name ?? 'Error',
    exception_code: error?.code ?? null,
    ...safePdfParserMessage(error),
    extracted_character_count: Number.isInteger(extractedCharacterCount) ? extractedCharacterCount : null,
    extraction_phase: 'pdf_parse',
    parser_callable: error?.pdfParserInput?.parser_callable ?? null,
    input_is_buffer: error?.pdfParserInput?.input_is_buffer ?? null,
    input_byte_length: error?.pdfParserInput?.input_byte_length ?? null,
  };
}

function emitStagingPdfExtractionDiagnostic(diagnostic) {
  console.error('WHATSAPP_PDF_EXTRACTION_FAILURE', JSON.stringify(diagnostic));
}

export async function getPdfParserRuntimeInfo() {
  const module = await import('pdf-parse');
  const parser = module.default ?? module;
  return { parser_version: resolvedPdfParseVersion(), node_version: process.version, parser_callable: typeof parser === 'function' };
}

async function defaultPdfExtractor(bytes) {
  const module = await import('pdf-parse');
  const parse = module.default ?? module;
  try {
    const result = await parse(Buffer.from(bytes));
    return result.text;
  } catch (error) {
    error.pdfParserInput = { parser_callable: typeof parse === 'function', input_is_buffer: Buffer.isBuffer(bytes), input_byte_length: bytes?.length ?? 0 };
    throw error;
  }
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
