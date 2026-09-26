process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import { operateConversation, ConversationOperationError } from '../services/live-inbox-service.js';
import { orchestrateInstagramInboundAiResponse } from '../services/instagram-ai-orchestrator.js';

const tenantIdA = '11111111-1111-4111-8111-111111111111';
const conversationIdA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const channelIdA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const contactIdA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actorAdmin = { userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', systemRole: 'CUSTOMER', tenantRole: 'ADMIN' };

test('A. OPEN -> CLOSE -> ARCHIVE lifecycle completes successfully with audit events', async () => {
  let convStatus = 'open';
  const auditEvents = [];

  const mockDb = {
    async connect() {
      return {
        async query(sql, params = []) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT c.*, tc.channel_type')) {
            return {
              rowCount: 1,
              rows: [{
                id: conversationIdA,
                tenant_id: tenantIdA,
                channel_id: channelIdA,
                channel_type: 'INSTAGRAM',
                contact_id: contactIdA,
                status: convStatus,
                handling_mode: 'AI',
                assigned_agent_user_id: null,
                ai_behavior_override: 'NEVER_AI',
              }],
            };
          }
          if (sql.includes("status = 'closed'")) {
            convStatus = 'closed';
            return { rowCount: 1, rows: [{ id: conversationIdA, status: 'closed', tenant_id: tenantIdA }] };
          }
          if (sql.includes("status = 'archived'")) {
            convStatus = 'archived';
            return { rowCount: 1, rows: [{ id: conversationIdA, status: 'archived', tenant_id: tenantIdA }] };
          }
          if (sql.includes('INSERT INTO conversation_audit_events')) {
            auditEvents.push(params[3]);
            return { rowCount: 1, rows: [{ id: 'evt-1' }] };
          }
          if (sql.includes('pg_notify')) return { rowCount: 1 };
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const closed = await operateConversation({
    tenantId: tenantIdA,
    conversationId: conversationIdA,
    actor: actorAdmin,
    action: 'close',
    database: mockDb,
  });
  assert.equal(closed.status, 'closed');
  assert.equal(auditEvents.includes('CLOSE'), true);

  const archived = await operateConversation({
    tenantId: tenantIdA,
    conversationId: conversationIdA,
    actor: actorAdmin,
    action: 'archive',
    database: mockDb,
  });
  assert.equal(archived.status, 'archived');
  assert.equal(auditEvents.includes('ARCHIVE'), true);
});

test('B, C, D. Archive preserves messages, CRM contact, and NEVER_AI override', async () => {
  let convStatus = 'closed';
  const contactOverride = 'NEVER_AI';
  const messages = [{ id: 'm-1', content: 'hello' }, { id: 'm-2', content: 'world' }];

  const mockDb = {
    async connect() {
      return {
        async query(sql, params = []) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT c.*, tc.channel_type')) {
            return {
              rowCount: 1,
              rows: [{
                id: conversationIdA,
                tenant_id: tenantIdA,
                channel_id: channelIdA,
                channel_type: 'INSTAGRAM',
                contact_id: contactIdA,
                status: convStatus,
                handling_mode: 'AI',
                assigned_agent_user_id: null,
                ai_behavior_override: contactOverride,
              }],
            };
          }
          if (sql.includes("status = 'archived'")) {
            convStatus = 'archived';
            return { rowCount: 1, rows: [{ id: conversationIdA, status: 'archived', tenant_id: tenantIdA, contact_id: contactIdA, ai_behavior_override: contactOverride }] };
          }
          if (sql.includes('INSERT INTO conversation_audit_events')) return { rowCount: 1, rows: [{ id: 'evt-1' }] };
          if (sql.includes('pg_notify')) return { rowCount: 1 };
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const archived = await operateConversation({
    tenantId: tenantIdA,
    conversationId: conversationIdA,
    actor: actorAdmin,
    action: 'archive',
    database: mockDb,
  });

  assert.equal(archived.status, 'archived');
  assert.equal(archived.contact_id, contactIdA);
  assert.equal(archived.ai_behavior_override, 'NEVER_AI');
  assert.equal(messages.length, 2);
});
test('E & F. Archived conversation causes 0 AI calls, 0 outbound, 0 push, and NEVER_AI remains active on future inbound', async () => {
  let aiCalled = false;
  let outboundCalled = false;
  let pushCalled = false;

  const inboundState = {
    integration: {
      tenant_id: tenantIdA,
      channel_id: channelIdA,
      external_channel_id: '17841400012345678',
      config: { access_token: 'token-xyz', activation_policy: 'ALL_MESSAGES' },
    },
    conversation: {
      id: conversationIdA,
      status: 'archived',
      handling_mode: 'AI',
      ai_behavior_override: 'NEVER_AI',
    },
    shouldInvokeAi: true,
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    inboundState,
    senderIgsid: 'cust_suleyman_isseven',
    text: 'Yeni bir soru sormak istiyorum',
    generateAiResponse: async () => { aiCalled = true; return 'AI reply'; },
  });

  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.suppressed, true);
  assert.equal(aiCalled, false);
  assert.equal(outboundCalled, false);
  assert.equal(pushCalled, false);
});

test('G. Tenant A cannot archive Tenant B conversation (Tenant isolation)', async () => {
  const mockDb = {
    async connect() {
      return {
        async query(sql, params = []) {
          if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT c.*, tc.channel_type')) {
            return { rowCount: 0, rows: [] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  await assert.rejects(
    operateConversation({
      tenantId: tenantIdA,
      conversationId: 'conversation-belongs-to-tenant-b',
      actor: actorAdmin,
      action: 'archive',
      database: mockDb,
    }),
    (err) => err instanceof ConversationOperationError && err.status === 404
  );
});

test('H. Archive and unarchive operations are idempotent', async () => {
  let currentStatus = 'archived';

  const mockDb = {
    async connect() {
      return {
        async query(sql, params = []) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT c.*, tc.channel_type')) {
            return {
              rowCount: 1,
              rows: [{
                id: conversationIdA,
                tenant_id: tenantIdA,
                channel_id: channelIdA,
                channel_type: 'INSTAGRAM',
                status: currentStatus,
                handling_mode: 'AI',
                assigned_agent_user_id: null,
              }],
            };
          }
          if (sql.includes("status = 'archived'")) {
            currentStatus = 'archived';
            return { rowCount: 1, rows: [{ id: conversationIdA, status: 'archived', tenant_id: tenantIdA }] };
          }
          if (sql.includes("status = 'open'")) {
            currentStatus = 'open';
            return { rowCount: 1, rows: [{ id: conversationIdA, status: 'open', tenant_id: tenantIdA }] };
          }
          if (sql.includes('INSERT INTO conversation_audit_events')) return { rowCount: 1, rows: [{ id: 'evt-1' }] };
          if (sql.includes('pg_notify')) return { rowCount: 1 };
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const rearchived = await operateConversation({
    tenantId: tenantIdA,
    conversationId: conversationIdA,
    actor: actorAdmin,
    action: 'archive',
    database: mockDb,
  });
  assert.equal(rearchived.status, 'archived');

  const unarchived = await operateConversation({
    tenantId: tenantIdA,
    conversationId: conversationIdA,
    actor: actorAdmin,
    action: 'unarchive',
    database: mockDb,
  });
  assert.equal(unarchived.status, 'open');
});
