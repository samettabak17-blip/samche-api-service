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
  assert.equal(result.providerMessageId, 'wamid.agent-media-1');
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


test('does not report media sent when Graph accepts the request without a WhatsApp message identifier', async () => {
  await assert.rejects(deliverWhatsAppMedia({ phoneNumberId: '948536645017374', recipient: 'whatsapp:15551234567', file, env, httpClient: {
    async post(url) { return url.endsWith('/media') ? { data: { id: 'meta-upload-1' } } : { data: { messages: [] } }; },
  }}), (error) => error instanceof WhatsAppDeliveryError && error.code === 'WHATSAPP_MEDIA_SEND_UNCORRELATED');
});


test('retains a safe provider-boundary diagnostic when Meta rejects an audio message request', async () => {
  const audio = { buffer: Buffer.from('OggSvoice-note'), size: 13, mimetype: 'audio/ogg', originalname: 'voice-note.ogg' };
  await assert.rejects(deliverWhatsAppMedia({
    phoneNumberId: '948536645017374',
    recipient: 'whatsapp:15551234567',
    file: audio,
    mediaCategory: 'AUDIO',
    env,
    httpClient: {
      async post(url) {
        if (url.endsWith('/media')) return { data: { id: 'meta-upload-1' } };
        throw Object.assign(new Error('Graph rejected audio'), { response: { status: 400, data: { error: { code: 131052 } } } });
      },
    },
  }), (error) => {
    assert.ok(error instanceof WhatsAppDeliveryError);
    assert.equal(error.code, 'WHATSAPP_MEDIA_SEND_FAILED');
    assert.equal(error.providerStage, 'WHATSAPP_SEND');
    assert.equal(error.providerStatus, 400);
    assert.equal(error.providerCode, '131052');
    return true;
  });
});


test('uploads verified Ogg/Opus voice bytes to Meta with an audio/ogg file contract', async () => {
  const calls = [];
  const audio = { buffer: Buffer.from('OggS....OpusHead....voice'), size: 23, mimetype: 'audio/ogg', originalname: 'voice-note.ogg' };
  const result = await deliverWhatsAppMedia({
    phoneNumberId: '948536645017374', recipient: 'whatsapp:15551234567', file: audio, mediaCategory: 'AUDIO', env,
    httpClient: { async post(url, body, config) { calls.push({ url, body, config }); return url.endsWith('/media') ? { data: { id: 'meta-audio-1' } } : { data: { messages: [{ id: 'wamid.voice-1' }] } }; } },
  });
  const uploadHeaders = calls[0].body.getHeaders();
  assert.match(uploadHeaders['content-type'], /^multipart\/form-data; boundary=/);
  assert.equal(calls[0].config.headers['content-type'], uploadHeaders['content-type']);
  assert.ok(calls[0].body._streams.some((entry) => Buffer.isBuffer(entry) && entry.equals(audio.buffer)));
  assert.ok(calls[0].body._streams.some((entry) => typeof entry === 'string' && entry.includes('Content-Type: audio/ogg')));
  assert.deepEqual(calls[1].body, { messaging_product: 'whatsapp', to: '15551234567', type: 'audio', audio: { id: 'meta-audio-1' } });
  assert.equal(result.providerMessageId, 'wamid.voice-1');
});
