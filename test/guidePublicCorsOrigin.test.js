import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedGuideCorsOrigin } from '../services/guide-public-cors-service.js';

test('allows a same-origin active custom Guide request without pre-registering its hostname in CORS configuration', () => {
  assert.equal(isAllowedGuideCorsOrigin({
    origin: 'https://rehber.samchecompany.ae',
    requestHost: 'rehber.samchecompany.ae',
    forwardedProtocol: 'https',
    allowedOrigins: ['https://app.staging.samchecompany.com'],
  }), true);
});

test('does not allow a different origin merely because a custom Guide host is being served', () => {
  assert.equal(isAllowedGuideCorsOrigin({
    origin: 'https://attacker.example',
    requestHost: 'rehber.samchecompany.ae',
    forwardedProtocol: 'https',
    allowedOrigins: [],
  }), false);
});

test('continues allowing configured dashboard origins and requests without an Origin header', () => {
  assert.equal(isAllowedGuideCorsOrigin({
    origin: 'https://app.staging.samchecompany.com',
    requestHost: 'rehber.samchecompany.ae',
    forwardedProtocol: 'https',
    allowedOrigins: ['https://app.staging.samchecompany.com'],
  }), true);
  assert.equal(isAllowedGuideCorsOrigin({
    origin: undefined,
    requestHost: 'rehber.samchecompany.ae',
    forwardedProtocol: 'https',
    allowedOrigins: [],
  }), true);
});
