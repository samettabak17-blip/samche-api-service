import crypto from 'node:crypto';
import { extractDocumentText, getPdfParserRuntimeInfo } from '../services/conversation-document-extraction-service.js';

function textPdf(lines) {
  const stream = `BT /F1 12 Tf 72 720 Td (${lines[0]}) Tj 0 -20 Td (${lines[1]}) Tj ET`;
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\\nstream\\n${stream}\\nendstream`,
  ];
  let pdf = '%PDF-1.4\\n'; const offsets = [0];
  bodies.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\\n${body}\\nendobj\\n`; });
  const xref = Buffer.byteLength(pdf); pdf += 'xref\\n0 6\\n0000000000 65535 f \\n';
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \\n`; });
  return Buffer.from(`${pdf}trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n${xref}\\n%%EOF\\n`);
}

const bytes = textPdf(['Reference: SC-WP-92817', 'Amount: 37,450 AED']);
let runtime = { parser_version: null, parser_callable: null, node_version: process.version };
try {
  runtime = await getPdfParserRuntimeInfo();
  const result = await extractDocumentText({ mimeType: 'application/pdf', bytes, contentHash: crypto.createHash('sha256').update(bytes).digest('hex') });
  console.info('STAGING_PDF_EXTRACTION_PROBE', JSON.stringify({ ...runtime, input_is_buffer: Buffer.isBuffer(bytes), input_byte_length: bytes.length, result: 'PASS', extracted_character_count: result.extractedText.length }));
} catch (error) {
  console.info('STAGING_PDF_EXTRACTION_PROBE', JSON.stringify({ ...runtime, node_version: process.version, input_is_buffer: Buffer.isBuffer(bytes), input_byte_length: bytes.length, result: 'FAIL', exception_name: error?.name ?? 'Error', exception_category: error?.code ?? 'PDFJS_UNKNOWN_ERROR', message_fingerprint: crypto.createHash('sha256').update(String(error?.message ?? '')).digest('hex').slice(0, 16) }));
  process.exitCode = 1;
}
