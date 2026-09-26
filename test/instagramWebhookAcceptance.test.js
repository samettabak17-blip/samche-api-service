process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  isInstagramWebhookEvent,
  isWhatsAppWebhookEvent,
  extractInstagramInboundEvents,
} from '../services/instagram-inbound-adapter.js';
import {
  resolveInstagramIntegration,
  persistInstagramInbound,
  instagramCustomerReference,
  instagramExternalConversationId,
} from '../services/instagram-live-inbox-service.js';
import {
  orchestrateInstagramInboundAiResponse,
  generateAndDeliverInstagramAssistantResponse,
} from '../services/instagram-ai-orchestrator.js';
import { verifyWhatsAppSignature } from '../middleware/whatsappSignature.js';
import { isValidChannelType, resolveChannelDashboardRoute } from '../services/channel-routing-service.js';
import {
  subscribeInstagramAccountToWebhooks,
  getInstagramSubscribedApps,
  CANONICAL_INSTAGRAM_WEBHOOK_FIELDS,
} from '../services/tenant-instagram-provisioning-service.js';

const tenantIdA = '11111111-1111-4111-8111-111111111111';
const tenantIdB = '22222222-2222-4222-8222-222222222222';
const pageIdA = '17841400000000001';
const pageIdB = '17841400000000002';
const igsidCustomer1 = 'ig_user_sender_101';
const igsidCustomer2 = 'ig_user_sender_102';
const assistantIdA = '33333333-3333-4333-8333-333333333333';
const assistantIdB = '44444444-4444-4444-8444-444444444444';

// 1. VALID INSTAGRAM MESSAGE WEBHOOK
test('1. valid Instagram message webhook persists contact, conversation and message to correct tenant', async () => {
  const v26Payload = {
    object: 'instagram',
    entry: [{ id: pageIdA, time: 1727258400000, messaging: [{ sender: { id: igsidCustomer1 }, recipient: { id: pageIdA }, timestamp: 1727258400000, message: { mid: 'mid.v26.1001', text: 'Hello DM' } }] }],
  };

  assert.equal(isInstagramWebhookEvent(v26Payload), true);
  const events = extractInstagramInboundEvents(v26Payload);
  assert.equal(events.length, 1);

  let insertedMessage = null;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return { rowCount: 1, rows: [{ tenant_id: tenantIdA, channel_id: 'c-a', assistant_id: assistantIdA, external_channel_id: pageIdA, channel_type: 'INSTAGRAM', channel_status: 'active', assistant_status: 'active', config: {} }] };
          }
          if (sql.includes('INSERT INTO conversations')) {
            return { rowCount: 1, rows: [{ id: 'conv-101', tenant_id: tenantIdA, channel_id: 'c-a', status: 'open', handling_mode: 'AI', handling_version: 1, customer_external_id: `instagram:${igsidCustomer1}` }] };
          }
          if (sql.includes('SELECT id FROM conversation_messages WHERE external_message_id')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversation_messages')) {
            insertedMessage = { id: 'msg-101', content: params[2] };
            return { rowCount: 1, rows: [insertedMessage] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const result = await persistInstagramInbound({
    database: mockDb,
    recipientId: events[0].recipientId,
    senderIgsid: events[0].senderId,
    messageId: events[0].messageId,
    content: events[0].text,
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.integration.tenant_id, tenantIdA);
  assert.equal(insertedMessage.content, 'Hello DM');
});

// 2. MANUAL_ONLY
test('2. MANUAL_ONLY mode persists inbound message but generates zero automatic AI response', async () => {
  let aiCalled = false;
  const inboundState = {
    integration: { tenant_id: tenantIdA, channel_id: 'c-a', assistant_id: assistantIdA, external_channel_id: pageIdA, config: { activation_policy: 'MANUAL_ONLY' } },
    conversation: { id: 'conv-101', status: 'open', handling_mode: 'AI', handling_version: 1 },
    shouldInvokeAi: true,
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    inboundState,
    senderIgsid: igsidCustomer1,
    text: 'Quote request',
    generateAiResponse: async () => { aiCalled = true; return 'Quote'; },
  });

  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.suppressed, true);
  assert.equal(aiCalled, false);
});

