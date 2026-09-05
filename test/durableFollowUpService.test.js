import assert from 'node:assert/strict';
import test from 'node:test';
import { claimDueContextualFollowUps, processDueContextualFollowUps, scheduleContextualFollowUp } from '../services/durable-follow-up-service.js';

test('scheduling a contextual follow-up records one tenant-scoped durable idempotency identity', async () => {
  const calls = [];
  const database = { async query(sql, params) { calls.push({ sql, params }); return { rowCount: 1, rows: [{ id: 'job-a' }] }; } };
  const result = await scheduleContextualFollowUp({
    database, tenantId: 'tenant-a', conversationId: 'conversation-a', assistantId: 'assistant-a', channelId: 'channel-a',
    stage: '3h', dueAt: new Date('2026-09-05T03:00:00Z'), idempotencyKey: 'follow-up:conversation-a:3h',
  });
  assert.equal(result.scheduled, true);
  assert.equal(calls[0].params[0], 'tenant-a');
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/);
});

test('due job claim excludes HUMAN_REQUESTED and HUMAN_ACTIVE conversations before AI generation', async () => {
  const calls = [];
  const database = { async query(sql, params = []) { calls.push({ sql, params }); return { rowCount: 1, rows: [] }; }, async connect() { return { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [] };
    return { rowCount: 0, rows: [] };
  }, release() {} }; } };
  const jobs = await claimDueContextualFollowUps({ database, now: new Date('2026-09-05T03:00:00Z') });
  assert.deepEqual(jobs, []);
  assert.match(calls.find(({ sql }) => sql.includes('FROM conversation_scheduled_jobs'))?.sql ?? '', /c\.handling_mode = 'AI'/);
  assert.match(calls.find(({ sql }) => sql.includes('FROM conversation_scheduled_jobs'))?.sql ?? '', /human_attention_state NOT IN \('REQUESTED', 'ACKNOWLEDGED'\)/);
});

test('a claimed follow-up generates once, persists the canonical message, delivers it, and completes its durable job', async () => {
  const calls = [];
  const job = { id: 'job-a', tenant_id: 'tenant-a', conversation_id: 'conversation-a', assistant_id: 'assistant-a', channel_id: 'channel-a', stage: '3h' };
  const database = { async query(sql, params = []) { calls.push({ sql, params }); return { rowCount: 1, rows: [] }; }, async connect() { return { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
    return { rowCount: 1, rows: [] };
  }, release() {} }; } };
  const events = [];
  const result = await processDueContextualFollowUps({
    database,
    resolveContext: async (claimed) => ({ ...claimed, language: 'en', prompt: 'grounded tenant context' }),
    generate: async ({ prompt }) => { events.push(`generate:${prompt}`); return 'A grounded follow-up.'; },
    persistCanonical: async ({ content, idempotencyKey }) => ({ id: 'message-a', content, idempotencyKey }),
    deliver: async ({ content, idempotencyKey }) => { events.push(`deliver:${content}:${idempotencyKey}`); return { delivered: true }; },
  });

  assert.deepEqual(result, { completed: 1, retried: 0, cancelled: 0 });
  assert.deepEqual(events, ['generate:grounded tenant context', 'deliver:A grounded follow-up.:contextual-follow-up:job-a']);
  assert.ok(calls.some(({ sql }) => sql.includes("status = 'DELIVERED'") && sql.includes('delivered_at')));
});

test('an ineligible or failed claimed follow-up is cancelled or retried without generating a second message', async () => {
  for (const [context, expected] of [[null, 'CANCELLED'], [{ prompt: 'grounded' }, 'RETRY']]) {
    const calls = [];
    const database = { async query(sql) { calls.push(sql); return { rowCount: 1, rows: [] }; }, async connect() { return { async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [{ id: `job-${expected}`, tenant_id: 'tenant-a' }] };
      return { rowCount: 1, rows: [] };
    }, release() {} }; } };
    let generated = false;
    const result = await processDueContextualFollowUps({
      database,
      resolveContext: async () => context,
      generate: async () => { generated = true; throw new Error('provider unavailable'); },
      persistCanonical: async () => ({ id: 'message-a' }),
      deliver: async () => ({ delivered: true }),
    });
    assert.equal(generated, expected === 'RETRY');
    assert.ok(calls.some((sql) => sql.includes(`status = '${expected}'`)));
    assert.equal(result[expected === 'CANCELLED' ? 'cancelled' : 'retried'], 1);
  }
});

test('a delivery retry reuses the persisted canonical follow-up without invoking the provider again', async () => {
  const job = { id: 'job-a', tenant_id: 'tenant-a', generated_message_id: 'message-a', generated_content: 'Already generated.' };
  const database = {
    async query() { return { rowCount: 1, rows: [] }; },
    async connect() { return { async query(sql) {
      if (sql.includes('FROM conversation_scheduled_jobs')) return { rows: [job] };
      return { rowCount: 1, rows: [] };
    }, release() {} }; },
  };
  let generated = false;
  let deliveredContent = null;
  const result = await processDueContextualFollowUps({
    database,
    resolveContext: async () => ({ prompt: 'not used' }),
    generate: async () => { generated = true; return 'incorrect second response'; },
    persistCanonical: async () => { throw new Error('must not persist again'); },
    deliver: async ({ content }) => { deliveredContent = content; return { delivered: true }; },
  });
  assert.equal(generated, false);
  assert.equal(deliveredContent, 'Already generated.');
  assert.equal(result.completed, 1);
});
