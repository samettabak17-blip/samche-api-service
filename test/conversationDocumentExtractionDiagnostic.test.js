import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSafePdfExtractionDiagnostic } from '../services/conversation-document-extraction-service.js';

test('captures only safe parser failure fields', () => {
  const diagnostic = buildSafePdfExtractionDiagnostic({
    mimeType: 'application/pdf',
    byteLength: 1234,
    error: Object.assign(new Error('Invalid PDF at https://private.example/file.pdf Reference: SC-WP-92817'), { code: 'PDF_BAD_XREF' }),
  });
  assert.equal(diagnostic.parser_name, 'pdf-parse');
  assert.equal(diagnostic.mime_type, 'application/pdf');
  assert.equal(diagnostic.byte_length, 1234);
  assert.equal(diagnostic.exception_code, 'PDF_BAD_XREF');
  assert.doesNotMatch(diagnostic.sanitized_exception_message, /SC-WP-92817|private\\.example/);
});

