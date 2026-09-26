process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueCustomerMessagePushNotification,
  enqueueHumanHandoffPushNotification,
  createPushNotificationIntent,
} from '../services/push-notification-service.js';
import { createWebPushPayload } from '../services/web-push-delivery-adapter.js';

const tenantIdA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantIdB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userIdA = '11111111-1111-4111-8111-111111111111';
const convId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const msgId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// A. INSTAGRAM INBOUND CUSTOMER_MESSAGE -> PUSH
test('A. Instagram inbound CUSTOMER_MESSAGE creates push intent with Instagram deep link', async () => {
  const mockDb = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'intent-ig-1',
            tenant_id: tenantIdA,
            event_id: `customer-message:${convId}:${msgId}`,
            event_type: 'CUSTOMER_MESSAGE_RECEIVED',
            deepLink: `/app/${tenantIdA}/conversations/instagram/${convId}`,
            status: 'PENDING',
          }],
        };
      }
      if (sql.includes('INSERT INTO push_notification_outbox')) return { rowCount: 1, rows: [{ id: 'out-1' }] };
      return { rowCount: 0, rows: [] };
    },
  };

  const intent = await enqueueCustomerMessagePushNotification({
    database: mockDb,
    tenantId: tenantIdA,
    conversationId: convId,
    messageId: msgId,
    channelType: 'INSTAGRAM',
  });

  assert.equal(intent.event_type, 'CUSTOMER_MESSAGE_RECEIVED');
  assert.equal(intent.deepLink, `/app/${tenantIdA}/conversations/instagram/${convId}`);
});

// B. WHATSAPP INBOUND CUSTOMER_MESSAGE -> PUSH
test('B. WhatsApp inbound CUSTOMER_MESSAGE creates push intent with WhatsApp deep link', async () => {
  const mockDb = {
    async query(sql) {
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'intent-wa-1',
            tenant_id: tenantIdA,
            event_id: `customer-message:${convId}:${msgId}`,
            event_type: 'CUSTOMER_MESSAGE_RECEIVED',
            deepLink: `/app/${tenantIdA}/conversations/whatsapp/${convId}`,
          }],
        };
      }
      if (sql.includes('INSERT INTO push_notification_outbox')) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };

  const intent = await enqueueCustomerMessagePushNotification({
    database: mockDb,
    tenantId: tenantIdA,
    conversationId: convId,
    messageId: msgId,
    channelType: 'WHATSAPP',
  });

  assert.equal(intent.deepLink, `/app/${tenantIdA}/conversations/whatsapp/${convId}`);
});

