import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvitationLifecycle, validateInvitationTokenInput } from '../services/customer-invitation-service.js';

function fakeClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/SELECT id FROM customer_invitations/.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO customer_invitations/.test(sql)) return { rowCount: 1, rows: [{ id: 'invite-1', user_id: params[0], tenant_id: params[1], status: 'PENDING', expires_at: params[4] }] };
      if (/INSERT INTO customer_invitation_outbox/.test(sql)) return { rowCount: 1, rows: [{ id: 'outbox-1', status: 'PENDING_DELIVERY' }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('new invitation creates hash-only authority and encrypted transient delivery envelope', async () => {
  const client = fakeClient();
  const lifecycle = await createInvitationLifecycle({
    client,
    userId: 'user-1',
    tenantId: 'tenant-1',
    tenantRole: 'ADMIN',
    envelopeKey: Buffer.alloc(32, 9).toString('base64'),
    now: new Date('2026-09-01T00:00:00.000Z'),
  });

  assert.equal(lifecycle.invitation.status, 'PENDING');
  assert.match(lifecycle.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(client.calls).includes(lifecycle.token), false);
  assert.equal(client.calls.some(({ sql }) => /INSERT INTO customer_invitations/.test(sql)), true);
  assert.equal(client.calls.some(({ sql }) => /INSERT INTO customer_invitation_outbox/.test(sql)), true);
});

test('public token input has bounded URL-safe format', () => {
  assert.equal(validateInvitationTokenInput('a'.repeat(43)), true);
  assert.equal(validateInvitationTokenInput('a'.repeat(513)), false);
  assert.equal(validateInvitationTokenInput('not valid'), false);
});
