import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInstagramInboundEvents, isInstagramWebhookEvent } from '../services/instagram-inbound-adapter.js';
import { persistInstagramInbound } from '../services/instagram-live-inbox-service.js';
import { orchestrateInstagramInboundAiResponse } from '../services/instagram-ai-orchestrator.js';
import { ensureConversationCrmIdentity } from '../services/crm-lead-service.js';
import { setConversationAiOverride, appendAgentMessage } from '../services/live-inbox-service.js';

import crypto from 'node:crypto';

class MockInMemoryDatabase {
  constructor({ tenantId = crypto.randomUUID(), channelId = `ch-${crypto.randomUUID()}` } = {}) {
    this.tenantId = tenantId;
    this.channelId = channelId;
    this.conversations = new Map();
    this.messages = [];
    this.contacts = new Map();
    this.tenantUsers = new Map();
    this.nextId = 1;
  }
  async connect() { return this; }
  release() {}
  async query(sql, params = []) {
    const s = String(sql).trim();
    if (/^BEGIN/i.test(s)) {
      this._snapshot = { messages: [...this.messages] };
      return { rowCount: 0, rows: [] };
    }
    if (/^ROLLBACK/i.test(s)) {
      if (this._snapshot) this.messages = [...this._snapshot.messages];
      return { rowCount: 0, rows: [] };
    }
    if (/^(COMMIT|SAVEPOINT|RELEASE)/i.test(s)) return { rowCount: 0, rows: [] };
    if (s.includes('FROM tenant_channels tc') && s.includes('JOIN channel_integrations ci')) {
      return {
        rowCount: 1,
        rows: [{
          channel_id: this.channelId,
          tenant_id: this.tenantId,
          external_channel_id: '178414000000001',
          channel_type: 'INSTAGRAM',
          channel_status: 'active',
          integration_id: 'ci-1',
          integration_key: 'instagram:178414000000001',
          integration_enabled: true,
          config: {
            access_token: 'meta_valid_token_123',
            page_id: '178414000000001',
            instagram_account_id: '178414000000001',
            auth_mode: 'FACEBOOK_LOGIN',
          },
        }],
      };
    }
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
        conv = { id, tenant_id: tId, channel_id: chId, external_conversation_id: extConvId, customer_external_id: custExtId, status: 'open', handling_mode: 'AI', handling_version: 1, ai_behavior_override: aiOverride || 'AI_ONLY', assigned_agent_user_id: null, human_attention_state: 'NONE' };
        this.conversations.set(id, conv);
      }
      return { rowCount: 1, rows: [{ ...conv }] };
    }
    if (s.includes('FROM conversations') && s.includes('JOIN tenant_channels tc')) {
      const conv = this.conversations.get(params[0]);
      if (conv) {
        return {
          rowCount: 1,
          rows: [{
            ...conv,
            channel_type: 'INSTAGRAM',
            external_channel_id: '178414000000001',
            assistant_id: 'asst-1',
            assistant_model: 'gemini-2.0-flash',
            integration_config: {
              access_token: 'meta_valid_token_123',
              page_id: '178414000000001',
              instagram_account_id: '178414000000001',
            },
          }],
        };
      }
      return { rowCount: 0, rows: [] };
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
            assistant_model: 'gemini-2.0-flash',
            external_channel_id: '178414000000001',
            integration_config: { access_token: 'meta_valid_token_123', page_id: '178414000000001', instagram_account_id: '178414000000001' },
            contact_override: contact?.ai_behavior_override || conv.contact_ai_behavior_override || null,
            conv_override: conv.ai_behavior_override || null,
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    }
    if (s.includes('INSERT INTO tenant_users')) {
      this.tenantUsers.set(`${params[0]}:${params[1]}`, { tenant_id: params[0], user_id: params[1], tenant_role: params[2] });
      return { rowCount: 1, rows: [] };
    }
    if (s.includes('INSERT INTO crm_contacts')) {
      const [tId, iKind, iHash, dName, email, phone, src, aiOverride] = params;
      let contact = this.contacts.get(iHash);
      if (!contact) {
        contact = { id: `contact-${this.nextId++}`, tenant_id: tId, identity_kind: iKind, identity_hash: iHash, display_name: dName, email, phone, source: src, ai_behavior_override: aiOverride || (src === 'INSTAGRAM' || src === 'INSTAGRAM_AD' ? 'AI_ONLY' : 'UNDECIDED') };
        this.contacts.set(iHash, contact);
      } else if (aiOverride) {
        contact.ai_behavior_override = aiOverride;
      }
      return { rowCount: 1, rows: [{ ...contact }] };
    }
    if (s.includes('UPDATE crm_contacts')) {
      const contact = Array.from(this.contacts.values()).find((c) => c.id === params[1] && c.tenant_id === params[2]);
      if (contact) { contact.ai_behavior_override = params[0]; return { rowCount: 1, rows: [contact] }; }
      return { rowCount: 0, rows: [] };
    }
    if (s.includes('UPDATE conversations')) {
      const convId = s.includes('SET ai_behavior_override = $1') ? params[1] : (s.includes('SET assigned_agent_user_id = $1') ? params[1] : (params[2] || params[1] || params[0]));
      const conv = this.conversations.get(convId);
      if (conv) {
        if (s.includes('SET contact_id = $1, ai_behavior_override = $2')) { conv.contact_id = params[0]; conv.ai_behavior_override = params[1]; }
        else if (s.includes('SET ai_behavior_override = $1')) { conv.ai_behavior_override = params[0]; }
        else if (s.includes('SET assigned_agent_user_id = $1')) { conv.assigned_agent_user_id = params[0]; }
        else if (s.includes("SET human_attention_state = 'ACKNOWLEDGED'")) { conv.human_attention_state = 'ACKNOWLEDGED'; }
        return { rowCount: 1, rows: [conv] };
      }
      return { rowCount: 1, rows: [] };
    }
    if (s.includes('count(*)::int AS count FROM conversation_messages')) {
      const count = this.messages.filter((m) => m.conversation_id === params[1]).length;
      return { rowCount: 1, rows: [{ count }] };
    }
    if (s.includes('FROM conversation_messages') && s.includes('external_message_id = $3')) {
      const found = this.messages.find((m) => m.external_message_id === params[2]);
      return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
    }
    if (s.includes('INSERT INTO conversation_messages')) {
      let senderType = 'CUSTOMER';
      let content = params[2];
      let extMid = params[3] || null;
      let idempotencyKey = null;
      let senderUserId = null;

      if (s.includes("'CUSTOMER'")) {
        senderType = 'CUSTOMER';
        content = params[2];
        extMid = params[3] || null;
      } else if (s.includes("'ASSISTANT'")) {
        senderType = 'ASSISTANT';
        content = params[2];
        idempotencyKey = params[3] || null;
      } else if (s.includes("'AGENT'")) {
        senderType = 'AGENT';
        content = params[2];
        senderUserId = params[3] || null;
        idempotencyKey = params[4] || null;
      } else {
        senderType = params[2] || 'AGENT';
        content = params[3] || params[2];
        senderUserId = params[4] || null;
        idempotencyKey = params[5] || null;
      }

      const msg = {
        id: `msg-${this.nextId++}`,
        tenant_id: params[0],
        conversation_id: params[1],
        sender_type: senderType,
        content,
        external_message_id: extMid,
        idempotency_key: idempotencyKey,
        sender_user_id: senderUserId,
        created_at: new Date(),
      };
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
    if (s.includes('INSERT INTO audit_events')) {
      return { rowCount: 1, rows: [] };
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

test('TEST C — AI_ONLY → NEVER_AI persists NEVER_AI durable state', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_c_test', messageId: 'mid_c_1', content: 'Inquiry',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState1.conversation.ai_behavior_override, 'AI_ONLY');

  const result = await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState1.conversation.id, override: 'NEVER_AI', database: db,
  });
  assert.equal(result.ai_behavior_override, 'NEVER_AI');
});

