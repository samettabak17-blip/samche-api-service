import assert from 'node:assert/strict';
import test from 'node:test';
import { requestCustomerHumanSupport } from '../services/human-support-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

function database({ attention = 'NONE' } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT * FROM conversations')) return { rows: [{ id: conversationId, tenant_id: tenantId, status: 'open', human_attention_state: attention }] };
      if (sql.startsWith('UPDATE conversations')) return { rows: [{ id: conversationId, human_attention_state: 'REQUESTED', handling_mode: 'HUMAN' }] };
      return { rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, calls };
}

test('customer-requested support persists one unresolved attention state and suppresses AI through HUMAN mode', async () => {
  const fixture = database();
  const result = await requestCustomerHumanSupport({
    tenantId, conversationId, acknowledgement: 'legacy transfer', database: fixture.database,
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.conversation.handling_mode, 'HUMAN');
  assert.ok(fixture.calls.some(({ sql }) =>
    sql.includes("human_attention_state = 'REQUESTED'")
    && sql.includes('human_attention_requested_at = CURRENT_TIMESTAMP')
    && sql.includes('human_support_started_at = CURRENT_TIMESTAMP')
    && sql.includes('human_support_last_activity_at = CURRENT_TIMESTAMP')
  ));
  assert.ok(fixture.calls.some(({ sql }) => sql.includes("INSERT INTO conversation_messages")));

  const auditCall = fixture.calls.find(({ sql }) => sql.includes('INSERT INTO conversation_audit_events'));
  assert.equal(auditCall?.params?.[2], 'HANDOFF_REQUESTED');

  const attentionEvent = fixture.calls.find(({ sql }) => sql.includes('SELECT pg_notify'));
  assert.equal(attentionEvent?.params?.[0], 'samche_live_events');
  assert.equal(JSON.parse(attentionEvent?.params?.[1] ?? '{}').type, 'HUMAN_SUPPORT_REQUESTED');
});

test('repeated customer support request does not duplicate attention or lifecycle messages', async () => {
  const fixture = database({ attention: 'REQUESTED' });
  const result = await requestCustomerHumanSupport({
    tenantId, conversationId, acknowledgement: 'legacy transfer', database: fixture.database,
  });
  assert.equal(result.duplicate, true);
  assert.equal(fixture.calls.some(({ sql }) => sql.startsWith('UPDATE conversations')), false);
  assert.equal(fixture.calls.some(({ sql }) => sql.includes('INSERT INTO conversation_messages')), false);
});
