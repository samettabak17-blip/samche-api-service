import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { verifyWhatsAppSignature } from '../middleware/whatsappSignature.js';
import {
  DEFAULT_META_GRAPH_API_VERSION,
  metaGraphApiBase,
  resolveMetaGraphApiVersion,
} from '../services/meta-graph-api-version.js';
import {
  PLATFORM_WHATSAPP_TOKEN_ENV,
  WHATSAPP_CREDENTIAL_SOURCES,
  credentialFingerprint,
  describeWhatsAppCredentialResolution,
  integrationCredentialEnvName,
  resolveWhatsAppOutboundCredential,
} from '../services/whatsapp-credential-resolution-service.js';
import {
  WHATSAPP_INGRESS_EVENTS,
  appSecretFingerprint,
  logWhatsAppIngressEvent,
} from '../services/whatsapp-webhook-ingress-observability.js';
import { deliverWhatsAppText } from '../services/whatsapp-delivery-service.js';
import { resolveWhatsAppIntegration } from '../services/whatsapp-live-inbox-service.js';

// Real Meta assets used only as test fixtures. Runtime code contains no
// tenant-specific or phone-specific branch; these prove data-driven resolution.
const REAL_PHONE_NUMBER_ID = '1376040765584173';
const LEGACY_TEST_PHONE_NUMBER_ID = '948536645017374';