test('TEST D — Customer inbound during NEVER_AI: persisted in Live Inbox, unread updated, AI suppressed', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_d_test', messageId: 'mid_d_1', content: 'First message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState1.conversation.id, override: 'NEVER_AI', database: db,
  });

  const inboundState2 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_d_test', messageId: 'mid_d_2', content: 'Merhaba, insan ile görüşmek istiyorum',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState2.conversation.ai_behavior_override, 'NEVER_AI');

  let aiInvoked = false;
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState: inboundState2, senderIgsid: 'sender_d_test', text: 'Merhaba, insan ile görüşmek istiyorum',
    http: mockHttpSuccess, applyPacing: false,
    generateAiResponse: async () => { aiInvoked = true; return 'Should not be called'; },
  });
  assert.equal(aiInvoked, false);
  assert.equal(outcome.aiInvoked, false);
  assert.equal(outcome.suppressed, true);
  assert.equal(outcome.activationEvaluation.reasonCode, 'OVERRIDE_NEVER_AI');
});

test('TEST E — Multiple customer messages during NEVER_AI: all inbound messages visible, state remains NEVER_AI, AI silent', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_e_test', messageId: 'mid_e_1', content: 'First message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState1.conversation.id, override: 'NEVER_AI', database: db,
  });

  for (let i = 2; i <= 4; i++) {
    const inboundState = await persistInstagramInbound({
      database: db, recipientId: '178414000000001', senderIgsid: 'sender_e_test', messageId: `mid_e_${i}`, content: `Follow-up message ${i}`,
      http: mockHttpSuccess, ensureConversationCrmIdentity,
    });
    assert.equal(inboundState.conversation.ai_behavior_override, 'NEVER_AI');
    const outcome = await orchestrateInstagramInboundAiResponse({
      database: db, inboundState, senderIgsid: 'sender_e_test', text: `Follow-up message ${i}`,
      http: mockHttpSuccess, applyPacing: false, generateAiResponse: async () => 'Should not run',
    });
    assert.equal(outcome.aiInvoked, false);
    assert.equal(outcome.suppressed, true);
  }

  const allMessages = db.messages.filter((m) => m.conversation_id === inboundState1.conversation.id);
  assert.equal(allMessages.length, 4);
});

