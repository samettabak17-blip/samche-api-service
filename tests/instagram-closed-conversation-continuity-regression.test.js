process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  persistInstagramInbound,
  instagramExternalConversationId,
  instagramCustomerReference,
} from '../services/instagram-live-inbox-service.js';
import {
  orchestrateInstagramInboundAiResponse,
} from '../services/instagram-ai-orchestrator.js';

const tenantId = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';
const pageId = '17841400290566553';
const channelId = '4603b0a1-c98d-4ea3-8a9c-109fa0cf5aa4';
const customerIgsid = '797284549839918';
const assistantId = '33333333-3333-4333-8333-333333333333';

function createClosedConversationMockDb({ initialStatus = 'closed', initialHandlingMode = 'AI', initialOverride = 'AI_ONLY' } = {}) {
  const extConvId = instagramExternalConversationId(customerIgsid);
  const custRef = instagramCustomerReference(customerIgsid);
  const convKey = `${channelId}:${extConvId}`;

  const store = {
    conversations: new Map([
      [convKey, {
        id: 'conv-50bd88e3',
        tenant_id: tenantId,
        channel_id: channelId,
        external_conversation_id: extConvId,
        customer_external_id: custRef,
        status: initialStatus,
        handling_mode: initialHandlingMode,
        handling_version: 1,
        ai_behavior_override: initialOverride,
        contact_id: 'contact-2be407e2',
        assigned_agent_user_id: initialHandlingMode === 'HUMAN' ? 'agent-1' : null,
        human_attention_state: 'NONE',
      }],
    ]),
    contacts: new Map([
      ['contact-2be407e2', {
        id: 'contact-2be407e2',
        tenant_id: tenantId,
        display_name: 'SamChe Travel Agency (@samchetravel)',
        ai_behavior_override: initialOverride,
        source: 'INSTAGRAM',
      }],
    ]),
    messages: new Map(),
  };

  const client = {
    release() {},
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('SAVEPOINT') || sql.includes('RELEASE SAVEPOINT')) return {};

      if (sql.includes('FROM tenant_channels tc')) {
        return {
          rowCount: 1,
          rows: [{
            tenant_id: tenantId,
            channel_id: channelId,
            assistant_id: assistantId,
            external_channel_id: pageId,
            channel_type: 'INSTAGRAM',
            channel_status: 'active',
            assistant_status: 'active',
            config: {
              access_token: 'valid_test_token',
              page_id: pageId,
              instagram_account_id: pageId,
              instagram_business_account_id: pageId,
              activation_policy: 'MANUAL_ONLY',
              auth_mode: 'FACEBOOK_LOGIN',
            },
          }],
        };
      }

      if (sql.includes('INSERT INTO conversations')) {
        const extId = params[2];
        const key = `${channelId}:${extId}`;
        let conv = store.conversations.get(key);
        if (!conv) {
          conv = {
            id: `conv-${store.conversations.size + 1}`,
            tenant_id: params[0],
            channel_id: params[1],
            external_conversation_id: extId,
            customer_external_id: params[3],
            status: 'open',
            handling_mode: 'AI',
            handling_version: 1,
            ai_behavior_override: 'AI_ONLY',
            contact_id: null,
          };
          store.conversations.set(key, conv);
        } else {
          if (sql.includes("status = 'open'")) {
            conv.status = 'open';
            if (conv.handling_mode !== 'AI' && initialStatus !== 'open') {
              conv.handling_mode = 'AI';
            }
          }
        }
        return { rowCount: 1, rows: [{ ...conv }] };
      }

      if (sql.includes('FROM conversations') && sql.includes('JOIN tenant_channels tc')) {
        const conv = Array.from(store.conversations.values())[0];
        return {
          rowCount: 1,
          rows: [{
            ...conv,
            channel_type: 'INSTAGRAM',
            external_channel_id: pageId,
            assistant_id: assistantId,
            assistant_model: 'gemini-2.0-flash',
            integration_config: {
              access_token: 'valid_test_token',
              page_id: pageId,
              instagram_account_id: pageId,
              activation_policy: 'MANUAL_ONLY',
            },
          }],
        };
      }

      if (sql.includes('FROM conversations') && sql.includes('WHERE id = $1')) {
        const conv = Array.from(store.conversations.values()).find((c) => c.id === params[0]);
        return conv ? { rowCount: 1, rows: [{ ...conv }] } : { rowCount: 0, rows: [] };
      }

      if (sql.includes('FROM conversations') && sql.includes('LEFT JOIN crm_contacts c')) {
        const conv = Array.from(store.conversations.values())[0];
        const contact = store.contacts.get(conv.contact_id);
        return {
          rowCount: 1,
          rows: [{
            contact_override: contact?.ai_behavior_override || null,
            conv_override: conv.ai_behavior_override || null,
          }],
        };
      }

      if (sql.includes('UPDATE conversations')) {
        const conv = Array.from(store.conversations.values())[0];
        if (sql.includes("status = 'open'")) {
          conv.status = 'open';
          if (sql.includes("WHEN handling_mode != 'AI' THEN 'AI'") || sql.includes("handling_mode = 'AI'")) {
            conv.handling_mode = 'AI';
          }
        }
        if (sql.includes("ai_behavior_override = 'AI_ONLY'")) {
          conv.ai_behavior_override = 'AI_ONLY';
        }
        return { rowCount: 1, rows: [{ ...conv }] };
      }

      if (sql.includes('INSERT INTO crm_contacts')) {
        const contact = Array.from(store.contacts.values())[0];
        return { rowCount: 1, rows: [{ ...contact }] };
      }

      if (sql.includes('SELECT count(*)::int AS count FROM conversation_messages')) {
        return { rowCount: 1, rows: [{ count: store.messages.size }] };
      }

      if (sql.includes('INSERT INTO conversation_messages')) {
        const isAssistant = sql.includes('ASSISTANT') || params[2] === 'ASSISTANT';
        const senderType = isAssistant ? 'ASSISTANT' : 'CUSTOMER';
        const content = params[3];
        const idempotencyKey = isAssistant ? params[5] : null;
        const extMid = isAssistant ? params[6] : params[3];
        const msg = {
          id: `msg-${store.messages.size + 1}`,
          tenant_id: params[0],
          conversation_id: params[1],
          sender_type: senderType,
          content,
          idempotency_key: idempotencyKey,
          external_message_id: extMid,
        };
        store.messages.set(msg.id, msg);
        return { rowCount: 1, rows: [msg] };
      }

      if (sql.includes('FROM conversation_messages')) {
        let list = Array.from(store.messages.values());
        if (sql.includes('idempotency_key = $3') || sql.includes('idempotency_key = $1')) {
          const key = params[2] || params[0];
          list = list.filter((m) => m.idempotency_key === key);
        } else if (sql.includes('external_message_id = $3') || sql.includes('external_message_id = $1')) {
          const extId = params[2] || params[0];
          list = list.filter((m) => m.external_message_id === extId);
        } else if (sql.includes("sender_type = 'CUSTOMER'")) {
          const convId = params[1] || params[0];
          list = list.filter((m) => m.conversation_id === convId && m.sender_type === 'CUSTOMER');
        } else if (sql.includes("sender_type = 'ASSISTANT'")) {
          const convId = params[1] || params[0];
          list = list.filter((m) => m.conversation_id === convId && m.sender_type === 'ASSISTANT');
        } else {
          const convId = params[1] || params[0];
          list = list.filter((m) => m.conversation_id === convId);
          if (sql.includes('ORDER BY created_at DESC') || sql.includes('LIMIT 1')) {
            list.reverse();
          }
        }
        return { rowCount: list.length, rows: list };
      }

      if (sql.includes('knowledge_authority_version') || sql.includes('ai_assistants')) {
        return { rowCount: 1, rows: [{ assistant_id: assistantId, knowledge_authority_version: 1n }] };
      }

      if (sql.includes('UPDATE conversation_messages')) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('INSERT INTO conversation_resources') || sql.includes('SELECT pg_notify') || sql.includes('SELECT id FROM crm_pipeline_stages') || sql.includes('INSERT INTO crm_leads') || sql.includes('INSERT INTO crm_activities')) {
        return { rowCount: 1, rows: [{ id: 'res-1' }] };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  return { store, client, connect: async () => client };
}

