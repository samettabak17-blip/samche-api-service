import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractWhatsAppMediaDescriptor,
  whatsappIntegrationKey,
} from '../services/whatsapp-multimodal-service.js';

test('uses the explicit WhatsApp phone-number integration key without a default fallback', () => {
  assert.equal(whatsappIntegrationKey('1234567890'), 'WHATSAPP:1234567890');
  assert.throws(() => whatsappIntegrationKey(''), { code: 'WHATSAPP_PHONE_NUMBER_ID_REQUIRED' });
});

test('describes an image with its Meta media identity and caption', () => {
  assert.deepEqual(extractWhatsAppMediaDescriptor({
    id: 'wamid.image-1',
    image: { id: 'meta-media-image-1', mime_type: 'image/jpeg', caption: 'Why am I seeing this error?' },
  }), {
    externalMediaId: 'meta-media-image-1',
    sourceReference: 'wamid.image-1:meta-media-image-1',
    declaredMimeType: 'image/jpeg',
    originalFilename: 'whatsapp-image-wamid.image-1.jpg',
    caption: 'Why am I seeing this error?',
  });
});

test('describes a document without fabricating customer intent when it has no caption', () => {
  assert.deepEqual(extractWhatsAppMediaDescriptor({
    id: 'wamid.document-1',
    document: { id: 'meta-media-document-1', mime_type: 'application/pdf', filename: 'trade-license.pdf' },
  }), {
    externalMediaId: 'meta-media-document-1',
    sourceReference: 'wamid.document-1:meta-media-document-1',
    declaredMimeType: 'application/pdf',
    originalFilename: 'trade-license.pdf',
    caption: '',
  });
});

test('does not treat unsupported WhatsApp payloads as resources', () => {
  assert.equal(extractWhatsAppMediaDescriptor({ id: 'wamid.audio', audio: { id: 'meta-audio' } }), null);
});

