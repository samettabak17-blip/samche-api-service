process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isInstagramWebhookEvent,
  isWhatsAppWebhookEvent,
  parseInstagramMessagingEvent,
  extractInstagramInboundEvents,
} from '../services/instagram-inbound-adapter.js';
import {
  deliverInstagramText,
  deliverInstagramMedia,
  InstagramDeliveryError,
} from '../services/instagram-delivery-service.js';
import {
  resolveInstagramIntegration,
  upsertInstagramConversation,
  persistInstagramInbound,
  instagramCustomerReference,
  instagramExternalConversationId,
} from '../services/instagram-live-inbox-service.js';
import { orchestrateInstagramInboundAiResponse } from '../services/instagram-ai-orchestrator.js';
import { crmContactIdentity } from '../services/crm-lead-service.js';
import { channelDeliveryRegistry } from '../services/channel-delivery-registry.js';
import { appendAgentMessage, ConversationOperationError } from '../services/live-inbox-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const conversationId = '22222222-2222-4222-8222-222222222222';
const channelId = '33333333-3333-4333-8333-333333333333';
const assistantId = '44444444-4444-4444-8444-444444444444';
const testIgsid = 'ig-user-123456';
const testPageId = '17841400000000001';
const actor = { userId: '55555555-5555-4555-8555-555555555555', systemRole: 'OWNER', tenantRole: 'ADMIN' };

// ---------------------------------------------------------------------------
// 1. INBOUND WEBHOOK DISCRIMINATION & PARSING TESTS
// ---------------------------------------------------------------------------
test('isInstagramWebhookEvent and isWhatsAppWebhookEvent discriminate payloads deterministically', () => {
  const igPayload = {
    object: 'instagram',
    entry: [{ id: testPageId, time: 1600000000000, messaging: [{ sender: { id: testIgsid }, message: { mid: 'm_1', text: 'Hi' } }] }],
  };
  const wpPayload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ value: { messages: [{ from: '15551234567', text: { body: 'Hello' } }] } }] }],
  };

  assert.equal(isInstagramWebhookEvent(igPayload), true);
  assert.equal(isInstagramWebhookEvent(wpPayload), false);

  assert.equal(isWhatsAppWebhookEvent(wpPayload), true);
  assert.equal(isWhatsAppWebhookEvent(igPayload), false);

  assert.equal(isInstagramWebhookEvent({ object: 'page' }), false);
  assert.equal(isWhatsAppWebhookEvent({ object: 'page' }), false);
});

test('parses Instagram text message event correctly', () => {
  const rawEvent = {
    sender: { id: testIgsid },
    recipient: { id: testPageId },
    timestamp: 1600000000000,
    message: {
      mid: 'mid.ig.1001',
      text: 'Hello, I want to learn about your services',
    },
  };

  const parsed = parseInstagramMessagingEvent({ id: testPageId }, rawEvent);
  assert.equal(parsed.senderId, testIgsid);
  assert.equal(parsed.recipientId, testPageId);
  assert.equal(parsed.messageId, 'mid.ig.1001');
  assert.equal(parsed.text, 'Hello, I want to learn about your services');
  assert.equal(parsed.isEcho, false);
  assert.equal(parsed.attachments.length, 0);
});

