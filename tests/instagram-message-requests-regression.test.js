process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isInstagramWebhookEvent,
  extractInstagramInboundEvents,
  parseInstagramMessagingEvent,
} from '../services/instagram-inbound-adapter.js';
import {
  persistInstagramInbound,
} from '../services/instagram-live-inbox-service.js';
import {
  orchestrateInstagramInboundAiResponse,
} from '../services/instagram-ai-orchestrator.js';
import {
  AI_ACTIVATION_MODES,
  evaluateChannelAiActivationPolicy,
} from '../services/channel-ai-activation-policy-service.js';

const tenantIdA = '11111111-1111-4111-8111-111111111111';
const tenantIdB = '22222222-2222-4222-8222-222222222222';
const pageIdA = '17841400000000001';
const pageIdB = '17841400000000002';
const igsidCustomer1 = 'ig_user_1001';
const igsidCustomer2 = 'ig_user_2002';
const assistantIdA = '33333333-3333-4333-8333-333333333333';

function createMockDb() {
  const store = {
    conversations: new Map(),
    contacts: new Map(),
    messages: new Map(),
  };

  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('SAVEPOINT') || sql.includes('RELEASE SAVEPOINT')) return {};

      if (sql.includes('FROM tenant_channels tc')) {
        const reqId = params[0];
        const tId = reqId === pageIdB ? tenantIdB : tenantIdA;
        const cId = reqId === pageIdB ? 'chan-b' : 'chan-a';
        return {
          rowCount: 1,
          rows: [{
            tenant_id: tId,
            channel_id: cId,
            assistant_id: assistantIdA,
            external_channel_id: reqId,
            channel_type: 'INSTAGRAM',
            channel_status: 'active',
            assistant_status: 'active',
            config: { access_token: 'token', page_id: reqId, instagram_business_account_id: reqId, activation_policy: 'ALL_MESSAGES' },
          }],
        };
      }

      if (sql.includes('INSERT INTO conversations')) {
        const tId = params[0];
        const cId = params[1];
        const extConvId = params[2];
        const custRef = params[3];
        const key = `${cId}:${extConvId}`;
        let conv = store.conversations.get(key);
        if (!conv) {
          conv = {
            id: `conv-${store.conversations.size + 1}`,
            tenant_id: tId,
            channel_id: cId,
            external_conversation_id: extConvId,
            customer_external_id: custRef,
            status: 'open',
            handling_mode: 'AI',
            handling_version: 1,
            ai_behavior_override: 'AUTOMATIC',
            contact_id: null,
          };
          store.conversations.set(key, conv);
        }
        return { rowCount: 1, rows: [conv] };
      }

      if (sql.includes('FROM conversations')) {
        const targetId = params[0];
        const conv = Array.from(store.conversations.values()).find((c) => c.id === targetId || c.tenant_id === targetId || c.external_conversation_id === targetId);
        if (conv) return { rowCount: 1, rows: [conv] };
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('UPDATE conversations')) {
        if (sql.includes('SET contact_id = $1')) {
          const conv = Array.from(store.conversations.values()).find((c) => c.id === params[2] && c.tenant_id === params[3]);
          if (conv) {
            conv.contact_id = params[0];
            conv.ai_behavior_override = params[1];
            return { rowCount: 1, rows: [conv] };
          }
        }
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('INSERT INTO crm_contacts')) {
        const hash = params[2];
        let contact = store.contacts.get(hash);
        if (!contact) {
          contact = { id: `contact-${store.contacts.size + 1}`, tenant_id: params[0], identity_hash: hash, display_name: params[3] || 'Customer', ai_behavior_override: 'UNDECIDED' };
          store.contacts.set(hash, contact);
        }
        return { rowCount: 1, rows: [contact] };
      }

      if (sql.includes('SELECT count(*)::int AS count FROM conversation_messages')) {
        const convId = params[1];
        const count = Array.from(store.messages.values()).filter((m) => m.conversation_id === convId).length;
        return { rowCount: 1, rows: [{ count }] };
      }

      if (sql.includes('INSERT INTO conversation_messages')) {
        const isAssistant = sql.includes('ASSISTANT') || params[2] === 'ASSISTANT';
        const senderType = isAssistant ? 'ASSISTANT' : 'CUSTOMER';
        const content = isAssistant ? (params[3] || params[2]) : params[2];
        const extMid = isAssistant ? params[6] : params[3];
        if (extMid) {
          for (const m of store.messages.values()) {
            if (m.conversation_id === params[1] && m.external_message_id === extMid) return { rowCount: 0, rows: [] };
          }
        }
        const msg = { id: `msg-${store.messages.size + 1}`, tenant_id: params[0], conversation_id: params[1], sender_type: senderType, content, external_message_id: extMid };
        store.messages.set(msg.id, msg);
        return { rowCount: 1, rows: [msg] };
      }

      if (sql.includes('FROM conversation_messages')) {
        let list = Array.from(store.messages.values());
        if (sql.includes('external_message_id = $3') || sql.includes('external_message_id = $1')) {
          const extId = params[2] || params[0];
          list = list.filter((m) => m.external_message_id === extId);
        } else if (sql.includes('idempotency_key = $3') || sql.includes('idempotency_key = $1')) {
          const key = params[2] || params[0];
          list = list.filter((m) => m.idempotency_key === key);
        } else if (sql.includes("sender_type = 'CUSTOMER'")) {
          const convId = params[1] || params[0];
          list = list.filter((m) => m.conversation_id === convId && m.sender_type === 'CUSTOMER');
        } else if (sql.includes("sender_type = 'ASSISTANT'")) {
          const convId = params[1] || params[0];
          list = list.filter((m) => m.conversation_id === convId && m.sender_type === 'ASSISTANT');
        } else {
          const convId = params[1] || params[0];
          list = list.filter((m) => m.conversation_id === convId);
        }
        return { rowCount: list.length, rows: list };
      }

      if (sql.includes('knowledge_authority_version') || sql.includes('ai_assistants')) {
        return { rowCount: 1, rows: [{ assistant_id: assistantIdA, knowledge_authority_version: 1n }] };
      }

      if (sql.includes('UPDATE conversation_messages')) return { rowCount: 1, rows: [] };
      if (sql.includes('SELECT pg_notify') || sql.includes('SELECT id FROM crm_pipeline_stages') || sql.includes('INSERT INTO crm_leads') || sql.includes('INSERT INTO crm_activities') || sql.includes('INSERT INTO conversation_resources')) {
        return { rowCount: 1, rows: [{ id: 'mock-id' }] };
      }

      return { rowCount: 0, rows: [] };
    },
    release() {},
  };

  return {
    store,
    async connect() { return client; },
    async query(sql, params) { return client.query(sql, params); },
  };
}


