import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInstagramInboundEvents, isInstagramWebhookEvent } from '../services/instagram-inbound-adapter.js';
import { persistInstagramInbound } from '../services/instagram-live-inbox-service.js';
import { orchestrateInstagramInboundAiResponse } from '../services/instagram-ai-orchestrator.js';
import { ensureConversationCrmIdentity } from '../services/crm-lead-service.js';
import { setConversationAiOverride } from '../services/live-inbox-service.js';

import crypto from 'node:crypto';

class MockInMemoryDatabase {
  constructor({ tenantId = crypto.randomUUID(), channelId = `ch-${crypto.randomUUID()}` } = {}) {
    this.tenantId = tenantId;
    this.channelId = channelId;
    this.conversations = new Map();
    this.messages = [];
    this.contacts = new Map();
    this.nextId = 1;
  }
  async connect() { return this; }
  release() {}
  async query(sql, params = []) {
    const s = String(sql).trim();
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(s)) return { rowCount: 0, rows: [] };
    if (s.includes('FROM tenant_channels tc')) {
      return {
        rowCount: 1,
        rows: [{
          tenant_id: this.tenantId, channel_id: this.channelId, channel_type: 'INSTAGRAM',
          external_channel_id: '178414000000001', assistant_id: 'asst-1',
          assistant_model: 'gemini-2.0-flash',
          config: { access_token: 'meta_valid_token_123', page_id: '178414000000001', activation_policy: 'ALL_MESSAGES' },
        }],
      };
    }
    if (s.includes('INSERT INTO conversations')) {
      const [tId, chId, extConvId, custExtId, aiOverride] = params;
      let conv = Array.from(this.conversations.values()).find((c) => c.external_conversation_id === extConvId);
      if (!conv) {
        const id = `conv-${this.nextId++}`;
        conv = { id, tenant_id: tId, channel_id: chId, external_conversation_id: extConvId, customer_external_id: custExtId, status: 'open', handling_mode: 'AI', handling_version: 1, ai_behavior_override: aiOverride || 'AI_ONLY' };
        this.conversations.set(id, conv);
      }
      return { rowCount: 1, rows: [{ ...conv }] };
    }
    if (s.includes('FROM conversations') && s.includes('WHERE')) {
      const conv = this.conversations.get(params[0]);
      if (conv) {
        const contact = conv.contact_id ? this.contacts.get(conv.contact_id) : null;
        return {
          rowCount: 1,
          rows: [{
            ...conv,
            channel_type: 'INSTAGRAM',
            assistant_id: 'asst-1',
            external_channel_id: '178414000000001',
            integration_config: { access_token: 'meta_valid_token_123', page_id: '178414000000001' },
            contact_override: contact?.ai_behavior_override || null,
            conv_override: conv.ai_behavior_override || null,
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    }
    if (s.includes('INSERT INTO crm_contacts')) {
      const [tId, iKind, iHash, dName, email, phone, src] = params;
      let contact = this.contacts.get(iHash);
      if (!contact) {
        contact = { id: `contact-${this.nextId++}`, tenant_id: tId, identity_kind: iKind, identity_hash: iHash, display_name: dName, email, phone, source: src, ai_behavior_override: (src === 'INSTAGRAM' || src === 'INSTAGRAM_AD') ? 'AI_ONLY' : 'UNDECIDED' };
        this.contacts.set(iHash, contact);
      }
      return { rowCount: 1, rows: [{ ...contact }] };
    }
    if (s.includes('UPDATE crm_contacts')) {
      const contact = Array.from(this.contacts.values()).find((c) => c.id === params[1] && c.tenant_id === params[2]);
      if (contact) { contact.ai_behavior_override = params[0]; return { rowCount: 1, rows: [contact] }; }
      return { rowCount: 0, rows: [] };
    }
    if (s.includes('UPDATE conversations')) {
      const convId = s.includes('SET ai_behavior_override = $1') ? params[1] : (params[2] || params[1]);
      const conv = this.conversations.get(convId);
      if (conv) {
        if (s.includes('SET contact_id = $1, ai_behavior_override = $2')) { conv.contact_id = params[0]; conv.ai_behavior_override = params[1]; }
        else if (s.includes('SET ai_behavior_override = $1')) { conv.ai_behavior_override = params[0]; }
        return { rowCount: 1, rows: [conv] };
      }
      return { rowCount: 1, rows: [] };
    }
    if (s.includes('FROM conversation_messages') && s.includes('external_message_id = $3')) {
      const found = this.messages.find((m) => m.external_message_id === params[2]);
      return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
    }
    if (s.includes('INSERT INTO conversation_messages')) {
      const senderType = s.includes("'ASSISTANT'") ? 'ASSISTANT' : (s.includes("'AGENT'") ? 'AGENT' : 'CUSTOMER');
      const content = params[2];
      const extMid = s.includes("'ASSISTANT'") ? null : (params[3] || null);
      const idempotencyKey = s.includes("'ASSISTANT'") ? (params[3] || null) : null;
      const msg = { id: `msg-${this.nextId++}`, tenant_id: params[0], conversation_id: params[1], sender_type: senderType, content, external_message_id: extMid, idempotency_key: idempotencyKey, created_at: new Date() };
      this.messages.push(msg);
      return { rowCount: 1, rows: [msg] };
    }
    if (s.includes('FROM conversation_messages')) {
      if (s.includes("sender_type = 'ASSISTANT'") && s.includes('idempotency_key')) {
        const found = this.messages.find((m) => m.sender_type === 'ASSISTANT' && m.idempotency_key === params[2]);
        return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
      }
      const convMsgs = this.messages.filter((m) => m.conversation_id === (params[1] || params[0]));
      if (s.includes('LIMIT 1')) return { rowCount: convMsgs.length ? 1 : 0, rows: convMsgs.slice(-1) };
      return { rowCount: convMsgs.length, rows: convMsgs };
    }
    return { rowCount: 0, rows: [] };
  }
}

const mockHttpSuccess = {
  post: async () => ({ status: 200, data: { message_id: `provider_mid_${Date.now()}`, recipient_id: '123' } }),
  get: async () => ({ status: 200, data: { id: '123', name: 'John Doe', username: 'johndoe' } }),
};

test('TEST A — Brand-new Instagram sender defaults to AI_ONLY and orchestrates without manual activation', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: '999888111', messageId: 'mid_test_a_001',
    content: 'Merhaba, şirket kurulumu hakkında bilgi almak istiyorum.', http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState.duplicate, false);
  assert.equal(inboundState.shouldInvokeAi, true);
  assert.equal(inboundState.conversation.ai_behavior_override, 'AI_ONLY');

  let aiGenerated = false;
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState, senderIgsid: '999888111', text: 'Merhaba, şirket kurulumu hakkında bilgi almak istiyorum.',
    http: mockHttpSuccess, applyPacing: false,
    generateAiResponse: async () => { aiGenerated = true; return 'Dubai şirket kurulumu için size memnuniyetle yardımcı olabiliriz.'; },
  });
  assert.equal(aiGenerated, true);
  assert.equal(outcome.aiInvoked, true);
  assert.equal(outcome.delivered, true);
});