// ============================================================================
// TEST 1: PHYSICAL REPRODUCTION OF FAILING REAL CONVERSATION
// ============================================================================
test('EXACT PHYSICAL REPRODUCTION: Closed conversation reopens on customer inbound and receives AI response', async () => {
  const mockDb = createClosedConversationMockDb({
    initialStatus: 'closed',
    initialHandlingMode: 'AI',
    initialOverride: 'AI_ONLY',
  });

  const failingCustomerText = 'Merhaba Samed bey. Nasılsınız ?Ailem ve ben Dubaiye yerleşmek istiyoruz . 3 kişiyiz . Yaşam giderleri ve kiralar konusunda nasıl bir bütçe ayırmalıyız ?';
  const newMid = 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDAwMjkwNTY2NTUzOjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI1OTk4MTgyNjI2NDQ2ODAxMDozMzA0NDE0NDM3NTU1NDEyMDcxOTU0OTc0OTk0ODA1NTU1MgZDZD';

  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageId,
    senderIgsid: customerIgsid,
    messageId: newMid,
    content: failingCustomerText,
  });

  // Verify physical invariants
  assert.equal(inboundState.duplicate, false, 'New legitimate MID must not be flagged as duplicate');
  assert.equal(inboundState.conversation.status, 'open', 'Conversation must transition from closed to open on live customer message');
  assert.equal(inboundState.shouldInvokeAi, true, 'shouldInvokeAi must be true for open AI-mode conversation');

  const delivered = [];
  const fakeHttp = {
    post: async (_url, payload) => {
      delivered.push(payload);
      return { status: 200, data: { message_id: 'mid.out.ai.1' } };
    },
    get: async () => ({ status: 200, data: {} }),
  };

  let providerCalled = false;
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: customerIgsid,
    text: failingCustomerText,
    http: fakeHttp,
    generateAiResponse: async () => {
      providerCalled = true;
      return 'Dubai\'ye hoş geldiniz! 3 kişilik bir aile için ortalama yaşam giderleri ve kira bütçesi konusunda danışmanlık sağlayabilirim.';
    },
    applyPacing: false,
  });

  assert.equal(providerCalled, true, 'AI provider MUST be called for eligible live customer inbound');
  assert.equal(outcome.aiInvoked, true, 'AI must be invoked');
  assert.equal(outcome.delivered, true, 'Canonical response must be delivered to customer');

  // Verify assistant message is persisted
  const assistantMsgs = Array.from(mockDb.store.messages.values()).filter((m) => m.sender_type === 'ASSISTANT');
  assert.equal(assistantMsgs.length, 1, 'Assistant message must be persisted in database');
});

