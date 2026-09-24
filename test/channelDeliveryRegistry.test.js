process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendAgentMessage,
  ConversationOperationError,
  getHumanDeliveryCapability,
  operateConversation,
} from '../services/live-inbox-service.js';
import {
  channelDeliveryRegistry,
  ChannelDeliveryError,
} from '../services/channel-delivery-registry.js';
import {
  isValidChannelType,
  normalizeChannelType,
  resolveChannelDashboardRoute,
  SUPPORTED_CHANNEL_TYPES,
} from '../services/channel-routing-service.js';
import {
  inferConservativeCommunicationLanguage,
  inferConservativeWhatsAppLanguage,
  inferExplicitCommunicationLanguageRequest,
  inferExplicitWhatsAppLanguageRequest,
  isClearlySubstantiveCommunicationMessage,
  isClearlySubstantiveWhatsAppMessage,
  resolveCommunicationLanguage,
  resolveWhatsAppCommunicationLanguage,
  resolveMediaResponseLanguage,
  resolveWhatsAppMediaResponseLanguage,
} from '../services/conversation-communication-language.js';
import { enqueueHumanHandoffPushNotification } from '../services/push-notification-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const conversationId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: '33333333-3333-4333-8333-333333333333', systemRole: 'OWNER', tenantRole: 'ADMIN' };

function conversationFixture({ channelType = 'WHATSAPP', status = 'open', handlingMode = 'HUMAN', attentionState = 'REQUESTED' } = {}) {
  return {
    id: conversationId,
    tenant_id: tenantId,
    channel_id: '44444444-4444-4444-8444-444444444444',
    customer_external_id: channelType === 'WHATSAPP' ? 'whatsapp:15551234567' : 'session-abc-123',
    status,
    handling_mode: handlingMode,
    assigned_agent_user_id: actor.userId,
    channel_type: channelType,
    external_channel_id: '948536645017374',
    human_attention_state: attentionState,
    communication_language: 'tr',
    handling_version: 1,
  };
}

function createDatabaseFixture({ conversation = conversationFixture(), mapping = true } = {}) {
  const calls = [];
  let currentConv = conversation ? { ...conversation } : null;
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes('FROM conversations c')) {
        return { rows: currentConv ? [currentConv] : [] };
      }
      if (sql.includes('FROM tenant_channels tc') && sql.includes('channel_integrations')) {
        return mapping ? { rowCount: 1, rows: [{ external_channel_id: currentConv?.external_channel_id, integration_key: `${currentConv?.channel_type}:${currentConv?.external_channel_id}` }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM conversation_messages') && sql.includes('idempotency_key')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO conversation_messages')) {
        return { rows: [{ id: '55555555-5555-4555-8555-555555555555', sender_type: parameters[2] || 'AGENT', content: parameters[3] }] };
      }
      if (sql.includes('UPDATE conversations')) {
        if (sql.includes("handling_mode = 'HUMAN'")) {
          currentConv.handling_mode = 'HUMAN';
          if (currentConv.human_attention_state === 'REQUESTED') {
            currentConv.human_attention_state = 'ACKNOWLEDGED';
          }
        }
        if (sql.includes("handling_mode = 'AI'")) {
          currentConv.handling_mode = 'AI';
          currentConv.human_attention_state = 'RESOLVED';
        }
        if (sql.includes("handling_mode = 'PAUSED'")) {
          currentConv.handling_mode = 'PAUSED';
        }
        if (sql.includes("status = 'closed'")) {
          currentConv.status = 'closed';
        }
        return { rowCount: 1, rows: [currentConv] };
      }
      if (sql.includes('platform_lifecycle_message_templates')) {
        const keys = ['human_support_default_topic', 'human_support_request', 'human_session_warning', 'human_takeover', 'return_to_ai'];
        const locales = ['tr', 'en', 'ar'];
        const rows = [];
        for (const k of keys) {
          for (const loc of locales) {
            rows.push({
              message_key: k,
              locale: loc,
              body: k === 'human_support_request' ? '{TOPIC} support request' : 'Notice message',
              allowed_variables: k === 'human_support_request' ? ['TOPIC'] : [],
              active: true,
            });
          }
        }
        return { rows };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, calls, getConversation: () => currentConv };
}

// ---------------------------------------------------------------------------
// 1. CHANNEL ROUTING HELPER TESTS
// ---------------------------------------------------------------------------
test('channel routing helper recognizes all canonical platform channel types', () => {
  assert.deepEqual([...SUPPORTED_CHANNEL_TYPES], ['WHATSAPP', 'WEB_CHAT', 'SAMCHEGUIDE', 'INSTAGRAM']);
  assert.equal(isValidChannelType('WHATSAPP'), true);
  assert.equal(isValidChannelType('WEB_CHAT'), true);
  assert.equal(isValidChannelType('SAMCHEGUIDE'), true);
  assert.equal(isValidChannelType('INSTAGRAM'), true);
  assert.equal(isValidChannelType('instagram'), true);
  assert.equal(isValidChannelType('UNKNOWN_CHANNEL'), false);
  assert.equal(isValidChannelType(null), false);
});

