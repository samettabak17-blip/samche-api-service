import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWhatsAppInboundText } from '../services/whatsapp-inbound-message.js';

test('keeps existing WhatsApp text and caption precedence', () => {
  assert.equal(extractWhatsAppInboundText({ text: { body: 'text' }, image: { caption: 'image' } }), 'text');
  assert.equal(extractWhatsAppInboundText({ image: { caption: 'image' } }), 'image');
  assert.equal(extractWhatsAppInboundText({ document: { caption: 'document' } }), 'document');
  assert.equal(extractWhatsAppInboundText({ interactive: { button_reply: { title: 'select' } } }), 'select');
});

test('keeps media-without-caption valid as an empty text message', () => {
  assert.equal(extractWhatsAppInboundText({ image: { id: 'meta-id' } }), '');
});