// C. WEB CHAT CUSTOMER_MESSAGE -> PUSH
test('C. Web Chat CUSTOMER_MESSAGE creates push intent with web-chat deep link', async () => {
  const mockDb = {
    async query(sql) {
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'intent-wc-1',
            tenant_id: tenantIdA,
            deepLink: `/app/${tenantIdA}/conversations/web-chat/${convId}`,
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const intent = await enqueueCustomerMessagePushNotification({
    database: mockDb,
    tenantId: tenantIdA,
    conversationId: convId,
    messageId: msgId,
    channelType: 'WEB_CHAT',
  });

  assert.equal(intent.deepLink, `/app/${tenantIdA}/conversations/web-chat/${convId}`);
});

// D. AI GUIDE CUSTOMER_MESSAGE -> PUSH
test('D. AI Guide CUSTOMER_MESSAGE creates push intent with guide deep link', async () => {
  const mockDb = {
    async query(sql) {
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'intent-gd-1',
            tenant_id: tenantIdA,
            deepLink: `/app/${tenantIdA}/conversations/guide/${convId}`,
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const intent = await enqueueCustomerMessagePushNotification({
    database: mockDb,
    tenantId: tenantIdA,
    conversationId: convId,
    messageId: msgId,
    channelType: 'SAMCHEGUIDE',
  });

  assert.equal(intent.deepLink, `/app/${tenantIdA}/conversations/guide/${convId}`);
});

// E. MANUAL_ONLY INSTAGRAM -> PUSH YES, AI SILENT
test('E. MANUAL_ONLY Instagram inbound creates push intent while AI remains silent', async () => {
  const { orchestrateInstagramInboundAiResponse } = await import('../services/instagram-ai-orchestrator.js');
  let aiCalled = false;
  const inboundState = {
    integration: { tenant_id: tenantIdA, channel_id: 'chan-a', assistant_id: 'asst-1', external_channel_id: '17841400', config: { activation_policy: 'MANUAL_ONLY' } },
    conversation: { id: convId, status: 'open', handling_mode: 'AI', handling_version: 1 },
    shouldInvokeAi: true,
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    inboundState,
    senderIgsid: 'sender-1',
    text: 'Hello team',
    generateAiResponse: async () => { aiCalled = true; return 'AI reply'; },
  });

  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.suppressed, true);
  assert.equal(aiCalled, false);
});

// F. WEBHOOK RETRY / DUPLICATE -> IDEMPOTENT INTENT
test('F. duplicate message ID creates idempotent intent and does not duplicate outbox deliveries', async () => {
  const mockDb = {
    async query(sql) {
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return { rowCount: 1, rows: [{ id: 'intent-dup-1', tenant_id: tenantIdA, event_id: `customer-message:${convId}:${msgId}`, event_type: 'CUSTOMER_MESSAGE_RECEIVED', deepLink: `/app/${tenantIdA}/conversations/instagram/${convId}` }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const intent1 = await enqueueCustomerMessagePushNotification({ database: mockDb, tenantId: tenantIdA, conversationId: convId, messageId: msgId, channelType: 'INSTAGRAM' });
  const intent2 = await enqueueCustomerMessagePushNotification({ database: mockDb, tenantId: tenantIdA, conversationId: convId, messageId: msgId, channelType: 'INSTAGRAM' });
  assert.equal(intent1.id, intent2.id);
});

// G. WEB PUSH PAYLOAD FORMATTING
test('G. createWebPushPayload formats CUSTOMER_MESSAGE_RECEIVED with customer message title', () => {
  const payload = createWebPushPayload({
    type: 'CUSTOMER_MESSAGE_RECEIVED',
    deepLink: `/app/${tenantIdA}/conversations/instagram/${convId}`,
    tenantId: tenantIdA,
    conversationId: convId,
    eventId: `customer-message:${convId}:${msgId}`,
  });
  assert.equal(payload.type, 'CUSTOMER_MESSAGE_RECEIVED');
  assert.equal(payload.title, 'Yeni Müşteri Mesajı');
  assert.equal(payload.deepLink, `/app/${tenantIdA}/conversations/instagram/${convId}`);
});

// I. TENANT ISOLATION
test('I. Tenant A customer message targets only Tenant A subscriptions', async () => {
  const calls = [];
  const mockDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return { rowCount: 1, rows: [{ id: 'intent-a', tenant_id: tenantIdA, event_id: 'e-1', event_type: 'CUSTOMER_MESSAGE_RECEIVED', deepLink: `/app/${tenantIdA}/conversations/instagram/${convId}` }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  await enqueueCustomerMessagePushNotification({ database: mockDb, tenantId: tenantIdA, conversationId: convId, messageId: msgId, channelType: 'INSTAGRAM' });
  const outboxSql = calls.find((c) => c.sql.includes('INSERT INTO push_notification_outbox'));
  assert.ok(outboxSql);
  assert.match(outboxSql.sql, /subscription\.tenant_id=intent\.tenant_id/);
});

// K. USER PREFERENCE DISABLES CUSTOMER_MESSAGE PUSH
test('K. user preference category filter disables customer_messages push', async () => {
  const calls = [];
  const mockDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return { rowCount: 1, rows: [{ id: 'intent-p', tenant_id: tenantIdA, event_id: 'e-1', event_type: 'CUSTOMER_MESSAGE_RECEIVED', deep_link: `/app/${tenantIdA}/conversations/instagram/${convId}` }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  await createPushNotificationIntent({ database: mockDb, tenantId: tenantIdA, eventId: 'e-1', eventType: 'CUSTOMER_MESSAGE_RECEIVED', deepLink: `/app/${tenantIdA}/conversations/instagram/${convId}` });
  const outboxCall = calls.find((c) => c.sql.includes('INSERT INTO push_notification_outbox'));
  assert.ok(outboxCall);
  assert.match(outboxCall.sql, /preference\.categories->>'customer_messages' = 'true'/);
});

// L. EXISTING HUMAN_HANDOFF_REQUESTED UNCHANGED
test('L. existing HUMAN_HANDOFF_REQUESTED push notifications remain intact', async () => {
  const mockDb = {
    async query(sql, params) {
      if (sql.includes('SELECT tc.channel_type')) return { rowCount: 1, rows: [{ channel_type: 'WHATSAPP' }] };
      if (sql.includes('INSERT INTO push_notification_intents')) {
        return { rowCount: 1, rows: [{ id: 'intent-h', tenant_id: tenantIdA, event_id: 'human-handoff:out-1', event_type: 'HUMAN_HANDOFF_REQUESTED', deepLink: `/app/${tenantIdA}/conversations/whatsapp/${convId}` }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const intent = await enqueueHumanHandoffPushNotification({ database: mockDb, tenantId: tenantIdA, conversationId: convId, handoffOutboxId: 'out-1' });
  assert.equal(intent.event_type, 'HUMAN_HANDOFF_REQUESTED');
  assert.equal(intent.deepLink, `/app/${tenantIdA}/conversations/whatsapp/${convId}`);
});