test('channel dashboard route mapping resolves expected route slugs', () => {
  assert.equal(resolveChannelDashboardRoute('WHATSAPP'), 'whatsapp');
  assert.equal(resolveChannelDashboardRoute('WEB_CHAT'), 'web-chat');
  assert.equal(resolveChannelDashboardRoute('SAMCHEGUIDE'), 'guide');
  assert.equal(resolveChannelDashboardRoute('INSTAGRAM'), 'instagram');
  assert.equal(resolveChannelDashboardRoute('instagram'), 'instagram');
  assert.equal(resolveChannelDashboardRoute('UNKNOWN'), 'whatsapp');
});

// ---------------------------------------------------------------------------
// 2. CANONICAL LANGUAGE HELPER TESTS
// ---------------------------------------------------------------------------
test('canonical language helpers match legacy WhatsApp helpers exactly', () => {
  const trSample = 'Merhaba şirket kurmak istiyorum bilgi alabilir miyim';
  const enSample = 'Hello I would like to know the pricing and setup details';
  const esSample = 'Hola quiero obtener visado en españa';

  assert.equal(inferConservativeCommunicationLanguage(trSample), inferConservativeWhatsAppLanguage(trSample));
  assert.equal(inferConservativeCommunicationLanguage(enSample), inferConservativeWhatsAppLanguage(enSample));
  assert.equal(inferConservativeCommunicationLanguage(esSample), inferConservativeWhatsAppLanguage(esSample));

  const explicitTr = 'Lütfen Türkçe cevap veriniz';
  assert.equal(inferExplicitCommunicationLanguageRequest(explicitTr), inferExplicitWhatsAppLanguageRequest(explicitTr));

  assert.equal(isClearlySubstantiveCommunicationMessage(trSample), isClearlySubstantiveWhatsAppMessage(trSample));
  assert.equal(isClearlySubstantiveCommunicationMessage('slm'), isClearlySubstantiveWhatsAppMessage('slm'));

  assert.equal(
    resolveCommunicationLanguage({ currentLanguage: 'en', content: trSample }),
    resolveWhatsAppCommunicationLanguage({ currentLanguage: 'en', content: trSample })
  );

  assert.deepEqual(
    resolveMediaResponseLanguage({ currentLanguage: 'tr', lastReliableCustomerLanguage: 'en', caption: '' }),
    resolveWhatsAppMediaResponseLanguage({ currentLanguage: 'tr', lastReliableCustomerLanguage: 'en', caption: '' })
  );
});