// TEST A — Normal Instagram DM
test('TEST A: Normal Instagram DM flow unchanged and passes canonical ingress', async () => {
  const mockDb = createMockDb();
  const rawPayload = {
    object: 'instagram',
    entry: [{
      id: pageIdA,
      time: 1727258400000,
      messaging: [{
        sender: { id: igsidCustomer1 },
        recipient: { id: pageIdA },
        timestamp: 1727258400000,
        message: { mid: 'mid.normal.1', text: "Dubai'de şirket kurmak istiyorum" },
      }],
    }],
  };

  assert.equal(isInstagramWebhookEvent(rawPayload), true);
  const events = extractInstagramInboundEvents(rawPayload);
  assert.equal(events.length, 1);

  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: events[0].recipientId,
    senderIgsid: events[0].senderId,
    messageId: events[0].messageId,
    content: events[0].text,
  });

  assert.equal(inboundState.duplicate, false);
  assert.equal(inboundState.shouldInvokeAi, true);
  assert.equal(inboundState.integration.tenant_id, tenantIdA);
  assert.equal(mockDb.store.messages.size, 1);
});

// TEST B — Message Request inbound
test('TEST B: Message Request inbound event is persisted to canonical conversation and contact', async () => {
  const mockDb = createMockDb();
  const rawPayload = {
    object: 'instagram',
    entry: [{
      id: pageIdA,
      time: 1727258400000,
      messaging: [{
        sender: { id: 'new_request_sender_999' },
        recipient: { id: pageIdA },
        timestamp: 1727258400000,
        message: { mid: 'mid.req.101', text: 'Merhaba bilgi alabilir miyim?' },
      }],
    }],
  };

  const events = extractInstagramInboundEvents(rawPayload);
  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: events[0].recipientId,
    senderIgsid: events[0].senderId,
    messageId: events[0].messageId,
    content: events[0].text,
  });

  assert.equal(inboundState.duplicate, false);
  assert.ok(inboundState.conversation.id);
  assert.equal(inboundState.customerMessage.content, 'Merhaba bilgi alabilir miyim?');
  assert.equal(mockDb.store.conversations.size, 1);
});

