import crypto from 'node:crypto';
import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';

const fixtureRevision = 'reportlab-static-v1';
const bytes = fs.readFileSync(new URL('../test/fixtures/pdf-extraction-known-good.pdf', import.meta.url));
const fixtureSha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const base = { parser_name: 'pdf-parse', parser_version: '2.4.5', node_version: process.version, fixture_revision: fixtureRevision, fixture_sha256: fixtureSha, input_byte_length: bytes.length, fixture_header_valid: bytes.subarray(0, 5).toString('ascii') === '%PDF-', fixture_eof_present: bytes.includes(Buffer.from('%%EOF')) };
try {
  const parser = new PDFParse({ data: bytes });
  const result = await parser.getText();
  await parser.destroy();
  const text = result.text ?? '';
  if (!text.includes('SC-WP-92817') || !text.includes('37,450 AED')) throw new Error('PDF_PROBE_EXPECTED_TEXT_MISSING');
  console.info('STAGING_PDF_PARSER_COMPARISON', JSON.stringify({ ...base, result: 'PASS', extracted_character_count: text.length }));
} catch (error) {
  console.info('STAGING_PDF_PARSER_COMPARISON', JSON.stringify({ ...base, result: 'FAIL', exception_name: error?.name ?? 'Error', exception_category: error?.code ?? 'OTHER_PARSER_ERROR', message_fingerprint: crypto.createHash('sha256').update(String(error?.message ?? '')).digest('hex').slice(0,16) }));
  process.exitCode = 1;
}