// ---------------------------------------------------------------------------
// 3. GENERIC DELIVERY DISPATCHER: WHATSAPP
// ---------------------------------------------------------------------------
test('WhatsApp operator text message dispatches through delivery registry', async () => {
  const { database, calls } = createDatabaseFixture({ conversation: conversationFixture({ channelType: 'WHATSAPP' }) });
  const deliveryCalls = [];
  const result = await appendAgentMessage({
    tenantId,
    conversationId,
    actor,
    content: 'WhatsApp reply from agent',
    database,
    deliverWhatsApp: async (input) => {
      deliveryCalls.push(input);
      return { deliveredChunks: 1, failedChunks: 0 };
    },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.delivery, 'SENT_TO_WHATSAPP');
  assert.equal(deliveryCalls.length, 1);
  assert.equal(deliveryCalls[0].recipient, 'whatsapp:15551234567');
  assert.equal(deliveryCalls[0].phoneNumberId, '948536645017374');
  assert.equal(deliveryCalls[0].content, 'WhatsApp reply from agent');
});

// ---------------------------------------------------------------------------
// 4. GENERIC DELIVERY DISPATCHER: WEB CHAT & AI GUIDE
// ---------------------------------------------------------------------------
test('Web Chat operator message succeeds without external provider call', async () => {
  const { database } = createDatabaseFixture({ conversation: conversationFixture({ channelType: 'WEB_CHAT' }) });
  const result = await appendAgentMessage({
    tenantId,
    conversationId,
    actor,
    content: 'Web chat reply from agent',
    database,
    deliverWhatsApp: async () => {
      throw new Error('Must not invoke WhatsApp for Web Chat');
    },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.delivery, 'AVAILABLE_TO_SAMCHEGUIDE');
});

test('AI Guide operator message succeeds without external provider call', async () => {
  const { database } = createDatabaseFixture({ conversation: conversationFixture({ channelType: 'SAMCHEGUIDE' }) });
  const result = await appendAgentMessage({
    tenantId,
    conversationId,
    actor,
    content: 'Guide reply from agent',
    database,
    deliverWhatsApp: async () => {
      throw new Error('Must not invoke WhatsApp for AI Guide');
    },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.delivery, 'AVAILABLE_TO_SAMCHEGUIDE');
});

// ---------------------------------------------------------------------------
// 5. GENERIC DELIVERY DISPATCHER: INSTAGRAM (PHASE 1 DEFERRED)
// ---------------------------------------------------------------------------
test('INSTAGRAM channel capability returns configured: false in Phase 1', async () => {
  const { database } = createDatabaseFixture({ conversation: conversationFixture({ channelType: 'INSTAGRAM' }) });
  const capability = await getHumanDeliveryCapability({ tenantId, conversationId, database });
  assert.equal(capability.channelType, 'INSTAGRAM');
  assert.equal(capability.configured, false);
});

test('INSTAGRAM operator delivery attempt fails safely as not-configured in Phase 1', async () => {
  const { database } = createDatabaseFixture({ conversation: conversationFixture({ channelType: 'INSTAGRAM' }) });
  await assert.rejects(
    appendAgentMessage({
      tenantId,
      conversationId,
      actor,
      content: 'Instagram reply attempt',
      database,
    }),
    (error) => error instanceof ConversationOperationError && error.status === 409 && error.code === 'INSTAGRAM_DELIVERY_NOT_CONFIGURED'
  );
});

// ---------------------------------------------------------------------------
// 6. HANDOFF STATE TRANSITIONS & LIFECYCLE ABSTRACTION
// ---------------------------------------------------------------------------
test('Takeover on WhatsApp invokes WhatsApp lifecycle notice via dispatcher', async () => {
  const { database, getConversation } = createDatabaseFixture({
    conversation: conversationFixture({ channelType: 'WHATSAPP', handlingMode: 'AI', attentionState: 'NONE' }),
  });
  const lifecycleDelivery = [];
  const result = await operateConversation({
    database,
    tenantId,
    conversationId,
    actor,
    action: 'takeover',
    deliverWhatsApp: async (input) => {
      lifecycleDelivery.push(input);
      return { deliveredChunks: 1 };
    },
  });

  assert.equal(result.handling_mode, 'HUMAN');
  assert.equal(getConversation().handling_mode, 'HUMAN');
  assert.equal(lifecycleDelivery.length, 1);
  assert.equal(lifecycleDelivery[0].recipient, 'whatsapp:15551234567');
});

test('Return to AI on Web Chat persists assistant notice without external provider call', async () => {
  const { database, calls, getConversation } = createDatabaseFixture({
    conversation: conversationFixture({ channelType: 'WEB_CHAT', handlingMode: 'HUMAN', attentionState: 'ACKNOWLEDGED' }),
  });
  const result = await operateConversation({
    database,
    tenantId,
    conversationId,
    actor,
    action: 'return_to_ai',
    deliverWhatsApp: async () => {
      throw new Error('Must not call WhatsApp for Web Chat return-to-AI');
    },
  });

  assert.equal(result.handling_mode, 'AI');
  assert.equal(getConversation().handling_mode, 'AI');
  assert.ok(calls.some(({ sql, parameters }) => sql.includes('INSERT INTO conversation_messages') && parameters[2] === 'ASSISTANT'));
});

// ---------------------------------------------------------------------------
// 7. NOTIFICATION DEEP LINK ROUTING TESTS
// ---------------------------------------------------------------------------
test('push notification deep link generates expected route per channel type including Instagram', async () => {
  const testCases = [
    { channelType: 'WHATSAPP', expectedRoute: 'whatsapp' },
    { channelType: 'WEB_CHAT', expectedRoute: 'web-chat' },
    { channelType: 'SAMCHEGUIDE', expectedRoute: 'guide' },
    { channelType: 'INSTAGRAM', expectedRoute: 'instagram' },
  ];

  for (const { channelType, expectedRoute } of testCases) {
    let insertedDeepLink = null;
    const mockDb = {
      async query(sql, params) {
        if (sql.includes('SELECT tc.channel_type')) {
          return { rows: [{ channel_type: channelType }] };
        }
        if (sql.includes('INSERT INTO push_notification_intents')) {
          insertedDeepLink = params[3];
          return { rows: [{ id: '66666666-6666-4666-8666-666666666666', event_id: params[1], event_type: params[2], deep_link: params[3] }] };
        }
        if (sql.includes('INSERT INTO push_notification_outbox')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await enqueueHumanHandoffPushNotification({
      database: mockDb,
      tenantId,
      conversationId,
      handoffOutboxId: 'outbox-123',
      recipients: [actor.userId],
    });

    assert.equal(insertedDeepLink, `/app/${tenantId}/conversations/${expectedRoute}/${conversationId}`);
  }
});

// ---------------------------------------------------------------------------
// 8. STRICT TENANT ISOLATION
// ---------------------------------------------------------------------------
test('cross-tenant delivery attempt fails with CONVERSATION_NOT_FOUND', async () => {
  const { database } = createDatabaseFixture({ conversation: null });
  let delivered = false;
  await assert.rejects(
    appendAgentMessage({
      tenantId: otherTenantId,
      conversationId,
      actor,
      content: 'Cross tenant breach attempt',
      database,
      deliverWhatsApp: async () => { delivered = true; },
    }),
    (error) => error instanceof ConversationOperationError && error.status === 404 && error.code === 'CONVERSATION_NOT_FOUND'
  );
  assert.equal(delivered, false);
});
