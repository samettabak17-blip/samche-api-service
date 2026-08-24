import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { extractDocumentText, getPdfParserRuntimeInfo } from '../services/conversation-document-extraction-service.js';

const fixtureRevision = 'reportlab-static-v1';
const bytes = fs.readFileSync(new URL('../test/fixtures/pdf-extraction-known-good.pdf', import.meta.url));

let runtime = { parser_version: null, parser_callable: null, node_version: process.version };
try {
  runtime = await getPdfParserRuntimeInfo();
  const result = await extractDocumentText({ mimeType: 'application/pdf', bytes, contentHash: crypto.createHash('sha256').update(bytes).digest('hex') });
  if (!result.extractedText.includes('SC-WP-92817') || !result.extractedText.includes('37,450 AED')) throw new Error('PDF_PROBE_EXPECTED_TEXT_MISSING');
  console.info('STAGING_PDF_EXTRACTION_PROBE', JSON.stringify({ ...runtime, fixture_revision: fixtureRevision, fixture_sha256: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16), input_is_buffer: Buffer.isBuffer(bytes), input_byte_length: bytes.length, result: 'PASS', extracted_character_count: result.extractedText.length }));
} catch (error) {
  console.info('STAGING_PDF_EXTRACTION_PROBE', JSON.stringify({ ...runtime, node_version: process.version, input_is_buffer: Buffer.isBuffer(bytes), input_byte_length: bytes.length, result: 'FAIL', exception_name: error?.name ?? 'Error', exception_category: error?.code ?? 'PDFJS_UNKNOWN_ERROR', message_fingerprint: crypto.createHash('sha256').update(String(error?.message ?? '')).digest('hex').slice(0, 16) }));
  process.exitCode = 1;
}