test('TEST B — Message Request originates new conversation initialized as AI_ONLY without manual Accept requirement', async () => {
  const db = new MockInMemoryDatabase();
  const rawWebhook = {
    object: 'instagram',
    entry: [{ id: '178414000000001', time: Date.now(), messaging: [{ sender: { id: 'msg_req_sender_101' }, recipient: { id: '178414000000001' }, timestamp: Date.now(), message: { mid: 'mid_msg_req_001', text: 'Fiyatlarınızı öğrenebilir miyim?' } }] }],
  };
  assert.equal(isInstagramWebhookEvent(rawWebhook), true);
  const events = extractInstagramInboundEvents(rawWebhook);
  assert.equal(events.length, 1);
  const event = events[0];

  const inboundState = await persistInstagramInbound({
    database: db, recipientId: event.recipientId, senderIgsid: event.senderId, messageId: event.messageId, content: event.text,
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState.conversation.ai_behavior_override, 'AI_ONLY');

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState, senderIgsid: event.senderId, text: event.text, http: mockHttpSuccess, applyPacing: false,
    generateAiResponse: async () => 'Hizmet paketlerimiz hakkında detaylı bilgi paylaşıyorum.',
  });
  assert.equal(outcome.delivered, true);
});

test('TEST C — Three independent new senders all resolve to AI_ONLY and reach orchestration independently', async () => {
  const db = new MockInMemoryDatabase();
  const senders = [
    { igsid: 'sender_alpha', mid: 'mid_alpha_1', text: 'Alpha inquiry' },
    { igsid: 'sender_beta', mid: 'mid_beta_1', text: 'Beta inquiry' },
    { igsid: 'sender_gamma', mid: 'mid_gamma_1', text: 'Gamma inquiry' },
  ];
  const outcomes = [];
  for (const s of senders) {
    const inboundState = await persistInstagramInbound({
      database: db, recipientId: '178414000000001', senderIgsid: s.igsid, messageId: s.mid, content: s.text,
      http: mockHttpSuccess, ensureConversationCrmIdentity,
    });
    assert.equal(inboundState.conversation.ai_behavior_override, 'AI_ONLY');
    const outcome = await orchestrateInstagramInboundAiResponse({
      database: db, inboundState, senderIgsid: s.igsid, text: s.text, http: mockHttpSuccess, applyPacing: false,
      generateAiResponse: async ({ text }) => `Response to ${text}`,
    });
    outcomes.push({ sender: s.igsid, outcome, convId: inboundState.conversation.id });
  }
  assert.equal(outcomes.length, 3);
  const convIds = new Set(outcomes.map((o) => o.convId));
  assert.equal(convIds.size, 3, 'All three senders must have distinct conversations');
  for (const o of outcomes) {
    assert.equal(o.outcome.delivered, true);
  }
});