// ============================================================================
// TEST 2: SAME TEXT / DIFFERENT MID TEST (Section 23)
// ============================================================================
test('SAME TEXT / DIFFERENT MID: Identical text with different MIDs executes two AI turns, replay is suppressed', async () => {
  const mockDb = createClosedConversationMockDb({
    initialStatus: 'closed',
    initialHandlingMode: 'AI',
    initialOverride: 'AI_ONLY',
  });

  const text = 'Merhaba Samed bey, Dubai hakkında bilgi alabilir miyim?';
  const mid1 = 'mid_turn_1';
  const mid2 = 'mid_turn_2';

  const delivered = [];
  const fakeHttp = {
    post: async (_url, payload) => {
      delivered.push(payload);
      return { status: 200, data: { message_id: `out_${delivered.length}` } };
    },
    get: async () => ({ status: 200, data: {} }),
  };

  // Turn 1: MID 1
  const inbound1 = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageId,
    senderIgsid: customerIgsid,
    messageId: mid1,
    content: text,
  });
  assert.equal(inbound1.duplicate, false);
  assert.equal(inbound1.shouldInvokeAi, true);

  let providerCalls = 0;
  const outcome1 = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState: inbound1,
    senderIgsid: customerIgsid,
    text,
    http: fakeHttp,
    generateAiResponse: async () => {
      providerCalls++;
      return 'Merhaba! Dubai şirket ve oturum süreçlerinde yardımcı olabilirim.';
    },
    applyPacing: false,
  });
  assert.equal(outcome1.aiInvoked, true);
  assert.equal(providerCalls, 1);

  // Turn 2: MID 2 with EXACT SAME TEXT
  const inbound2 = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageId,
    senderIgsid: customerIgsid,
    messageId: mid2,
    content: text,
  });
  assert.equal(inbound2.duplicate, false, 'Different MID with same text must NOT be duplicate');
  assert.equal(inbound2.shouldInvokeAi, true);

  const outcome2 = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState: inbound2,
    senderIgsid: customerIgsid,
    text,
    http: fakeHttp,
    generateAiResponse: async () => {
      providerCalls++;
      return 'Tekrar merhaba! Size nasıl yardımcı olabilirim?';
    },
    applyPacing: false,
  });
  assert.equal(outcome2.aiInvoked, true);
  assert.equal(providerCalls, 2, 'Different MID must call AI provider again even with identical text');

  // Replay Turn: MID 1 replay
  const replayInbound = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageId,
    senderIgsid: customerIgsid,
    messageId: mid1,
    content: text,
  });
  assert.equal(replayInbound.duplicate, true, 'Same MID replay must be suppressed as duplicate');
  assert.equal(replayInbound.shouldInvokeAi, false);
});