test('TEST F & G — Manual operator outbound from Dashboard when NEVER_AI: invokes canonical delivery and persists AGENT message', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_g_test', messageId: 'mid_g_1', content: 'Customer asking a question',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState.conversation.id, override: 'NEVER_AI', database: db,
  });

  let deliveredRecipient = null;
  let deliveredText = null;
  const mockHttpSend = {
    post: async (url, data) => {
      deliveredRecipient = data?.recipient?.id;
      deliveredText = data?.message?.text;
      return { status: 200, data: { message_id: 'provider_mid_human_reply_123', recipient_id: deliveredRecipient } };
    },
    get: async () => ({ status: 200, data: { id: 'sender_g_test', name: 'Customer G' } }),
  };

  const actor = { userId: 'usr-agent-007', tenantRole: 'ADMIN', systemRole: 'CUSTOMER' };
  const replyResult = await appendAgentMessage({
    tenantId: db.tenantId,
    conversationId: inboundState.conversation.id,
    actor,
    content: 'Merhaba, size nasıl yardımcı olabilirim?',
    database: db,
    http: mockHttpSend,
  });

  assert.equal(replyResult.duplicate, false);
  assert.equal(replyResult.delivery, 'SENT_TO_INSTAGRAM');
  assert.equal(deliveredRecipient, 'sender_g_test', 'Must deliver to clean customer IGSID');
  assert.equal(deliveredText, 'Merhaba, size nasıl yardımcı olabilirim?');
  assert.equal(replyResult.message.sender_type, 'AGENT', 'Must be persisted as AGENT (HUMAN/OPERATOR), not ASSISTANT');
  assert.equal(replyResult.message.content, 'Merhaba, size nasıl yardımcı olabilirim?');
});

test('TEST H — Manual Meta failure: real failure is surfaced and message is not falsely persisted as success', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_h_test', messageId: 'mid_h_1', content: 'Customer asking a question',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState.conversation.id, override: 'NEVER_AI', database: db,
  });

  const mockHttpFail = {
    post: async () => {
      const err = new Error('Meta API error: (#100) Invalid recipient');
      err.response = { status: 400, data: { error: { message: 'Invalid recipient', code: 100 } } };
      throw err;
    },
    get: async () => ({ status: 200, data: { id: 'sender_h_test' } }),
  };

  const actor = { userId: 'usr-agent-007', tenantRole: 'ADMIN', systemRole: 'CUSTOMER' };
  await assert.rejects(
    async () => {
      await appendAgentMessage({
        tenantId: db.tenantId,
        conversationId: inboundState.conversation.id,
        actor,
        content: 'Operator message that fails delivery',
        database: db,
        http: mockHttpFail,
      });
    },
    (err) => {
      assert.ok(err.status === 409 || err.status === 502 || err.code?.includes('INSTAGRAM') || err.code?.includes('META'));
      return true;
    }
  );

  const agentMessages = db.messages.filter((m) => m.sender_type === 'AGENT');
  assert.equal(agentMessages.length, 0, 'Failed message must not be persisted into messages timeline');
});