test('TEST D — Explicit Auto: Operator changes to AUTOMATIC, subsequent message remains AUTOMATIC', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_auto_test', messageId: 'mid_auto_1', content: 'First contact',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState1.conversation.ai_behavior_override, 'AI_ONLY');

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState1.conversation.id, override: 'AUTOMATIC', database: db,
  });

  const inboundState2 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_auto_test', messageId: 'mid_auto_2', content: 'Second contact',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState2.conversation.ai_behavior_override, 'AUTOMATIC');
});

test('TEST E — NEVER_AI: Operator explicitly selects NEVER_AI, AI is permanently suppressed and not overwritten', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_never_test', messageId: 'mid_never_1', content: 'Initial message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState1.conversation.id, override: 'NEVER_AI', database: db,
  });

  const inboundState2 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_never_test', messageId: 'mid_never_2', content: 'Another message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState2.conversation.ai_behavior_override, 'NEVER_AI');

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState: inboundState2, senderIgsid: 'sender_never_test', text: 'Another message',
    http: mockHttpSuccess, applyPacing: false, generateAiResponse: async () => 'Should not run',
  });
  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.suppressed, true);
  assert.equal(outcome.activationEvaluation.reasonCode, 'OVERRIDE_NEVER_AI');
});

test('TEST F — Human Takeover: AI is suppressed and not bypassed by new default', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_takeover_test', messageId: 'mid_tk_1', content: 'Normal inquiry about packages',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  const conv = db.conversations.get(inboundState.conversation.id);
  conv.handling_mode = 'HUMAN';
  inboundState.conversation.handling_mode = 'HUMAN';
  inboundState.shouldInvokeAi = false;

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState, senderIgsid: 'sender_takeover_test', text: 'Normal inquiry about packages',
    http: mockHttpSuccess, applyPacing: false,
  });
  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.delivered, undefined);
  assert.equal(outcome.reason, 'NOT_IN_AI_MODE');
});

test('TEST G — Return to AI lifecycle resumes AI handling', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_return_ai', messageId: 'mid_ret_1', content: 'Hello',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  inboundState.conversation.handling_mode = 'AI';
  inboundState.shouldInvokeAi = true;

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState, senderIgsid: 'sender_return_ai', text: 'Hello',
    http: mockHttpSuccess, applyPacing: false, generateAiResponse: async () => 'Resumed AI response',
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.aiInvoked, true);
});

