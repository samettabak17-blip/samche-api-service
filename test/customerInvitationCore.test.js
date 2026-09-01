import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createInvitationToken,
  decryptInvitationEnvelope,
  encryptInvitationEnvelope,
  hashInvitationToken,
  validateInvitationEnvelopeKey,
} from '../services/customer-invitation-crypto.js';

test('invitation tokens have at least 32 random bytes and persist only a SHA-256 hash', () => {
  const token = createInvitationToken();
  assert.match(token, /^[A-Za-z0-9_-]{43,}$/);
  const hash = hashInvitationToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
});

test('encrypted transient delivery envelope does not persist plaintext and decrypts only with its key', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const token = createInvitationToken();
  const envelope = encryptInvitationEnvelope(token, key);
  assert.equal(JSON.stringify(envelope).includes(token), false);
  assert.equal(decryptInvitationEnvelope(envelope, key), token);
  assert.throws(() => decryptInvitationEnvelope(envelope, Buffer.alloc(32, 8).toString('base64')));
});

test('envelope key preflight rejects missing, malformed, and unsafe key material', () => {
  assert.throws(() => validateInvitationEnvelopeKey(undefined));
  assert.throws(() => validateInvitationEnvelopeKey('short'));
  assert.equal(validateInvitationEnvelopeKey(Buffer.alloc(32, 3).toString('base64')).length, 32);
});

test('customer invitation migration is tenant scoped and has exactly one pending invitation per user and tenant', async () => {
  const sql = await readFile(new URL('../migrations/036_customer_invitations.sql', import.meta.url), 'utf8');
  assert.match(sql, /customer_invitations/i);
  assert.match(sql, /token_hash/i);
  assert.match(sql, /PENDING[\s\S]*CONSUMED[\s\S]*REVOKED[\s\S]*EXPIRED/i);
  assert.match(sql, /user_id, tenant_id[\s\S]*WHERE status = 'PENDING'/i);
  assert.doesNotMatch(sql, /token\s+VARCHAR/i);
});

test('outbox migration stores an encrypted envelope and supports durable delivery states', async () => {
  const sql = await readFile(new URL('../migrations/037_customer_invitation_outbox.sql', import.meta.url), 'utf8');
  assert.match(sql, /encrypted_envelope_ciphertext/i);
  assert.match(sql, /envelope_iv/i);
  assert.match(sql, /envelope_auth_tag/i);
  assert.match(sql, /PENDING_DELIVERY[\s\S]*SENT[\s\S]*DELIVERY_FAILED/i);
});

test('onboarding and fixture migrations are additive and protect replay plus fixture discovery', async () => {
  const onboarding = await readFile(new URL('../migrations/038_owner_onboarding_idempotency.sql', import.meta.url), 'utf8');
  const fixtures = await readFile(new URL('../migrations/039_user_fixture_metadata.sql', import.meta.url), 'utf8');
  assert.match(onboarding, /owner_onboarding_idempotency/i);
  assert.match(onboarding, /owner_user_id/i);
  assert.match(onboarding, /idempotency_key/i);
  assert.match(fixtures, /is_test_fixture/i);
});