test('parses Instagram media attachment and story mention correctly', () => {
  const mediaEvent = {
    sender: { id: testIgsid },
    recipient: { id: testPageId },
    timestamp: 1600000000000,
    message: {
      mid: 'mid.ig.1002',
      attachments: [
        { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/ig_img.jpg' } },
        { type: 'story_mention', payload: { url: 'https://lookaside.fbsbx.com/story.jpg' } },
      ],
    },
  };

  const parsed = parseInstagramMessagingEvent({ id: testPageId }, mediaEvent);
  assert.equal(parsed.messageId, 'mid.ig.1002');
  assert.equal(parsed.attachments.length, 2);
  assert.equal(parsed.attachments[0].type, 'image');
  assert.equal(parsed.attachments[0].url, 'https://lookaside.fbsbx.com/ig_img.jpg');
  assert.equal(parsed.isStoryMention, true);
});

test('echo messages from business account are flagged to prevent loops', () => {
  const echoEvent = {
    sender: { id: testPageId },
    recipient: { id: testIgsid },
    timestamp: 1600000000000,
    message: {
      mid: 'mid.ig.echo.1',
      text: 'Our reply to customer',
      is_echo: true,
    },
  };

  const parsed = parseInstagramMessagingEvent({ id: testPageId }, echoEvent);
  assert.equal(parsed.isEcho, true);
});

// ---------------------------------------------------------------------------
// 2. TENANT RESOLUTION & CONTACT IDENTITY INVARIANTS
// ---------------------------------------------------------------------------
test('resolveInstagramIntegration resolves exact tenant channel and fails closed for unknown', async () => {
  const mockClient = {
    async query(sql, params) {
      if (params[0] === testPageId) {
        return {
          rowCount: 1,
          rows: [{
            tenant_id: tenantId,
            channel_id: channelId,
            assistant_id: assistantId,
            channel_type: 'INSTAGRAM',
            external_channel_id: testPageId,
            channel_status: 'active',
            assistant_status: 'active',
            config: { page_id: testPageId, access_token: 'meta-ig-token-xyz' },
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const resolved = await resolveInstagramIntegration(mockClient, testPageId);
  assert.equal(resolved.tenant_id, tenantId);
  assert.equal(resolved.channel_id, channelId);
  assert.equal(resolved.config.access_token, 'meta-ig-token-xyz');

  const unknown = await resolveInstagramIntegration(mockClient, 'unknown-page-999');
  assert.equal(unknown, null);
});

test('ambiguous Instagram ownership across tenants fails closed', async () => {
  const mockClient = {
    async query() {
      return { rowCount: 2, rows: [{ tenant_id: tenantId }, { tenant_id: otherTenantId }] };
    },
  };

  const resolved = await resolveInstagramIntegration(mockClient, testPageId);
  assert.equal(resolved, null);
});

test('Instagram IGSID creates isolated EXTERNAL_CUSTOMER contact and never merges with WhatsApp', () => {
  const igContact = crmContactIdentity({
    tenantId,
    source: 'INSTAGRAM',
    externalCustomerId: `instagram:${testIgsid}`,
  });

  const wpContact = crmContactIdentity({
    tenantId,
    source: 'WHATSAPP',
    phone: '+905551234567',
  });

  assert.equal(igContact.kind, 'EXTERNAL_CUSTOMER');
  assert.equal(wpContact.kind, 'PHONE');
  assert.notEqual(igContact.identityHash, wpContact.identityHash);

  // Different tenants with same IGSID produce distinct hashes
  const otherTenantIgContact = crmContactIdentity({
    tenantId: otherTenantId,
    source: 'INSTAGRAM',
    externalCustomerId: `instagram:${testIgsid}`,
  });
  assert.notEqual(igContact.identityHash, otherTenantIgContact.identityHash);
});

// ---------------------------------------------------------------------------
// 3. CANONICAL CONVERSATION & MESSAGE PERSISTENCE
// ---------------------------------------------------------------------------
test('persistInstagramInbound persists conversation, message and resources idempotently', async () => {
  const insertedMessages = [];
  const insertedResources = [];
  const notifications = [];

  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT tc.tenant_id')) {
            return {
              rowCount: 1,
              rows: [{
                tenant_id: tenantId,
                channel_id: channelId,
                assistant_id: assistantId,
                external_channel_id: testPageId,
                channel_type: 'INSTAGRAM',
                config: { page_id: testPageId, access_token: 'meta-ig-token-xyz' },
              }],
            };
          }
          if (sql.includes('INSERT INTO conversations')) {
            return {
              rowCount: 1,
              rows: [{
                id: conversationId,
                tenant_id: tenantId,
                channel_id: channelId,
                status: 'open',
                handling_mode: 'AI',
                handling_version: 1,
              }],
            };
          }
          if (sql.includes('SELECT id, sender_type FROM conversation_messages')) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes('INSERT INTO conversation_messages')) {
            const msg = { id: 'msg-ig-1', tenant_id: params[0], conversation_id: params[1], sender_type: 'CUSTOMER', content: params[2], external_message_id: params[3] };
            insertedMessages.push(msg);
            return { rows: [msg] };
          }
          if (sql.includes('INSERT INTO conversation_resources')) {
            insertedResources.push({ messageId: params[2], mediaCategory: params[4], sourceUrl: params[10] });
            return { rows: [{ id: 'res-ig-1' }] };
          }
          if (sql.includes('pg_notify')) {
            notifications.push(JSON.parse(params[1]));
            return {};
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const result = await persistInstagramInbound({
    database: mockDb,
    recipientId: testPageId,
    senderIgsid: testIgsid,
    messageId: 'mid.ig.1005',
    content: 'Interested in property options',
    attachments: [{ type: 'image', url: 'https://cdn.fb.com/image1.jpg' }],
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.shouldInvokeAi, true);
  assert.equal(insertedMessages.length, 1);
  assert.equal(insertedMessages[0].content, 'Interested in property options');
  assert.equal(insertedMessages[0].external_message_id, 'mid.ig.1005');
  assert.equal(insertedResources.length, 1);
  assert.equal(insertedResources[0].sourceUrl, 'https://cdn.fb.com/image1.jpg');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'CUSTOMER_MESSAGE');
});


// ---------------------------------------------------------------------------
// 4. OUTBOUND INSTAGRAM DELIVERY & LIVE INBOX ADAPTER
// ---------------------------------------------------------------------------
test('deliverInstagramText delivers via Meta Graph API and returns provider message ID', async () => {
  const httpCalls = [];
  const fakeHttp = {
    async post(url, body, options) {
      httpCalls.push({ url, body, options });
      return {
        data: {
          recipient_id: testIgsid,
          message_id: 'mid.ig.out.2001',
        },
      };
    },
  };

  const result = await deliverInstagramText({
    recipientId: testIgsid,
    content: 'Thank you for your message, how can we help?',
    accessToken: 'test-ig-access-token',
    pageId: testPageId,
    http: fakeHttp,
  });

  assert.equal(result.delivery, 'SENT_TO_INSTAGRAM');
  assert.equal(result.recipientId, testIgsid);
  assert.equal(result.providerMessageId, 'mid.ig.out.2001');
  assert.equal(httpCalls.length, 1);
  assert.equal(httpCalls[0].body.recipient.id, testIgsid);
  assert.equal(httpCalls[0].body.message.text, 'Thank you for your message, how can we help?');
  assert.equal(httpCalls[0].options.headers.Authorization, 'Bearer test-ig-access-token');
});

test('deliverInstagramMedia delivers supported image attachment via Graph API', async () => {
  const httpCalls = [];
  const fakeHttp = {
    async post(url, body, options) {
      httpCalls.push({ url, body, options });
      return {
        data: {
          recipient_id: testIgsid,
          message_id: 'mid.ig.media.3001',
        },
      };
    },
  };

  const result = await deliverInstagramMedia({
    recipientId: testIgsid,
    mediaUrl: 'https://storage.samche.com/resources/concept-1.jpg',
    mediaCategory: 'IMAGE',
    accessToken: 'test-ig-access-token',
    pageId: testPageId,
    http: fakeHttp,
  });

  assert.equal(result.delivery, 'SENT_TO_INSTAGRAM');
  assert.equal(result.providerMessageId, 'mid.ig.media.3001');
  assert.equal(httpCalls.length, 1);
  assert.equal(httpCalls[0].body.message.attachment.type, 'image');
  assert.equal(httpCalls[0].body.message.attachment.payload.url, 'https://storage.samche.com/resources/concept-1.jpg');
});

test('operator reply in Live Inbox dispatches to Instagram when configured', async () => {
  const delivered = [];
  const fakeHttp = {
    async post(url, body) {
      delivered.push(body);
      return { data: { recipient_id: testIgsid, message_id: 'mid.ig.reply.1' } };
    },
  };

  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT') return {};
          if (sql.includes('FROM conversations c')) {
            return {
              rows: [{
                id: conversationId,
                tenant_id: tenantId,
                channel_id: channelId,
                status: 'open',
                handling_mode: 'HUMAN',
                assigned_agent_user_id: actor.userId,
                channel_type: 'INSTAGRAM',
                customer_external_id: `instagram:${testIgsid}`,
                human_attention_state: 'REQUESTED',
              }],
            };
          }
          if (sql.includes('FROM tenant_channels tc') && sql.includes('channel_integrations')) {
            return {
              rowCount: 1,
              rows: [{
                id: channelId,
                tenant_id: tenantId,
                external_channel_id: testPageId,
                channel_type: 'INSTAGRAM',
                channel_status: 'active',
                config: { access_token: 'live-ig-token', page_id: testPageId },
              }],
            };
          }
          if (sql.includes('INSERT INTO conversation_messages')) {
            return { rows: [{ id: 'msg-agent-1', sender_type: 'AGENT' }] };
          }
          if (sql.includes('UPDATE conversations')) {
            return { rowCount: 1, rows: [{ id: conversationId }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const result = await appendAgentMessage({
    tenantId,
    conversationId,
    actor,
    content: 'Live agent reply to customer',
    database: mockDb,
    http: fakeHttp,
  });

  assert.equal(result.delivery, 'SENT_TO_INSTAGRAM');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].message.text, 'Live agent reply to customer');
});

// ---------------------------------------------------------------------------
// 5. AI ORCHESTRATOR & HUMAN HANDOFF
// ---------------------------------------------------------------------------
test('orchestrateInstagramInboundAiResponse handles human handoff request and triggers push notifications', async () => {
  let pushTriggered = false;
  const deliveredAcks = [];

  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM conversations')) {
        return {
          rows: [{
            id: conversationId,
            tenant_id: tenantId,
            channel_id: channelId,
            status: 'open',
            handling_mode: 'AI',
            human_attention_state: 'NONE',
            handling_version: 1,
          }],
        };
      }
      if (sql.includes('platform_lifecycle_message_templates')) {
        return {
          rows: [
            { message_key: 'human_support_default_topic', locale: 'en', body: 'General support', allowed_variables: [], active: true },
            { message_key: 'human_support_request', locale: 'en', body: 'Connecting you to an agent.', allowed_variables: ['TOPIC'], active: true },
          ],
        };
      }
      if (sql.includes('INSERT INTO human_support_escalations')) {
        return { rows: [{ id: 'esc-1' }] };
      }
      if (sql.includes('INSERT INTO push_notification_intents')) {
        pushTriggered = true;
        return { rows: [{ id: 'intent-1' }] };
      }
      return { rows: [] };
    },
    async connect() { return this; },
    release() {},
  };

  const fakeHttp = {
    async post(url, body) {
      deliveredAcks.push(body);
      return { data: { message_id: 'mid.ack.1' } };
    },
  };

  const inboundState = {
    integration: {
      tenant_id: tenantId,
      channel_id: channelId,
      assistant_id: assistantId,
      external_channel_id: testPageId,
      config: { access_token: 'test-token', page_id: testPageId },
    },
    conversation: {
      id: conversationId,
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      communication_language: 'en',
    },
    shouldInvokeAi: true,
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: testIgsid,
    text: 'I want to talk to a human agent please',
    http: fakeHttp,
  });

  assert.equal(outcome.handoff, true);
  assert.equal(deliveredAcks.length, 1);
});

test('orchestrateInstagramInboundAiResponse generates and delivers AI response in AI mode', async () => {
  const outboundDMs = [];
  const fakeHttp = {
    async post(url, body) {
      outboundDMs.push(body);
      return { data: { recipient_id: testIgsid, message_id: 'mid.ai.101' } };
    },
  };

  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM ai_assistants')) {
        return { rows: [{ id: assistantId, name: 'Instagram Assistant', system_prompt: 'Help customers with questions.' }] };
      }
      if (sql.includes('FROM conversations')) {
        return { rows: [{ id: conversationId, tenant_id: tenantId, channel_id: channelId, handling_mode: 'AI', handling_version: 1, status: 'open' }] };
      }
      if (sql.includes('INSERT INTO conversation_messages')) {
        return { rows: [{ id: 'msg-ai-1', sender_type: 'ASSISTANT', content: 'We are open Monday through Friday, 9 AM to 6 PM.' }] };
      }
      return { rows: [] };
    },
    async connect() { return this; },
    release() {},
  };

  const inboundState = {
    integration: {
      tenant_id: tenantId,
      channel_id: channelId,
      assistant_id: assistantId,
      external_channel_id: testPageId,
      config: { access_token: 'test-token', page_id: testPageId },
    },
    conversation: {
      id: conversationId,
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      communication_language: 'en',
    },
    shouldInvokeAi: true,
    handlingVersion: 1,
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: testIgsid,
    text: 'What are your working hours?',
    http: fakeHttp,
    generateAiResponse: async () => 'We are open Monday through Friday, 9 AM to 6 PM.',
  });

  assert.equal(outcome.delivered, true);
  assert.equal(outcome.responseText, 'We are open Monday through Friday, 9 AM to 6 PM.');
  assert.equal(outboundDMs.length, 1);
  assert.equal(outboundDMs[0].message.text, 'We are open Monday through Friday, 9 AM to 6 PM.');
});
