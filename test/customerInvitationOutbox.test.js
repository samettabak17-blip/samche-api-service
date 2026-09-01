import assert from 'node:assert/strict';
import test from 'node:test';
import { processInvitationOutboxRow } from '../services/customer-invitation-outbox-service.js';
import { createCustomerInvitationOutboxWorker } from '../services/customer-invitation-outbox-service.js';
import { createInvitationToken, encryptInvitationEnvelope } from '../services/customer-invitation-crypto.js';

function fakeClient() {
  const calls = [];
  return { calls, async query(sql, params = []) { calls.push({ sql: String(sql), params }); return { rowCount: 1, rows: [] }; } };
}

test('successful outbox delivery decrypts once, sends, and clears the transient encrypted envelope', async () => {
  const key = Buffer.alloc(32, 5).toString('base64');
  const token = createInvitationToken();
  const envelope = encryptInvitationEnvelope(token, key);
  const client = fakeClient();
  const sent = [];
  const result = await processInvitationOutboxRow({
    client,
    row: { id: 'outbox-1', invitation_id: 'invite-1', status: 'PENDING_DELIVERY', encrypted_envelope_ciphertext: envelope.ciphertext, envelope_iv: envelope.iv, envelope_auth_tag: envelope.authTag, envelope_key_version: envelope.keyVersion, expires_at: new Date(Date.now() + 60_000), invitation_status: 'PENDING', company_name: 'Example', email: 'customer@example.test' },
    envelopeKey: key,
    mailer: { sendInvitation: async (message) => sent.push(message) },
  });
  assert.equal(result.status, 'SENT');
  assert.equal(sent.length, 1);
  assert.equal(client.calls.some(({ sql }) => /encrypted_envelope_ciphertext = NULL/.test(sql)), true);
  assert.equal(client.calls.some(({ sql }) => /provider_code = \$2/.test(sql)), true);
  assert.equal(JSON.stringify(client.calls).includes(token), false);
});

test('expired invitations are not sent and their envelope is destroyed', async () => {
  const client = fakeClient();
  const result = await processInvitationOutboxRow({ client, row: { id: 'outbox-1', status: 'PENDING_DELIVERY', expires_at: new Date(Date.now() - 1), invitation_status: 'PENDING' }, envelopeKey: Buffer.alloc(32, 5).toString('base64'), mailer: { sendInvitation: async () => assert.fail('must not send') } });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(client.calls.some(({ sql }) => /CANCELLED/.test(sql)), true);
});

test('retryable SMTP failure preserves the encrypted envelope for a bounded retry', async () => {
  const key = Buffer.alloc(32, 5).toString('base64');
  const envelope = encryptInvitationEnvelope(createInvitationToken(), key);
  const client = fakeClient();
  const result = await processInvitationOutboxRow({
    client,
    row: { id: 'outbox-2', status: 'PENDING_DELIVERY', encrypted_envelope_ciphertext: envelope.ciphertext, envelope_iv: envelope.iv, envelope_auth_tag: envelope.authTag, envelope_key_version: envelope.keyVersion, expires_at: new Date(Date.now() + 60_000), invitation_status: 'PENDING', company_name: 'Example', email: 'customer@example.test' },
    envelopeKey: key,
    mailer: { sendInvitation: async () => { throw new Error('timeout'); } },
  });
  assert.equal(result.status, 'DELIVERY_FAILED');
  assert.equal(client.calls.some(({ sql }) => /attempt_count = attempt_count \+ 1/.test(sql)), true);
  assert.equal(client.calls.some(({ sql, params }) => /provider_code = \$2/.test(sql) && params.includes('SMTP_DELIVERY_FAILED')), true);
  assert.equal(client.calls.some(({ sql }) => /encrypted_envelope_ciphertext = NULL/.test(sql)), false);
});

test('SMTP MAIL FROM rejection is persisted only as a safe sender classification', async () => {
  const key = Buffer.alloc(32, 5).toString('base64');
  const envelope = encryptInvitationEnvelope(createInvitationToken(), key);
  const client = fakeClient();
  const result = await processInvitationOutboxRow({
    client,
    row: { id: 'outbox-3', status: 'PENDING_DELIVERY', encrypted_envelope_ciphertext: envelope.ciphertext, envelope_iv: envelope.iv, envelope_auth_tag: envelope.authTag, envelope_key_version: envelope.keyVersion, expires_at: new Date(Date.now() + 60_000), invitation_status: 'PENDING', company_name: 'Example', email: 'customer@example.test' },
    envelopeKey: key,
    mailer: { sendInvitation: async () => { const error = new Error('rejected'); error.code = 'EENVELOPE'; error.command = 'MAIL FROM'; throw error; } },
  });
  assert.equal(result.status, 'DELIVERY_FAILED');
  assert.equal(client.calls.some(({ params }) => params.includes('SMTP_FROM_REJECTED')), true);
});

test('outbox worker reports that its initial durable queue poll is running', async () => {
  const statuses = [];
  const worker = createCustomerInvitationOutboxWorker({
    database: {
      connect: async () => ({
        query: async (sql) => /SELECT o\.\*/.test(String(sql)) ? { rowCount: 0, rows: [] } : { rowCount: 0, rows: [] },
        release: () => undefined,
      }),
    },
    envelopeKey: Buffer.alloc(32, 5).toString('base64'),
    mailer: { sendInvitation: async () => assert.fail('must not send') },
    intervalMs: 60_000,
    onStatus: (status) => statuses.push(status),
  });
  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();
  assert.equal(statuses.some((status) => status.state === 'RUNNING'), true);
});

test('outbox worker reports a safe failure when it cannot connect to the durable queue', async () => {
  const statuses = [];
  const worker = createCustomerInvitationOutboxWorker({
    database: { connect: async () => { throw new Error('database unavailable'); } },
    envelopeKey: Buffer.alloc(32, 5).toString('base64'),
    mailer: { sendInvitation: async () => assert.fail('must not send') },
    intervalMs: 60_000,
    onStatus: (status) => statuses.push(status),
  });
  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();
  assert.equal(statuses.some((status) => status.state === 'ERROR' && status.code === 'OUTBOX_WORKER_FAILURE'), true);
});

test('a started outbox worker claims an eligible pending delivery row and progresses it to a real send attempt', async () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const envelope = encryptInvitationEnvelope(createInvitationToken(), key);
  const calls = [];
  const row = {
    id: 'outbox-ready', status: 'PENDING_DELIVERY', authority_status: 'PENDING', expires_at: new Date(Date.now() + 60_000),
    encrypted_envelope_ciphertext: envelope.ciphertext, envelope_iv: envelope.iv, envelope_auth_tag: envelope.authTag,
    envelope_key_version: envelope.keyVersion, company_name: 'Example', email: 'customer@example.test', template_version: 'INVITATION_V1',
  };
  const worker = createCustomerInvitationOutboxWorker({
    database: {
      connect: async () => ({
        query: async (sql) => {
          calls.push(String(sql));
          return /SELECT o\.\*/.test(String(sql)) ? { rowCount: 1, rows: [row] } : { rowCount: 1, rows: [] };
        },
        release: () => undefined,
      }),
    },
    envelopeKey: key,
    mailer: { sendInvitation: async () => ({ providerCode: 'SMTP_ACCEPTED' }) },
    intervalMs: 60_000,
  });

  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();
  assert.equal(calls.some((sql) => /FOR UPDATE SKIP LOCKED/.test(sql)), true);
  assert.equal(calls.some((sql) => /SET status = 'SENT'/.test(sql)), true);
});
