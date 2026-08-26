import assert from 'node:assert/strict';
import test from 'node:test';
import { WhatsAppDeliveryError, deliverWhatsAppMedia } from '../services/whatsapp-delivery-service.js';

const env = { WHATSAPP_PHONE_ID: '948536645017374', WHATSAPP_TOKEN: 'test-token' };
const file = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), size: 11, mimetype: 'image/png', originalname: 'company-logo.png' };

test('uploads a validated WhatsApp image then sends it using the mapped phone number', async () => {
  const calls = [];
  const result = await deliverWhatsAppMedia({ phoneNumberId: '948536645017374', recipient: 'whatsapp:15551234567', file, caption: 'Please review this.', env, httpClient: {
    async post(url, body) { calls.push({ url, body }); return url.endsWith('/media') ? { data: { id: 'meta-upload-1' } } : { data: { messages: [{ id: 'wamid.agent-media-1' }] } }; },
  }});
  assert.equal(result.delivery, 'SENT_TO_WHATSAPP');
  assert.equal(result.mediaId, 'meta-upload-1');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/948536645017374\/media$/);
  assert.deepEqual(calls[1].body, { messaging_product: 'whatsapp', to: '15551234567', type: 'image', image: { id: 'meta-upload-1', caption: 'Please review this.' } });
});

test('never submits a WhatsApp message when the media upload fails', async () => {
  const calls = [];
  await assert.rejects(deliverWhatsAppMedia({ phoneNumberId: '948536645017374', recipient: 'whatsapp:15551234567', file, env, httpClient: {
    async post(url) { calls.push(url); throw Object.assign(new Error('provider down'), { response: { status: 503 } }); },
  }}), (error) => error instanceof WhatsAppDeliveryError && error.code === 'WHATSAPP_MEDIA_UPLOAD_FAILED');
  assert.equal(calls.length, 1);
});

test('rejects a phone-number mismatch before attempting provider upload', async () => {
  let calls = 0;
  await assert.rejects(deliverWhatsAppMedia({ phoneNumberId: 'other-number', recipient: 'whatsapp:15551234567', file, env, httpClient: { async post() { calls += 1; } } }), (error) => error instanceof WhatsAppDeliveryError && error.code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH');
  assert.equal(calls, 0);
});