function makeResponse() {
  return {
    statusCode: null,
    sendStatus(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function recordingLogger() {
  const lines = [];
  return { lines, info: (line) => lines.push(line), warn: () => {}, error: () => {} };
}

// ---------------------------------------------------------------------------
// Graph API version: v20.0 expires 2026-09-24 and must not be hardcoded.
// ---------------------------------------------------------------------------

test('Graph API version is configurable and never defaults to an expiring version', () => {
  assert.notEqual(DEFAULT_META_GRAPH_API_VERSION, 'v20.0');
  assert.match(DEFAULT_META_GRAPH_API_VERSION, /^v\d+\.\d+$/);
  assert.equal(resolveMetaGraphApiVersion({}), DEFAULT_META_GRAPH_API_VERSION);
  assert.equal(resolveMetaGraphApiVersion({ WHATSAPP_GRAPH_API_VERSION: 'v24.0' }), 'v24.0');
  assert.equal(resolveMetaGraphApiVersion({ WHATSAPP_GRAPH_API_VERSION: '24.0' }), 'v24.0');
});

test('Graph API version fails safe to the platform default on malformed configuration', () => {
  for (const malformed of ['', '  ', 'latest', 'v', 'vX.Y', '../../evil']) {
    assert.equal(
      resolveMetaGraphApiVersion({ WHATSAPP_GRAPH_API_VERSION: malformed }),
      DEFAULT_META_GRAPH_API_VERSION
    );
  }
  assert.equal(metaGraphApiBase({}), `https://graph.facebook.com/${DEFAULT_META_GRAPH_API_VERSION}`);
});

test('outbound text delivery targets the configured Graph API version and the resolved phone number ID', async () => {
  const requests = [];
  await deliverWhatsAppText({
    phoneNumberId: REAL_PHONE_NUMBER_ID,
    recipient: '905551112233',
    content: 'hello',
    env: { WHATSAPP_TOKEN: 'fixture-token', WHATSAPP_GRAPH_API_VERSION: 'v23.0' },
    httpClient: {
      async post(url, body) {
        requests.push({ url, body });
        return { data: { messages: [{ id: 'wamid.FIXTURE' }] } };
      },
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://graph.facebook.com/v23.0/${REAL_PHONE_NUMBER_ID}/messages`);
  assert.ok(!requests[0].url.includes('v20.0'));
  assert.equal(requests[0].body.to, '905551112233');
});

// ---------------------------------------------------------------------------
// Ingress observability: distinguishes rejection causes, leaks nothing.
// ---------------------------------------------------------------------------

test('valid Meta signature is accepted and emits REQUEST_RECEIVED then SIGNATURE_VALID', () => {
  const secret = 'fixture-app-secret';
  const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const res = makeResponse();
  const logger = recordingLogger();
  let nextCalled = false;

  verifyWhatsAppSignature(
    { rawBody, get: (name) => (name === 'x-hub-signature-256' ? signature : undefined) },
    res,
    () => { nextCalled = true; },
    secret,
    logger
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.ok(logger.lines.some((l) => l.includes(WHATSAPP_INGRESS_EVENTS.REQUEST_RECEIVED)));
  assert.ok(logger.lines.some((l) => l.includes(WHATSAPP_INGRESS_EVENTS.SIGNATURE_VALID)));
});

test('invalid signature is rejected 401 and is distinguishable from a missing signature', () => {
  const invalid = recordingLogger();
  const invalidRes = makeResponse();
  verifyWhatsAppSignature(
    { rawBody: Buffer.from('{"entry":[]}'), get: () => 'sha256=deadbeef' },
    invalidRes, () => { throw new Error('must not pass'); }, 'fixture-app-secret', invalid
  );
  assert.equal(invalidRes.statusCode, 401);
  assert.ok(invalid.lines.some((l) => l.includes(WHATSAPP_INGRESS_EVENTS.SIGNATURE_INVALID)));

  const missing = recordingLogger();
  const missingRes = makeResponse();
  verifyWhatsAppSignature(
    { rawBody: Buffer.from('{"entry":[]}'), get: () => undefined },
    missingRes, () => { throw new Error('must not pass'); }, 'fixture-app-secret', missing
  );
  assert.equal(missingRes.statusCode, 401);
  assert.ok(missing.lines.some((l) => l.includes(WHATSAPP_INGRESS_EVENTS.SIGNATURE_MISSING)));
  assert.ok(!missing.lines.some((l) => l.includes(WHATSAPP_INGRESS_EVENTS.SIGNATURE_INVALID)));
});

test('an unconfigured app secret still fails closed with 500', () => {
  const res = makeResponse();
  verifyWhatsAppSignature(
    { rawBody: Buffer.from('{}'), get: () => 'sha256=abc' },
    res, () => { throw new Error('must not pass'); }, '', recordingLogger()
  );
  assert.equal(res.statusCode, 500);
});

test('ingress observability never emits body content, phone numbers, signatures, or secrets', () => {
  const secret = 'super-secret-app-secret-value';
  const messageText = 'Hello, I would like to try the SamChe AI demo.';
  const rawBody = Buffer.from(JSON.stringify({ text: { body: messageText }, from: '905551112233' }));
  const logger = recordingLogger();

  verifyWhatsAppSignature(
    { rawBody, get: () => 'sha256=0123456789abcdef' },
    makeResponse(), () => {}, secret, logger
  );

  const output = logger.lines.join('\n');
  assert.ok(!output.includes(messageText));
  assert.ok(!output.includes('905551112233'));
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes('0123456789abcdef'));
  assert.ok(output.includes('body_bytes=' + rawBody.length));
});

test('app secret fingerprint is stable, non-reversible, and separates two Meta Apps', () => {
  const current = appSecretFingerprint('current-published-app-secret');
  assert.equal(current, appSecretFingerprint('current-published-app-secret'));
  assert.notEqual(current, appSecretFingerprint('legacy-test-app-secret'));
  assert.equal(current.length, 12);
  assert.ok(!current.includes('current-published-app-secret'));
  assert.equal(appSecretFingerprint(''), 'unconfigured');
});

test('logWhatsAppIngressEvent emits one bounded line per observation', () => {
  const logger = recordingLogger();
  logWhatsAppIngressEvent({ event: WHATSAPP_INGRESS_EVENTS.HANDLER_REACHED, logger });
  assert.equal(logger.lines.length, 1);
  assert.ok(logger.lines[0].startsWith('WHATSAPP_WEBHOOK_INGRESS event=HANDLER_REACHED'));
});