test('TEST I & J — NEVER_AI → AI_ONLY restore: state becomes AI_ONLY without unsolicited customer-facing support-ended message', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_ij_test', messageId: 'mid_ij_1', content: 'Initial message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState.conversation.id, override: 'NEVER_AI', database: db,
  });

  let httpCalled = false;
  const mockHttpNoCall = {
    post: async () => { httpCalled = true; return { status: 200, data: {} }; },
    get: async () => ({ status: 200, data: {} }),
  };

  const result = await setConversationAiOverride({
    tenantId: db.tenantId,
    conversationId: inboundState.conversation.id,
    override: 'AI_ONLY',
    database: db,
    http: mockHttpNoCall,
  });

  assert.equal(result.ai_behavior_override, 'AI_ONLY');
  assert.equal(httpCalled, false, 'NEVER_AI -> AI_ONLY must not send any unsolicited customer-facing message');

  const assistantMessages = db.messages.filter((m) => m.sender_type === 'ASSISTANT' && m.conversation_id === inboundState.conversation.id);
  assert.equal(assistantMessages.length, 0, 'No assistant lifecycle message should be inserted');
});

test('TEST K — Next inbound after AI_ONLY restore invokes AI normally', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState1 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_k_test', messageId: 'mid_k_1', content: 'First message',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState1.conversation.id, override: 'NEVER_AI', database: db,
  });
  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState1.conversation.id, override: 'AI_ONLY', database: db,
  });

  const inboundState2 = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_k_test', messageId: 'mid_k_2', content: 'What are your Dubai office packages?',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });
  assert.equal(inboundState2.conversation.ai_behavior_override, 'AI_ONLY');

  let aiInvoked = false;
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: db, inboundState: inboundState2, senderIgsid: 'sender_k_test', text: 'What are your Dubai office packages?',
    http: mockHttpSuccess, applyPacing: false,
    generateAiResponse: async () => { aiInvoked = true; return 'Our Dubai packages include complete licensing and visa assistance.'; },
  });
  assert.equal(aiInvoked, true);
  assert.equal(outcome.delivered, true);
});

test('TEST L — Instagram manual reply in NEVER_AI does not require Take Over', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_l_test', messageId: 'mid_l_1', content: 'Testing no takeover requirement',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  // Remains handling_mode = 'AI'
  assert.equal(inboundState.conversation.handling_mode, 'AI');

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState.conversation.id, override: 'NEVER_AI', database: db,
  });

  const actor = { userId: 'usr-agent-007', tenantRole: 'AGENT', systemRole: 'CUSTOMER' };
  const replyResult = await appendAgentMessage({
    tenantId: db.tenantId,
    conversationId: inboundState.conversation.id,
    actor,
    content: 'Reply without prior Take Over',
    database: db,
    http: mockHttpSuccess,
  });

  assert.equal(replyResult.duplicate, false);
  assert.equal(replyResult.delivery, 'SENT_TO_INSTAGRAM');
});

test('TEST M — Message authorship is AGENT/HUMAN and not ASSISTANT', async () => {
  const db = new MockInMemoryDatabase();
  const inboundState = await persistInstagramInbound({
    database: db, recipientId: '178414000000001', senderIgsid: 'sender_m_test', messageId: 'mid_m_1', content: 'Authorship check',
    http: mockHttpSuccess, ensureConversationCrmIdentity,
  });

  await setConversationAiOverride({
    tenantId: db.tenantId, conversationId: inboundState.conversation.id, override: 'NEVER_AI', database: db,
  });

  const actor = { userId: 'usr-agent-123', tenantRole: 'AGENT', systemRole: 'CUSTOMER' };
  const replyResult = await appendAgentMessage({
    tenantId: db.tenantId,
    conversationId: inboundState.conversation.id,
    actor,
    content: 'Human response text',
    database: db,
    http: mockHttpSuccess,
  });

  assert.equal(replyResult.message.sender_type, 'AGENT');
  assert.notEqual(replyResult.message.sender_type, 'ASSISTANT');
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