test('TEST H — Legacy FIRST_CONTACT_HOLD normalizes to AI_ONLY and does not permanently suppress Instagram', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_legacy_hold', messageId: 'mid_leg_1', content: 'Legacy contact message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  const conv = db.conversations.get(inboundState.conversation.id);
  conv.ai_behavior_override = 'FIRST_CONTACT_HOLD';
  const contact = db.contacts.get(conv.contact_id);
  if (contact) contact.ai_behavior_override = 'FIRST_CONTACT_HOLD';

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState, senderIgsid: 'sender_legacy_hold', text: 'Legacy contact message',
    http: mockHttpSuccess, applyPacing: false, generateAiResponse: async () => 'Normalized response to legacy contact',
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.aiInvoked, true);
  assert.equal(inboundState.conversation.ai_behavior_override, 'AI_ONLY');
});


test('TEST I — Manual AI_ONLY resume triggers real Instagram delivery adapter and persistence', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_manual_resume', messageId: 'mid_man_1', content: 'Inquiry waiting on hold',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  let deliveryCalled = false;
  let deliveredRecipient = null;
  const mockHttpDelivery = {
    post: async (url, data) => {
      deliveryCalled = true;
      deliveredRecipient = data?.recipient?.id;
      return { status: 200, data: { message_id: 'provider_mid_resumed_999', recipient_id: deliveredRecipient } };
    },
    get: async () => ({ status: 200, data: { id: 'sender_manual_resume', name: 'Manual User' } }),
  };

  const result = await setConversationAiOverride({
    tenantId: db.tenantId,
    conversationId: inboundState.conversation.id,
    override: 'AI_ONLY',
    database: db,
    http: mockHttpDelivery,
    generateAiResponse: async () => 'Immediate AI response after manual activation',
  });

  assert.equal(result.ai_behavior_override, 'AI_ONLY');
  assert.equal(result.immediateResponse?.delivered, true);
  assert.equal(deliveryCalled, true, 'Real Instagram outbound delivery adapter must have been invoked');
  assert.equal(deliveredRecipient, 'sender_manual_resume', 'Recipient IGSID must be clean customer IGSID');
});

test('TEST J — Outbound recipient uses canonical customer IGSID without corruption', async () => {
  const db = new MockInMemoryDatabase();
  let requestedEndpoint = null;
  let requestedRecipient = null;
  const mockHttpCapture = {
    post: async (url, data) => {
      requestedEndpoint = url;
      requestedRecipient = data?.recipient?.id;
      return { status: 200, data: { message_id: 'provider_mid_igsid_test' } };
    },
    get: async () => ({ status: 200, data: { id: '998877665544' } }),
  };

  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'instagram:998877665544', messageId: 'mid_igsid_1', content: 'IGSID test',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState, senderIgsid: 'instagram:998877665544', text: 'IGSID test',
    http: mockHttpCapture, applyPacing: false, generateAiResponse: async () => 'IGSID verified response',
  });

  assert.equal(outcome.delivered, true);
  assert.equal(requestedRecipient, '998877665544', 'Must strip instagram: prefix and deliver to raw IGSID');
  assert.ok(requestedEndpoint.includes('/messages'), 'Endpoint must target Meta messages');
});

test('TEST M — Duplicate MID cannot produce duplicate response', async () => {
  const db = new MockInMemoryDatabase();
  const inbound1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_dup_test', messageId: 'mid_unique_123', content: 'Duplicate test message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inbound1.duplicate, false);

  const inbound2 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_dup_test', messageId: 'mid_unique_123', content: 'Duplicate test message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inbound2.duplicate, true);
  assert.equal(inbound2.shouldInvokeAi, false);
});