// 3. UNKNOWN RECIPIENT FAILS CLOSED
test('3. unknown recipient/account fails closed with null and drops cross-tenant ingestion', async () => {
  const mockDb = { async query() { return { rowCount: 0, rows: [] }; } };
  const integration = await resolveInstagramIntegration(mockDb, '99999999999999999');
  assert.equal(integration, null);
});

// 4 & 5. MULTI-TENANT RESOLUTION
test('4 & 5. Tenant A routes only to Tenant A, Tenant B routes only to Tenant B', async () => {
  const mockDb = {
    async query(sql, params) {
      if (params[0] === pageIdA) {
        return { rowCount: 1, rows: [{ tenant_id: tenantIdA, channel_id: 'c-a', assistant_id: assistantIdA, external_channel_id: pageIdA, channel_type: 'INSTAGRAM', channel_status: 'active', assistant_status: 'active', config: {} }] };
      }
      if (params[0] === pageIdB) {
        return { rowCount: 1, rows: [{ tenant_id: tenantIdB, channel_id: 'c-b', assistant_id: assistantIdB, external_channel_id: pageIdB, channel_type: 'INSTAGRAM', channel_status: 'active', assistant_status: 'active', config: {} }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const intA = await resolveInstagramIntegration(mockDb, pageIdA);
  const intB = await resolveInstagramIntegration(mockDb, pageIdB);
  assert.equal(intA.tenant_id, tenantIdA);
  assert.equal(intB.tenant_id, tenantIdB);
});


// 6. ISOLATION: SAME SENDER ACROSS TENANTS
test('6. same sender ID across two tenants creates isolated external IDs and never leaks identity', () => {
  const ref = instagramCustomerReference(igsidCustomer1);
  const ext1 = instagramExternalConversationId(igsidCustomer1);
  const ext2 = instagramExternalConversationId(igsidCustomer2);
  assert.equal(ref, `instagram:${igsidCustomer1}`);
  assert.notEqual(ext1, ext2);
});

// 7. DUPLICATE MESSAGE ID
test('7. duplicate Meta message ID returns duplicate: true and does not insert second message', async () => {
  let insertCount = 0;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('FROM tenant_channels tc')) return { rowCount: 1, rows: [{ tenant_id: tenantIdA, channel_id: 'c-a', assistant_id: assistantIdA, external_channel_id: pageIdA, channel_type: 'INSTAGRAM', channel_status: 'active', assistant_status: 'active', config: {} }] };
          if (sql.includes('INSERT INTO conversations')) return { rowCount: 1, rows: [{ id: 'conv-101', tenant_id: tenantIdA, channel_id: 'c-a', status: 'open', handling_mode: 'AI', handling_version: 1, customer_external_id: `instagram:${igsidCustomer1}` }] };
          if (sql.includes('SELECT id') && sql.includes('conversation_messages')) return { rowCount: 1, rows: [{ id: 'msg-existing-1' }] };
          if (sql.includes('INSERT INTO conversation_messages')) { insertCount += 1; return { rowCount: 1, rows: [{ id: 'msg-new' }] }; }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };
  const result = await persistInstagramInbound({ database: mockDb, recipientId: pageIdA, senderIgsid: igsidCustomer1, messageId: 'mid.dup.1', content: 'Repeat' });
  assert.equal(result.duplicate, true);
  assert.equal(insertCount, 0);
});

// 8. ECHO MESSAGE DROPPED
test('8. echo message is flagged to prevent AI response loop', () => {
  const parsed = extractInstagramInboundEvents({
    object: 'instagram',
    entry: [{ id: pageIdA, messaging: [{ sender: { id: pageIdA }, recipient: { id: igsidCustomer1 }, timestamp: 1727258400000, message: { mid: 'mid.echo.1', text: 'Our reply', is_echo: true } }] }],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].isEcho, true);
});

// 9. INVALID SIGNATURE REJECTED
test('9. invalid webhook signature is rejected with 401', () => {
  const req = { rawBody: Buffer.from('{"object":"instagram","entry":[]}'), get: () => 'sha256=invalid' };
  let statusCode = null;
  const res = { sendStatus(code) { statusCode = code; return this; } };
  let nextCalled = false;
  verifyWhatsAppSignature(req, res, () => { nextCalled = true; }, 'valid-secret');
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 401);
});

// 10. VALID INSTAGRAM SIGNATURE ACCEPTED
test('10. valid Instagram webhook signature is accepted using INSTAGRAM_APP_SECRET', () => {
  const originalWpSecret = process.env.WHATSAPP_APP_SECRET;
  const originalIgSecret = process.env.INSTAGRAM_APP_SECRET;
  try {
    process.env.WHATSAPP_APP_SECRET = 'wp_different_secret';
    process.env.INSTAGRAM_APP_SECRET = 'ig_secret_456';
    const rawBody = Buffer.from('{"object":"instagram","entry":[]}');
    const signature = `sha256=${createHmac('sha256', 'ig_secret_456').update(rawBody).digest('hex')}`;
    const req = { rawBody, get: (name) => name === 'x-hub-signature-256' ? signature : undefined };
    let statusCode = null;
    const res = { sendStatus(code) { statusCode = code; return this; } };
    let nextCalled = false;
    verifyWhatsAppSignature(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(statusCode, null);
  } finally {
    process.env.WHATSAPP_APP_SECRET = originalWpSecret;
    process.env.INSTAGRAM_APP_SECRET = originalIgSecret;
  }
});

// 11. WHATSAPP WEBHOOK UNCHANGED
test('11. WhatsApp webhook is discriminated and unaffected by Instagram changes', () => {
  const wpPayload = { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [{ value: { messages: [{ from: '15551234', text: { body: 'Hi' } }] } }] }] };
  assert.equal(isWhatsAppWebhookEvent(wpPayload), true);
  assert.equal(isInstagramWebhookEvent(wpPayload), false);
});

// 12. INSTAGRAM CONVERSATIONS FILTER
test('12. isValidChannelType and resolveChannelDashboardRoute support INSTAGRAM', () => {
  assert.equal(isValidChannelType('INSTAGRAM'), true);
  assert.equal(resolveChannelDashboardRoute('INSTAGRAM'), 'instagram');
});

// 13. FIRST-CONTACT HOLD
test('13. first-contact hold keeps AI silent while inbound message is fully persisted', async () => {
  let aiGenerated = false;
  const inboundState = {
    integration: { tenant_id: tenantIdA, channel_id: 'c-a', assistant_id: assistantIdA, external_channel_id: pageIdA, config: { activation_policy: 'MANUAL_ONLY' } },
    conversation: { id: 'conv-101', status: 'open', handling_mode: 'AI', handling_version: 1 },
    shouldInvokeAi: true,
  };
  const outcome = await orchestrateInstagramInboundAiResponse({
    inboundState,
    senderIgsid: igsidCustomer1,
    text: 'Hello new lead',
    generateAiResponse: async () => { aiGenerated = true; return 'AI reply'; },
  });
  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.suppressed, true);
  assert.equal(aiGenerated, false);
});