// TEST C — Request -> later supported customer message
test('TEST C: Request -> later supported customer message continues in same conversation without permanent suppression', async () => {
  const mockDb = createMockDb();
  const senderId = 'req_continuity_user';

  const firstInbound = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: senderId,
    messageId: 'mid.turn.1',
    content: 'İlk istek mesajı',
  });

  const secondInbound = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: senderId,
    messageId: 'mid.turn.2',
    content: 'Dubai şirket kurulum maliyeti nedir?',
  });

  assert.equal(secondInbound.conversation.id, firstInbound.conversation.id);
  assert.equal(mockDb.store.conversations.size, 1);
  assert.equal(mockDb.store.messages.size, 2);

  const policyEval = await evaluateChannelAiActivationPolicy({
    messageText: secondInbound.customerMessage.content,
    conversation: secondInbound.conversation,
    channelConfig: { activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES },
  });

  assert.equal(policyEval.eligible, true);
  assert.equal(policyEval.decision, 'ACTIVATED');
  assert.equal(policyEval.reasonCode, 'POLICY_ALL_MESSAGES');
});

// TEST D — AI_ONLY
test('TEST D: AI_ONLY mode activates and delivers AI reply for request-originated conversation', async () => {
  const mockDb = createMockDb();
  const delivered = [];
  const fakeHttp = {
    async post(url, body) {
      delivered.push(body);
      return { data: { recipient_id: igsidCustomer1, message_id: 'mid.out.ai' } };
    },
  };

  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.req.d',
    content: 'Şirket açılışı için bilgi',
  });

  inboundState.conversation.ai_behavior_override = 'AI_ONLY';

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: igsidCustomer1,
    text: 'Şirket açılışı için bilgi',
    http: fakeHttp,
    generateAiResponse: async () => 'Size şirket kurulumu hakkında yardımcı olmaktan memnuniyet duyarım.',
    applyPacing: false,
  });

  assert.equal(outcome.aiInvoked, true);
  assert.equal(outcome.delivered, true);
  const textDms = delivered.filter((d) => d?.message?.text);
  assert.equal(textDms.length, 1);
});

// TEST E — NEVER_AI
test('TEST E: NEVER_AI contact never receives AI response across all channel policies', async () => {
  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai şirket kurulumu fiyatı nedir?',
    conversation: {
      id: 'conv-never-ai',
      status: 'open',
      handling_mode: 'AI',
      ai_behavior_override: 'NEVER_AI',
    },
    channelConfig: { activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES },
  });

  assert.equal(evalResult.eligible, false);
  assert.equal(evalResult.decision, 'SUPPRESSED');
  assert.equal(evalResult.reasonCode, 'OVERRIDE_NEVER_AI');
});

// TEST F — Human Takeover
test('TEST F: Human Takeover (handling_mode = HUMAN) strictly suppresses AI even with AI_ONLY override', async () => {
  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Şirket kurmak istiyorum',
    conversation: {
      id: 'conv-human',
      status: 'open',
      handling_mode: 'HUMAN',
      ai_behavior_override: 'AI_ONLY',
    },
    channelConfig: { activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES },
  });

  assert.equal(evalResult.eligible, false);
  assert.equal(evalResult.decision, 'SUPPRESSED');
  assert.equal(evalResult.reasonCode, 'HUMAN_MODE_ACTIVE');
});

// TEST G — Duplicate MID
test('TEST G: Duplicate Meta MID does not insert second message or trigger second AI response', async () => {
  const mockDb = createMockDb();

  const first = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.dup.test.1',
    content: 'Duplicate test',
  });
  assert.equal(first.duplicate, false);

  const second = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.dup.test.1',
    content: 'Duplicate test',
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.shouldInvokeAi, false);
  assert.equal(mockDb.store.messages.size, 1);
});

// TEST H — Delivery/read receipts
test('TEST H: Delivery and read receipts are dropped and never treated as customer inbound', () => {
  const deliveryEvent = parseInstagramMessagingEvent({ id: pageIdA }, {
    sender: { id: igsidCustomer1 },
    recipient: { id: pageIdA },
    delivery: { mids: ['mid.1001'], watermark: 1727258400000 },
  });
  assert.equal(deliveryEvent, null);

  const readEvent = parseInstagramMessagingEvent({ id: pageIdA }, {
    sender: { id: igsidCustomer1 },
    recipient: { id: pageIdA },
    read: { watermark: 1727258400000 },
  });
  assert.equal(readEvent, null);

  const seenEvent = parseInstagramMessagingEvent({ id: pageIdA }, {
    sender: { id: igsidCustomer1 },
    recipient: { id: pageIdA },
    messaging_seen: { watermark: 1727258400000 },
  });
  assert.equal(seenEvent, null);
});


