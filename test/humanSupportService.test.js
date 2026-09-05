import assert from 'node:assert/strict';
import test from 'node:test';
import { claimDueCustomerSupportLifecycle, claimDueHumanSupportEscalations, listHumanAttentionSummary, requestCustomerHumanSupport } from '../services/human-support-service.js';

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

  const lifecycleEvent = fixture.calls.find(({ sql, params }) =>
    sql.includes('INSERT INTO conversation_audit_events') && params?.[2] === 'HUMAN_SUPPORT_REQUESTED'
  );
  assert.ok(lifecycleEvent, 'the durable canonical escalation event is recorded in the same transaction');
  assert.ok(fixture.calls.some(({ sql }) => sql.includes('INSERT INTO human_support_escalations')),
    'the request creates a durable tenant-scoped escalation instance');
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

function lifecycleDatabase({ attention = 'REQUESTED', lastActivityAt, warningSentAt = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT c.*, tc.external_channel_id')) {
        return {
          rows: [{
            id: conversationId,
            tenant_id: tenantId,
            customer_external_id: 'whatsapp:15551234567',
            human_attention_state: attention,
            human_attention_requested_at: lastActivityAt,
            human_support_started_at: lastActivityAt,
            human_support_last_activity_at: lastActivityAt,
            human_support_warning_sent_at: warningSentAt,
            human_support_closed_at: null,
            communication_language: 'tr',
            whatsapp_response_templates: {
              human_support: {
                warning_5m: { tr: 'legacy five minute warning' },
                timeout_close: { tr: 'legacy timeout close' },
              },
            },
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, calls };
}

test('unacknowledged customer support requests receive the persisted five-minute warning', async () => {
  const now = new Date('2026-08-25T12:00:00.000Z');
  const fixture = lifecycleDatabase({ lastActivityAt: new Date(now.getTime() - (5 * 60 * 1000 + 1)) });
  const actions = await claimDueCustomerSupportLifecycle({ database: fixture.database, now });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'WARNING_5M');
  const dueQuery = fixture.calls.find(({ sql }) => sql.startsWith('SELECT c.*, tc.external_channel_id'));
  assert.match(dueQuery?.sql ?? '', /c\.human_attention_state IN \('REQUESTED', 'ACKNOWLEDGED'\)/);
  assert.ok(fixture.calls.some(({ sql }) => sql.includes('human_support_warning_sent_at')));
});

test('unacknowledged customer support requests close at ten minutes and return handling to AI', async () => {
  const now = new Date('2026-08-25T12:00:00.000Z');
  const fixture = lifecycleDatabase({ lastActivityAt: new Date(now.getTime() - (10 * 60 * 1000 + 1)) });
  const actions = await claimDueCustomerSupportLifecycle({ database: fixture.database, now });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'TIMEOUT_CLOSE');
  assert.ok(fixture.calls.some(({ sql }) => sql.includes("SET handling_mode = 'AI'")));
  assert.ok(fixture.calls.some(({ sql }) => sql.includes("human_attention_state = 'RESOLVED'")));
});


test('human attention summary counts only the tenant requested state without emitting customer data', async () => {
  const calls = [];
  const summary = await listHumanAttentionSummary({
    tenantId,
    database: {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ unresolved_count: 2 }] };
      },
    },
  });
  assert.deepEqual(summary, { unresolvedCount: 2 });
  assert.match(calls[0].sql, /human_attention_state = 'REQUESTED'/);
  assert.deepEqual(calls[0].params, [tenantId]);
});


test('app-shaped scheduler call accepts its production dependency object and scans requested support', async () => {
  const now = new Date('2026-08-25T12:00:00.000Z');
  const fixture = lifecycleDatabase({ attention: 'REQUESTED', lastActivityAt: new Date(now.getTime() - (5 * 60 * 1000 + 1)) });
  const actions = await claimDueCustomerSupportLifecycle({ database: fixture.database, now });
  assert.equal(actions[0]?.type, 'WARNING_5M');
});

test('due escalation levels are claimed once from tenant-scoped persisted policy data', async () => {
  const calls = [];
  const database = { async connect() { return { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM human_support_escalations')) return { rows: [{ escalation_id: 'esc-a', tenant_id: tenantId, conversation_id: conversationId, current_level: 0, level_order: 1, recipient_rule: 'ASSIGNED_AGENT', acknowledgement_timeout_seconds: 300 }] };
    if (sql.includes('INSERT INTO human_support_notification_outbox')) return { rowCount: 1, rows: [] };
    return { rows: [] };
  }, release() {} }; } };
  const claimed = await claimDueHumanSupportEscalations({ database, now: new Date('2026-09-05T12:00:00Z') });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].tenantId, tenantId);
  assert.ok(calls.some(({ sql }) => sql.includes('FOR UPDATE OF e SKIP LOCKED')));
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO human_support_notification_outbox')));
});

test('support request binds only its tenant active escalation policy', async () => {
  const fixture = database();
  await requestCustomerHumanSupport({ tenantId, conversationId, acknowledgement: 'transfer', database: fixture.database });
  const escalation = fixture.calls.find(({ sql }) => sql.includes('INSERT INTO human_support_escalations'));
  assert.match(escalation?.sql ?? '', /SELECT id FROM human_support_escalation_policies/);
  assert.deepEqual(escalation?.params?.slice(0, 2), [tenantId, conversationId]);
});
