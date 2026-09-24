import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyWhatsAppSignature } from '../middleware/whatsappSignature.js';

const makeResponse = () => ({
  statusCode: null,
  sendStatus(statusCode) {
    this.statusCode = statusCode;
    return this;
  }
});

test('accepts a valid WhatsApp HMAC-SHA256 signature', () => {
  const secret = 'fixture-secret';
  const rawBody = Buffer.from('{"entry":[]}');
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const req = {
    rawBody,
    get: (name) => name === 'x-hub-signature-256' ? signature : undefined
  };
  const res = makeResponse();
  let nextCalled = false;

  verifyWhatsAppSignature(req, res, () => { nextCalled = true; }, secret);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('rejects an invalid WhatsApp HMAC-SHA256 signature', () => {
  const req = {
    rawBody: Buffer.from('{"entry":[]}'),
    get: () => 'sha256=bad'
  };
  const res = makeResponse();
  let nextCalled = false;

  verifyWhatsAppSignature(req, res, () => { nextCalled = true; }, 'fixture-secret');

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('accepts Instagram webhook signed with INSTAGRAM_APP_SECRET via environment fallback', () => {
  const originalWpSecret = process.env.WHATSAPP_APP_SECRET;
  const originalIgSecret = process.env.INSTAGRAM_APP_SECRET;
  try {
    process.env.WHATSAPP_APP_SECRET = 'wp-secret-123';
    process.env.INSTAGRAM_APP_SECRET = 'ig-secret-456';

    const rawBody = Buffer.from('{"object":"instagram","entry":[]}');
    const signature = `sha256=${createHmac('sha256', 'ig-secret-456').update(rawBody).digest('hex')}`;
    const req = {
      rawBody,
      get: (name) => name === 'x-hub-signature-256' ? signature : undefined
    };
    const res = makeResponse();
    let nextCalled = false;

    verifyWhatsAppSignature(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  } finally {
    process.env.WHATSAPP_APP_SECRET = originalWpSecret;
    process.env.INSTAGRAM_APP_SECRET = originalIgSecret;
  }
});