// ============================================================================
// TEST 3: HISTORICAL REEL CONVERSATION / NEW LIVE EVENT TEST (Section 24)
// ============================================================================
test('HISTORICAL REEL CONVERSATION: Historical Reel + closed state + new text MID reopens and invokes AI', async () => {
  const mockDb = createClosedConversationMockDb({
    initialStatus: 'closed',
    initialHandlingMode: 'AI',
    initialOverride: 'AI_ONLY',
  });

  // Simulate historical Reel message in store
  mockDb.store.messages.set('msg-historical-reel', {
    id: 'msg-historical-reel',
    tenant_id: tenantId,
    conversation_id: 'conv-50bd88e3',
    sender_type: 'CUSTOMER',
    content: '[Attachment: reel]',
    external_message_id: 'mid_historical_reel_1',
  });

  const newLiveText = 'Fiyatlar hakkında detay verebilir misiniz?';
  const newLiveMid = 'mid_live_text_after_reel_99';

  const inbound = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageId,
    senderIgsid: customerIgsid,
    messageId: newLiveMid,
    content: newLiveText,
  });

  assert.equal(inbound.conversation.status, 'open', 'Closed historical conversation must reopen');
  assert.equal(inbound.shouldInvokeAi, true, 'New live event after Reel history is not passive');

  let providerCalled = false;
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState: inbound,
    senderIgsid: customerIgsid,
    text: newLiveText,
    http: {
      post: async () => ({ status: 200, data: { message_id: 'out_live_1' } }),
      get: async () => ({ status: 200, data: {} }),
    },
    generateAiResponse: async () => {
      providerCalled = true;
      return 'Dubai paket fiyatlarımız hakkında bilgi vermekten memnuniyet duyarım.';
    },
    applyPacing: false,
  });

  assert.equal(providerCalled, true, 'AI provider must be called on new live event after Reel');
  assert.equal(outcome.aiInvoked, true);
  assert.equal(outcome.delivered, true);
});

// ============================================================================
// TEST 4: HUMAN TAKEOVER ON OPEN CONVERSATION PRESERVED (Section 25)
// ============================================================================
test('HUMAN TAKEOVER PROTECTION: Active open human handling suppresses AI', async () => {
  const mockDb = createClosedConversationMockDb({
    initialStatus: 'open',
    initialHandlingMode: 'HUMAN',
    initialOverride: 'AI_ONLY',
  });

  const inbound = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageId,
    senderIgsid: customerIgsid,
    messageId: 'mid_human_turn_1',
    content: 'Temsilciye sorum var',
  });

  assert.equal(inbound.conversation.handling_mode, 'HUMAN', 'Open conversation handling_mode must remain HUMAN');
  assert.equal(inbound.shouldInvokeAi, false, 'AI must be suppressed during active human takeover');

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState: inbound,
    senderIgsid: customerIgsid,
    text: 'Temsilciye sorum var',
    applyPacing: false,
  });

  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.reason, 'NOT_IN_AI_MODE');
});

// ============================================================================
// TEST 5: NEVER_AI PRESERVED ON REOPENED CONVERSATION (Section 13 & 25)
// ============================================================================
test('NEVER_AI PERSISTENCE: Explicit NEVER_AI is strictly preserved when conversation reopens', async () => {
  const mockDb = createClosedConversationMockDb({
    initialStatus: 'closed',
    initialHandlingMode: 'AI',
    initialOverride: 'NEVER_AI',
  });

  const inbound = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageId,
    senderIgsid: customerIgsid,
    messageId: 'mid_never_ai_1',
    content: 'Merhaba',
  });

  // Status reopens, but override is NEVER_AI
  assert.equal(inbound.conversation.status, 'open');
  assert.equal(inbound.conversation.ai_behavior_override, 'NEVER_AI');

  let providerCalled = false;
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState: inbound,
    senderIgsid: customerIgsid,
    text: 'Merhaba',
    generateAiResponse: async () => {
      providerCalled = true;
      return 'AI message';
    },
    applyPacing: false,
  });

  assert.equal(providerCalled, false, 'AI provider MUST NOT be called for NEVER_AI');
  assert.equal(outcome.aiInvoked, false);
});