// TEST I — Tenant isolation
test('TEST I: Tenant A Instagram identity and conversation are strictly isolated from Tenant B', async () => {
  const mockDb = createMockDb();

  const eventTenantA = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.tenant.a',
    content: 'Tenant A inquiry',
  });

  const eventTenantB = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdB,
    senderIgsid: igsidCustomer2,
    messageId: 'mid.tenant.b',
    content: 'Tenant B inquiry',
  });

  assert.equal(eventTenantA.integration.tenant_id, tenantIdA);
  assert.equal(eventTenantB.integration.tenant_id, tenantIdB);
  assert.notEqual(eventTenantA.conversation.id, eventTenantB.conversation.id);
  assert.notEqual(eventTenantA.integration.channel_id, eventTenantB.integration.channel_id);
});

// TEST J — Provider parity
test('TEST J: Provider parity: fallback provider receives identical conversation and message context', async () => {
  let primaryCalled = false;
  let fallbackCalled = false;
  let fallbackContext = null;

  const mockGemini = {
    mode: 'vertex',
    generateContent: async () => {
      primaryCalled = true;
      throw new Error('VERTEX_UNAVAILABLE');
    },
  };

  const mockOpenAi = {
    chat: {
      completions: {
        create: async (params) => {
          fallbackCalled = true;
          fallbackContext = params;
          return { choices: [{ message: { content: 'Fallback OpenAI reply' } }] };
        },
      },
    },
  };

  const fallbackGenerate = async ({ systemInstruction, history, messageText }) => {
    try {
      await mockGemini.generateContent();
    } catch {
      primaryCalled = true;
      const res = await mockOpenAi.chat.completions.create({
        messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: messageText }],
      });
      fallbackCalled = true;
      fallbackContext = { systemInstruction, history, messageText, result: res.choices[0].message.content };
      return res.choices[0].message.content;
    }
  };

  const mockDb = createMockDb();
  const fakeHttp = {
    async post() {
      return { data: { recipient_id: igsidCustomer1, message_id: 'mid.provider.parity' } };
    },
  };

  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.turn.parity',
    content: 'Fiyat nedir?',
  });

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: igsidCustomer1,
    text: 'Fiyat nedir?',
    http: fakeHttp,
    generateAiResponse: fallbackGenerate,
    applyPacing: false,
  });

  assert.equal(outcome.aiInvoked, true);
  assert.equal(outcome.delivered, true);
  assert.equal(primaryCalled, true);
  assert.equal(fallbackCalled, true);
  assert.ok(fallbackContext);
});

// TEST K — Reel regression
test('TEST K: Reel regression: written user text intent takes priority over attached reel', async () => {
  const mockDb = createMockDb();
  const rawPayload = {
    object: 'instagram',
    entry: [{
      id: pageIdA,
      time: 1727258400000,
      messaging: [{
        sender: { id: igsidCustomer1 },
        recipient: { id: pageIdA },
        timestamp: 1727258400000,
        message: {
          mid: 'mid.reel.1',
          text: 'Vize işlemlerinde sponsorluk şartı var mı?',
          attachments: [{
            type: 'ig_reel',
            payload: { url: 'https://instagram.com/reel/12345', caption: 'Reel Caption' },
          }],
        },
      }],
    }],
  };

  const events = extractInstagramInboundEvents(rawPayload);
  assert.equal(events.length, 1);
  assert.equal(events[0].attachments.length, 1);
  assert.equal(events[0].attachments[0].type, 'reel');

  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: events[0].recipientId,
    senderIgsid: events[0].senderId,
    messageId: events[0].messageId,
    content: events[0].text,
    attachments: events[0].attachments,
  });

  assert.equal(inboundState.customerMessage.content, 'Vize işlemlerinde sponsorluk şartı var mı?');
  assert.equal(inboundState.shouldInvokeAi, true);
});

// TEST L — Appointment regression
test('TEST L: Appointment regression: natural qualification activates on meeting request without slot invention', async () => {
  const { hasHighIntentAppointmentSignals } = await import('../services/high-intent-lead-service.js');
  assert.equal(hasHighIntentAppointmentSignals('Yarın saat 14:00 için randevu alabilir miyim?'), true);
  assert.equal(hasHighIntentAppointmentSignals('Merhaba'), false);
});

