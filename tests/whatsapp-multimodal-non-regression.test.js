import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiImagePart,
  buildUntrustedDocumentContext,
  extractWhatsAppMediaDescriptor,
} from '../services/whatsapp-multimodal-service.js';
import { extractDocumentText } from '../services/conversation-document-extraction-service.js';

test('WHATSAPP MULTIMODAL NON-REGRESSION: Descriptor extraction parses images and documents', () => {
  const imageMsg = {
    id: 'wamid.123',
    image: { id: 'media-img-1', mime_type: 'image/jpeg', caption: 'Garden area' },
  };
  const imgDesc = extractWhatsAppMediaDescriptor(imageMsg);
  assert.equal(imgDesc.externalMediaId, 'media-img-1');
  assert.equal(imgDesc.declaredMimeType, 'image/jpeg');
  assert.equal(imgDesc.caption, 'Garden area');

  const docMsg = {
    id: 'wamid.456',
    document: { id: 'media-doc-1', mime_type: 'application/pdf', filename: 'invoice.pdf' },
  };
  const docDesc = extractWhatsAppMediaDescriptor(docMsg);
  assert.equal(docDesc.externalMediaId, 'media-doc-1');
  assert.equal(docDesc.declaredMimeType, 'application/pdf');
  assert.equal(docDesc.originalFilename, 'invoice.pdf');
});

test('WHATSAPP MULTIMODAL NON-REGRESSION: Gemini image part builder creates valid inline data', () => {
  const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const part = buildGeminiImagePart({ mimeType: 'image/png', bytes: fakePng });
  assert.ok(part.inline_data);
  assert.equal(part.inline_data.mime_type, 'image/png');
  assert.equal(part.inline_data.data, fakePng.toString('base64'));
});

test('WHATSAPP MULTIMODAL NON-REGRESSION: Document text extraction reads plain text and PDFs', async () => {
  const plainText = Buffer.from('Order #99214: Delivered to Dubai Marina', 'utf8');
  const result = await extractDocumentText({
    mimeType: 'text/plain',
    bytes: plainText,
    contentHash: 'hash-plain-1',
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.method, 'TEXT_DIRECT');
  assert.match(result.extractedText, /Order #99214/);

  const untrustedContext = buildUntrustedDocumentContext(result.extractedText);
  assert.match(untrustedContext, /<customer_document_evidence>/);
  assert.match(untrustedContext, /Order #99214/);
});