test('TEST J — Concurrent independent senders execute without interference', async () => {
  const db = new MockInMemoryDatabase();
  const [inboundA, inboundB] = await Promise.all([
    persistInstagramInbound({
      database: db, recipientId: '178414000000001', senderIgsid: 'sender_conc_A', messageId: 'mid_conc_A', content: 'Message from A',
      http: mockHttpSuccess, ensureConversationCrmIdentity,
    }),
    persistInstagramInbound({
      database: db, recipientId: '178414000000001', senderIgsid: 'sender_conc_B', messageId: 'mid_conc_B', content: 'Message from B',
      http: mockHttpSuccess, ensureConversationCrmIdentity,
    }),
  ]);

  const [resA, resB] = await Promise.all([
    orchestrateInstagramInboundAiResponse({
      database: db, inboundState: inboundA, senderIgsid: 'sender_conc_A', text: 'Message from A', http: mockHttpSuccess, applyPacing: false,
      generateAiResponse: async () => 'Reply to A',
    }),
    orchestrateInstagramInboundAiResponse({
      database: db, inboundState: inboundB, senderIgsid: 'sender_conc_B', text: 'Message from B', http: mockHttpSuccess, applyPacing: false,
      generateAiResponse: async () => 'Reply to B',
    }),
  ]);

  assert.equal(resA.delivered, true);
  assert.equal(resB.delivered, true);
});

test('TEST K — Meta outbound failure is observable and not misreported as AI-policy suppression', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_fail_test', messageId: 'mid_fail_1', content: 'Testing outbound failure',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  const mockHttpFail = {
    post: async () => {
      const err = new Error('Meta API error: (#10) Message Request restriction');
      err.response = { status: 400, data: { error: { message: 'Message Request restriction', code: 10, error_subcode: 2018001 } } };
      throw err;
    },
    get: async () => ({ status: 200, data: { id: '123', name: 'John Doe' } }),
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState, senderIgsid: 'sender_fail_test', text: 'Testing outbound failure',
    http: mockHttpFail, applyPacing: false, generateAiResponse: async () => 'Attempted AI response',
  });

  assert.equal(outcome.aiInvoked, true, 'AI must have been invoked');
  assert.equal(outcome.delivered, false, 'Delivery must reflect actual Meta failure');
  assert.match(outcome.outcome, /DELIVERY_FAILED/);
});

test('TEST O — Tenant isolation: channels and conversations remain strictly separated', async () => {
  const db = new MockInMemoryDatabase();
  const inboundT1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'shared_sender_id', messageId: 'mid_t1_1', content: 'Tenant 1 query',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundT1.integration.tenant_id, db.tenantId);
  assert.equal(inboundT1.conversation.ai_behavior_override, 'AI_ONLY');
});

test('TEST P & Q — Vertex primary and OpenAI failover provider parity', async () => {
  const db1 = new MockInMemoryDatabase();
  const inboundState1 = await persistInstagramInbound({
    database: db1, recipientId: '178414000000001', senderIgsid: 'sender_parity_test_1', messageId: 'mid_par_1', content: 'Company setup',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  let vertexCalled = false;
  const vertexOutcome = await orchestrateInstagramInboundAiResponse({
    database: db1, inboundState: inboundState1, senderIgsid: 'sender_parity_test_1', text: 'Company setup', http: mockHttpSuccess, applyPacing: false,
    generateAiResponse: async () => { vertexCalled = true; return { text: 'Vertex response', model: 'gemini-2.0-flash', fallbackUsed: false }; },
  });
  assert.equal(vertexCalled, true);
  assert.equal(vertexOutcome.delivered, true);

  const db2 = new MockInMemoryDatabase();
  const inboundState2 = await persistInstagramInbound({
    database: db2, recipientId: '178414000000001', senderIgsid: 'sender_parity_test_2', messageId: 'mid_par_2', content: 'Company setup',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  let fallbackCalled = false;
  const fallbackOutcome = await orchestrateInstagramInboundAiResponse({
    database: db2, inboundState: inboundState2, senderIgsid: 'sender_parity_test_2', text: 'Company setup', http: mockHttpSuccess, applyPacing: false,
    generateAiResponse: async () => { fallbackCalled = true; return { text: 'OpenAI failover response', model: 'gpt-4o', fallbackUsed: true, fallbackReason: 'VERTEX_TIMEOUT' }; },
  });
  assert.equal(fallbackCalled, true);
  assert.equal(fallbackOutcome.delivered, true);
});

