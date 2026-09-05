import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHumanSupportRecipients } from '../services/human-support-recipient-service.js';

function database({ assigned = 'owner-a', users = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM conversations')) return { rowCount: 1, rows: [{ assigned_agent_user_id: assigned }] };
      return { rowCount: users.length, rows: users };
    },
  };
}

test('assigned owner delivery resolves the active same-tenant owner with send-message authorization', async () => {
  const db = database({ users: [{ id: 'owner-a', system_role: 'USER', tenant_role: 'AGENT' }] });
  const recipients = await resolveHumanSupportRecipients({ database: db, tenantId: 'tenant-a', conversationId: 'conversation-a', rule: 'ASSIGNED_OWNER' });
  assert.deepEqual(recipients.map(({ id }) => id), ['owner-a']);
  assert.deepEqual(db.calls[1].params.slice(0, 3), ['tenant-a', 'ASSIGNED_OWNER', 'owner-a']);
});

test('cross-tenant, inactive, and unauthorized recipient candidates never reach notification delivery', async () => {
  const db = database({ users: [
    { id: 'user-a', system_role: 'USER', tenant_role: 'AGENT' },
    { id: 'user-a', system_role: 'USER', tenant_role: 'AGENT' },
  ] });
  const recipients = await resolveHumanSupportRecipients({ database: db, tenantId: 'tenant-a', conversationId: 'conversation-a', rule: 'USER', target: { userId: 'user-a' } });
  assert.deepEqual(recipients, []);
  assert.match(db.calls[1].sql, /tu\.tenant_id = \$1/);
  assert.match(db.calls[1].sql, /u\.status = 'active'/);
});

test('TEAM remains fail-closed without a canonical team schema', async () => {
  const db = database({ users: [{ id: 'owner-a', system_role: 'OWNER', tenant_role: 'ADMIN' }] });
  const recipients = await resolveHumanSupportRecipients({ database: db, tenantId: 'tenant-a', conversationId: 'conversation-a', rule: 'TEAM' });
  assert.deepEqual(recipients, []);
});