// 14. AI_ONLY UNANSWERED INBOUND RESPONSE
test('14. AI_ONLY activation response delivers exactly one AI reply for existing unanswered message', async () => {
  const deliveredDMs = [];
  const fakeHttp = {
    async post(url, body) {
      deliveredDMs.push(body);
      return { data: { recipient_id: igsidCustomer1, message_id: 'mid.ai.201' } };
    },
  };
  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM ai_assistants')) return { rows: [{ id: assistantIdA, name: 'Assistant', system_prompt: 'Help customers.' }] };
      if (sql.includes('FROM conversations')) return { rows: [{ id: 'conv-101', tenant_id: tenantIdA, channel_id: 'c-a', handling_mode: 'AI', handling_version: 1, status: 'open' }] };
      if (sql.includes('INSERT INTO conversation_messages')) return { rows: [{ id: 'msg-ai-1', sender_type: 'ASSISTANT', content: 'Our rates start at $50/hour.' }] };
      return { rows: [] };
    },
    async connect() { return this; },
    release() {},
  };
  const inboundState = {
    integration: { tenant_id: tenantIdA, channel_id: 'c-a', assistant_id: assistantIdA, external_channel_id: pageIdA, config: { access_token: 'token-a', page_id: pageIdA, activation_policy: 'ALL_MESSAGES' } },
    conversation: { id: 'conv-101', status: 'open', handling_mode: 'AI', handling_version: 1, communication_language: 'en' },
    shouldInvokeAi: true,
    handlingVersion: 1,
  };
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: igsidCustomer1,
    text: 'What are your rates?',
    http: fakeHttp,
    generateAiResponse: async () => 'Our rates start at $50/hour.',
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.responseText, 'Our rates start at $50/hour.');
  assert.equal(deliveredDMs.length, 1);
});