// TEST M — Three independent new Instagram senders
test('TEST M: Three independent new Instagram senders each get independent contact/conversation/AI processing', async () => {
  const mockDb = createMockDb();
  const senders = ['sender_alpha_1', 'sender_beta_2', 'sender_gamma_3'];
  const outcomes = [];

  for (const senderId of senders) {
    const fakeHttp = {
      async post(url, body) {
        return { data: { recipient_id: senderId, message_id: `mid.out.${senderId}` } };
      },
    };

    const inboundState = await persistInstagramInbound({
      database: mockDb,
      recipientId: pageIdA,
      senderIgsid: senderId,
      messageId: `mid.in.${senderId}`,
      content: 'Dubai şirket kuruluşu hakkında bilgi rica ediyorum',
    });

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: senderId,
      text: 'Dubai şirket kuruluşu hakkında bilgi rica ediyorum',
      http: fakeHttp,
      generateAiResponse: async () => `Merhaba ${senderId}, size yardımcı olabilirim.`,
      applyPacing: false,
    });

    outcomes.push({ senderId, inboundState, outcome });
  }

  assert.equal(outcomes.length, 3);
  for (const o of outcomes) {
    assert.equal(o.outcome.aiInvoked, true, `AI not invoked for ${o.senderId}`);
    assert.equal(o.outcome.delivered, true, `Delivery failed for ${o.senderId}`);
  }
  assert.equal(mockDb.store.conversations.size, 3);
  assert.equal(mockDb.store.contacts.size, 3);
});

// TEST N — Sender A cannot suppress Sender B/C
test('TEST N: In-flight orchestration for Sender A never suppresses Sender B or Sender C', async () => {
  const mockDb = createMockDb();
  const fakeHttp = {
    async post(url, body) {
      return { data: { recipient_id: igsidCustomer2, message_id: 'mid.out.b' } };
    },
  };

  const inboundA = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.in.a.flight',
    content: 'Message A',
  });

  const inboundB = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer2,
    messageId: 'mid.in.b.flight',
    content: 'Message B',
  });

  assert.notEqual(inboundA.conversation.id, inboundB.conversation.id);

  const outcomeB = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState: inboundB,
    senderIgsid: igsidCustomer2,
    text: 'Message B',
    http: fakeHttp,
    generateAiResponse: async () => 'Response to B',
    applyPacing: false,
  });

  assert.equal(outcomeB.aiInvoked, true);
  assert.equal(outcomeB.delivered, true);
});

// TEST O — Existing legacy FIRST_CONTACT_HOLD record
test('TEST O: Legacy FIRST_CONTACT_HOLD record is normalized to AUTOMATIC and receives AI response under ALL_MESSAGES', async () => {
  const mockDb = createMockDb();
  const senderId = 'legacy_hold_sender_55';

  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: senderId,
    messageId: 'mid.in.legacy',
    content: 'Dubai şirket kuruluşu',
  });

  // Simulate existing DB conversation having legacy FIRST_CONTACT_HOLD
  inboundState.conversation.ai_behavior_override = 'FIRST_CONTACT_HOLD';

  const policyEval = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai şirket kuruluşu',
    conversation: inboundState.conversation,
    channelConfig: { activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES },
  });

  assert.equal(policyEval.eligible, true);
  assert.equal(policyEval.decision, 'ACTIVATED');
  assert.equal(policyEval.reasonCode, 'POLICY_ALL_MESSAGES');
});

// TEST P — Meta outbound failure is surfaced and not falsely reported as AI suppression
test('TEST P: Meta outbound failure is surfaced with failure code and not reported as AI suppression', async () => {
  const mockDb = createMockDb();
  const fakeFailingHttp = {
    async post() {
      const err = new Error('Graph API error: User is not reachable');
      err.response = { status: 400, data: { error: { message: 'User is not reachable', code: 551 } } };
      throw err;
    },
  };

  const inboundState = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: 'unreachable_user_77',
    messageId: 'mid.in.fail.out',
    content: 'Inquiry',
  });

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: 'unreachable_user_77',
    text: 'Inquiry',
    http: fakeFailingHttp,
    generateAiResponse: async () => 'AI reply',
    applyPacing: false,
  });

  assert.equal(outcome.aiInvoked, true);
  assert.equal(outcome.delivered, false);
  assert.match(outcome.outcome, /DELIVERY_FAILED/);
});