// 15. PUSH PIPELINE ELIGIBILITY
test('15. inbound Instagram message with human support request triggers handoff and push notification eligibility', async () => {
  const deliveredAcks = [];
  const mockDb = {
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('FROM conversations')) {
        return {
          rows: [{
            id: 'conv-101',
            tenant_id: tenantIdA,
            channel_id: 'c-a',
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
      if (sql.includes('INSERT INTO human_support_escalations')) return { rows: [{ id: 'esc-1' }] };
      if (sql.includes('INSERT INTO conversation_messages')) return { rows: [{ id: 'msg-ack' }] };
      if (sql.includes('UPDATE conversations')) {
        return {
          rows: [{
            id: 'conv-101',
            tenant_id: tenantIdA,
            channel_id: 'c-a',
            status: 'open',
            handling_mode: 'HUMAN',
            human_attention_state: 'REQUESTED',
            handling_version: 2,
          }],
        };
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
      tenant_id: tenantIdA,
      channel_id: 'c-a',
      assistant_id: assistantIdA,
      external_channel_id: pageIdA,
      config: { access_token: 'token-a', page_id: pageIdA },
    },
    conversation: {
      id: 'conv-101',
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
    senderIgsid: igsidCustomer1,
    text: 'I want to talk to a human agent please',
    http: fakeHttp,
  });
  assert.equal(outcome.handoff, true);
  assert.equal(deliveredAcks.length, 1);
});

// 16. TEST A: business/webhook ID != /me user ID, real webhook recipient uses business ID -> correct tenant resolves
test('16. TEST A: business/webhook ID distinct from user-scoped ID resolves to owning tenant', async () => {
  const businessId = '17841400000000099';
  const userId = '39251538000000099';

  const mockDb = {
    async query(sql, params) {
      if (params[0] === businessId || params[0] === userId) {
        return {
          rowCount: 1,
          rows: [{
            tenant_id: tenantIdA,
            channel_id: 'chan-a',
            assistant_id: assistantIdA,
            external_channel_id: businessId,
            channel_type: 'INSTAGRAM',
            channel_status: 'active',
            assistant_status: 'active',
            config: {
              instagram_business_account_id: businessId,
              instagram_user_id: userId,
              instagram_account_id: businessId,
              page_id: businessId,
            },
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const resolved = await resolveInstagramIntegration(mockDb, businessId);
  assert.ok(resolved);
  assert.equal(resolved.tenant_id, tenantIdA);
  assert.equal(resolved.config.instagram_business_account_id, businessId);
  assert.equal(resolved.config.instagram_user_id, userId);
});

// 17. TEST B & G: /me convergence preserves distinct business ID and user ID
test('17. TEST B & G: convergence preserves business account ID while enriching user-scoped ID', async () => {
  const { convergeTenantInstagramChannels } = await import('../services/tenant-instagram-provisioning-service.js');
  const businessId = '17841400000000099';
  const userId = '39251538000000099';
  let savedExternalId = null;
  let savedConfig = null;

  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: 'chan-a',
                tenant_id: tenantIdA,
                external_channel_id: businessId,
                assistant_id: assistantIdA,
                channel_status: 'active',
                integration_config: {
                  access_token: 'valid-token',
                  instagram_business_account_id: businessId,
                  page_id: businessId,
                },
              }],
            };
          }
          if (sql.includes('UPDATE tenant_channels SET external_channel_id')) {
            savedExternalId = params[0];
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes('UPDATE channel_integrations SET config')) {
            savedConfig = JSON.parse(params[0]);
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const fakeHttp = {
    async get(url) {
      if (url.includes('/me')) {
        return { data: { id: userId, username: 'testuser' } };
      }
      return { data: {} };
    },
    async post() { return { data: { success: true } }; },
  };

  await convergeTenantInstagramChannels({ database: mockDb, http: fakeHttp });

  assert.equal(savedExternalId, businessId);
  assert.equal(savedConfig.instagram_business_account_id, businessId);
  assert.equal(savedConfig.instagram_user_id, userId);
});

// 18. TEST C: webhook uses user-scoped ID where Meta legitimately supplies it -> resolves
test('18. TEST C: webhook using user-scoped ID resolves to owning tenant', async () => {
  const businessId = '17841400000000099';
  const userId = '39251538000000099';

  const mockDb = {
    async query(sql, params) {
      if (params[0] === userId) {
        return {
          rowCount: 1,
          rows: [{
            tenant_id: tenantIdA,
            channel_id: 'chan-a',
            assistant_id: assistantIdA,
            external_channel_id: businessId,
            channel_type: 'INSTAGRAM',
            channel_status: 'active',
            config: {
              instagram_business_account_id: businessId,
              instagram_user_id: userId,
            },
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const resolved = await resolveInstagramIntegration(mockDb, userId);
  assert.ok(resolved);
  assert.equal(resolved.tenant_id, tenantIdA);
});

// 19. TEST D: MANUAL_ONLY + no initially assigned assistant -> inbound persists
test('19. TEST D: channel with NULL assistant_id resolves and persists message in MANUAL_ONLY', async () => {
  const businessId = '17841400000000099';
  let messageSaved = false;

  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                tenant_id: tenantIdA,
                channel_id: 'chan-a',
                assistant_id: null,
                external_channel_id: businessId,
                channel_type: 'INSTAGRAM',
                channel_status: 'active',
                assistant_status: null,
                config: { instagram_business_account_id: businessId, activation_policy: 'MANUAL_ONLY' },
              }],
            };
          }
          if (sql.includes('INSERT INTO conversations')) {
            return {
              rowCount: 1,
              rows: [{
                id: 'conv-101',
                tenant_id: tenantIdA,
                channel_id: 'chan-a',
                status: 'open',
                handling_mode: 'AI',
                handling_version: 1,
                customer_external_id: `instagram:${igsidCustomer1}`,
              }],
            };
          }
          if (sql.includes('INSERT INTO conversation_messages')) {
            messageSaved = true;
            return { rowCount: 1, rows: [{ id: 'msg-1', content: params[2] }] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const result = await persistInstagramInbound({
    database: mockDb,
    recipientId: businessId,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.noassistant.1',
    content: 'Hello without assistant',
  });

  assert.equal(result.duplicate, false);
  assert.equal(messageSaved, true);
});

// 20. TEST F: ambiguous duplicate provider identifier across tenants -> fail closed
test('20. TEST F: duplicate recipient across two tenants fails closed with null', async () => {
  const businessId = '17841400000000099';

  const mockDb = {
    async query(sql, params) {
      if (params[0] === businessId) {
        return {
          rowCount: 2,
          rows: [
            { tenant_id: tenantIdA, channel_id: 'chan-a' },
            { tenant_id: tenantIdB, channel_id: 'chan-b' },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const resolved = await resolveInstagramIntegration(mockDb, businessId);
  assert.equal(resolved, null);
});


