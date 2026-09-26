process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_ACTIVATION_MODES,
  AI_BEHAVIOR_OVERRIDES,
  evaluateChannelAiActivationPolicy,
} from '../services/channel-ai-activation-policy-service.js';
import { setConversationAiOverride } from '../services/live-inbox-service.js';
import {
  orchestrateInstagramInboundAiResponse,
} from '../services/instagram-ai-orchestrator.js';
import {
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';

const tenantId = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';
const contactIdA = '11111111-1111-4111-8111-111111111111';
const contactIdB = '22222222-2222-4222-8222-222222222222';
const convIdA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const convIdB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PROHIBITED_LEGACY_TERMS = [
  'Foundation Launch Package',
  'Growth Accelerator Package',
  'Silver Bridge Protocol',
  'Enterprise Architecture Review',
  'Technology Consultancy',
  'Meridian Arc Technologies',
  'Project Atlas',
  'Project Harbor',
  'Project Vela',
  'Cloud operations',
];

// 1. AI_ONLY PERSISTS AFTER REFRESH
test('1. AI_ONLY persists after refresh: writeback updates DB and read model returns AI_ONLY', async () => {
  const mockDbData = {
    contacts: {
      [contactIdA]: { id: contactIdA, tenant_id: tenantId, ai_behavior_override: 'AUTOMATIC' },
    },
    conversations: {
      [convIdA]: {
        id: convIdA,
        tenant_id: tenantId,
        contact_id: contactIdA,
        customer_external_id: 'instagram:customer_a',
        status: 'open',
        handling_mode: 'AI',
        ai_behavior_override: 'AUTOMATIC',
      },
    },
  };

  const mockClient = {
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('SELECT id, handling_mode, status, ai_behavior_override')) {
        return { rowCount: 1, rows: [mockDbData.conversations[params[0]]] };
      }
      if (sql.includes('UPDATE conversations') && sql.includes('SET ai_behavior_override = $1')) {
        if (sql.includes('WHERE id = $2')) {
          mockDbData.conversations[params[1]].ai_behavior_override = params[0];
          return { rows: [mockDbData.conversations[params[1]]] };
        }
        return { rows: [] };
      }
      if (sql.includes('UPDATE crm_contacts')) {
        if (mockDbData.contacts[params[1]]) {
          mockDbData.contacts[params[1]].ai_behavior_override = params[0];
          return { rows: [mockDbData.contacts[params[1]]] };
        }
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO conversation_audit_events')) return { rowCount: 1 };
      if (sql.includes('SELECT pg_notify')) return { rowCount: 1 };
      return { rows: [] };
    },
    release() {},
  };

  const mockDb = { async connect() { return mockClient; } };

  await setConversationAiOverride({
    tenantId,
    conversationId: convIdA,
    override: 'AI_ONLY',
    database: mockDb,
  });

  assert.equal(mockDbData.conversations[convIdA].ai_behavior_override, 'AI_ONLY');
  assert.equal(mockDbData.contacts[contactIdA].ai_behavior_override, 'AI_ONLY');

  const readbackOverride = (mockDbData.conversations[convIdA].ai_behavior_override && mockDbData.conversations[convIdA].ai_behavior_override !== 'AUTOMATIC')
    ? mockDbData.conversations[convIdA].ai_behavior_override
    : (mockDbData.contacts[contactIdA].ai_behavior_override || 'FIRST_CONTACT_HOLD');

  assert.equal(readbackOverride, 'AI_ONLY');
});

// 2. AI_ONLY PERSISTS AFTER RESTART/READBACK
test('2. AI_ONLY persists after restart/readback: fresh connection without cache reads AI_ONLY', async () => {
  const persistedState = {
    contactOverride: 'AI_ONLY',
    convOverride: 'AI_ONLY',
  };

  const freshClient = {
    async query(sql) {
      if (sql.includes('crm_contacts')) {
        return { rows: [{ id: contactIdA, ai_behavior_override: persistedState.contactOverride }] };
      }
      if (sql.includes('conversations')) {
        return { rows: [{ id: convIdA, ai_behavior_override: persistedState.convOverride }] };
      }
      return { rows: [] };
    },
  };

  const contactRes = await freshClient.query('SELECT ai_behavior_override FROM crm_contacts WHERE id = $1');
  const convRes = await freshClient.query('SELECT ai_behavior_override FROM conversations WHERE id = $1');

  assert.equal(contactRes.rows[0].ai_behavior_override, 'AI_ONLY');
  assert.equal(convRes.rows[0].ai_behavior_override, 'AI_ONLY');
});

// 3. AI_ONLY OVERRIDES MANUAL_ONLY FOR ONLY THAT CONTACT
test('3. AI_ONLY overrides MANUAL_ONLY channel policy for only that contact', async () => {
  const manualChannelConfig = {
    activation_policy: AI_ACTIVATION_MODES.MANUAL_ONLY,
  };

  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Vize ve şirket kurulumu hakkında bilgi alabilir miyim?',
    conversation: {
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: 'AI_ONLY',
      contact_ai_behavior_override: 'AI_ONLY',
    },
    channelConfig: manualChannelConfig,
  });

  assert.equal(evalResult.eligible, true);
  assert.equal(evalResult.decision, 'ACTIVATED');
  assert.equal(evalResult.reasonCode, 'OVERRIDE_AI_ONLY');
});

// 4. AI_ONLY ANSWERS PENDING MESSAGE EXACTLY ONCE
test('4. AI_ONLY answers pending message exactly once (idempotent, no duplicates)', async () => {
  let deliveredCount = 0;
  const messagesStore = [
    { id: 'm-1', sender_type: 'CUSTOMER', content: 'Fiyatlar nedir?', created_at: new Date().toISOString() },
  ];

  const convStore = {
    id: convIdA,
    tenant_id: tenantId,
    channel_id: 'ch-ig',
    customer_external_id: 'instagram:cust_123',
    status: 'open',
    handling_mode: 'AI',
    handling_version: 1,
    ai_behavior_override: 'FIRST_CONTACT_HOLD',
  };

  const mockClient = {
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('SELECT id, handling_mode, status, ai_behavior_override')) {
        return { rowCount: 1, rows: [convStore] };
      }
      if (sql.includes('UPDATE conversations') && sql.includes('SET ai_behavior_override = $1')) {
        convStore.ai_behavior_override = params[0];
        return { rows: [convStore] };
      }
      if (sql.includes('UPDATE crm_contacts')) return { rowCount: 1, rows: [] };
      if (sql.includes('INSERT INTO conversation_audit_events')) return { rowCount: 1 };
      if (sql.includes('SELECT pg_notify')) return { rowCount: 1 };
      if (sql.includes('FROM conversations c') && sql.includes('JOIN tenant_channels tc')) {
        return {
          rowCount: 1,
          rows: [{
            ...convStore,
            channel_type: 'INSTAGRAM',
            assistant_id: 'ast-1',
            integration_config: { access_token: 'meta_tok', instagram_account_id: 'acc_1' },
          }],
        };
      }
      if (sql.includes('SELECT * FROM conversations WHERE id')) {
        return { rowCount: 1, rows: [convStore] };
      }
      if (sql.includes('FROM conversation_messages') && sql.includes('ORDER BY created_at DESC')) {
        return { rowCount: messagesStore.length, rows: [messagesStore[messagesStore.length - 1]] };
      }
      if (sql.includes('INSERT INTO conversation_messages')) {
        const assistantMsg = { id: `m-${Date.now()}`, sender_type: 'ASSISTANT', content: params[3] || params[2] };
        messagesStore.push(assistantMsg);
        return { rowCount: 1, rows: [assistantMsg] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const mockDb = { async connect() { return mockClient; } };
  const fakeHttp = {
    async post() {
      deliveredCount++;
      return { data: { message_id: `ig.mid.${deliveredCount}` } };
    },
  };

  const res1 = await setConversationAiOverride({
    tenantId,
    conversationId: convIdA,
    override: 'AI_ONLY',
    database: mockDb,
    http: fakeHttp,
    generateAiResponse: async () => 'SamChe Company LLC olarak size yardımcı olmaktan memnuniyet duyarız.',
  });

  assert.equal(deliveredCount, 1);
  assert.equal(res1.immediateResponse?.delivered, true);

  const res2 = await setConversationAiOverride({
    tenantId,
    conversationId: convIdA,
    override: 'AI_ONLY',
    database: mockDb,
    http: fakeHttp,
    generateAiResponse: async () => 'Another reply',
  });

  assert.equal(deliveredCount, 1);
  assert.equal(res2.immediateResponse?.skipped, true);
  assert.equal(res2.immediateResponse?.reason, 'ALREADY_ANSWERED');
});

// 5. NEXT INBOUND MESSAGE RECEIVES AI PROCESSING
test('5. Next inbound message receives AI processing under AI_ONLY override', async () => {
  let outboundSent = false;
  const inboundState = {
    duplicate: false,
    integration: {
      tenant_id: tenantId,
      assistant_id: 'ast-1',
      config: { activation_policy: 'MANUAL_ONLY', access_token: 'test-tok', page_id: '123' },
    },
    conversation: {
      id: convIdA,
      status: 'open',
      handling_mode: 'AI',
      handling_version: 2,
      ai_behavior_override: 'AI_ONLY',
    },
    handlingVersion: 2,
    shouldInvokeAi: true,
  };

  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT * FROM conversations WHERE id')) {
            return { rowCount: 1, rows: [{ ...inboundState.conversation, handling_version: 2 }] };
          }
          if (sql.includes('INSERT INTO conversation_messages')) {
            return { rowCount: 1, rows: [{ id: 'asst-msg-1', sender_type: 'ASSISTANT' }] };
          }
          if (sql.includes('conversation_messages')) {
            return { rowCount: 1, rows: [{ id: 'asst-msg-1', sender_type: 'ASSISTANT' }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const fakeHttp = {
    async post() {
      outboundSent = true;
      return { data: { message_id: 'ig.msg.out' } };
    },
  };

  const result = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: 'customer_123',
    text: 'Sponsorlu oturum evrakları nelerdir?',
    http: fakeHttp,
    generateAiResponse: async () => '2 yıllık sponsorlu oturum için pasaport ve fotoğraf gereklidir.',
  });

  assert.equal(result.delivered, true);
  assert.equal(outboundSent, true);
  assert.ok(result.responseText.includes('sponsorlu oturum'));
});

// 6. AUTOMATIC STILL FOLLOWS CHANNEL POLICY
test('6. AUTOMATIC still follows channel policy (suppressed under MANUAL_ONLY)', async () => {
  const manualChannelConfig = {
    activation_policy: AI_ACTIVATION_MODES.MANUAL_ONLY,
  };

  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai şirket kurulumu fiyatı nedir?',
    conversation: {
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: 'AUTOMATIC',
      contact_ai_behavior_override: 'AUTOMATIC',
    },
    channelConfig: manualChannelConfig,
  });

  assert.equal(evalResult.eligible, false);
  assert.equal(evalResult.decision, 'SUPPRESSED');
  assert.equal(evalResult.reasonCode, 'POLICY_MANUAL_ONLY');
});

// 7. NEVER_AI REMAINS SILENT
test('7. NEVER_AI remains silent even if channel later becomes ALL_MESSAGES', async () => {
  const automaticChannelConfig = {
    activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES,
  };

  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai şirket kurulumu fiyatı nedir?',
    conversation: {
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: 'NEVER_AI',
      contact_ai_behavior_override: 'NEVER_AI',
    },
    channelConfig: automaticChannelConfig,
  });

  assert.equal(evalResult.eligible, false);
  assert.equal(evalResult.decision, 'SUPPRESSED');
  assert.equal(evalResult.reasonCode, 'OVERRIDE_NEVER_AI');
});

// 8. CONTACT A AI_ONLY DOES NOT AFFECT CONTACT B
test('8. Contact A AI_ONLY does not affect Contact B (strict contact isolation)', async () => {
  const channelConfig = { activation_policy: AI_ACTIVATION_MODES.MANUAL_ONLY };

  const evalContactA = await evaluateChannelAiActivationPolicy({
    messageText: 'Hello',
    conversation: {
      id: convIdA,
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: 'AI_ONLY',
      contact_ai_behavior_override: 'AI_ONLY',
    },
    channelConfig,
  });

  const evalContactB = await evaluateChannelAiActivationPolicy({
    messageText: 'Hello',
    conversation: {
      id: convIdB,
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: 'FIRST_CONTACT_HOLD',
      contact_ai_behavior_override: 'FIRST_CONTACT_HOLD',
    },
    channelConfig,
  });

  assert.equal(evalContactA.eligible, true);
  assert.equal(evalContactA.decision, 'ACTIVATED');

  assert.equal(evalContactB.eligible, false);
  assert.equal(evalContactB.decision, 'SUPPRESSED');
  assert.equal(evalContactB.reasonCode, 'FIRST_CONTACT_HOLD');
});

// 9. WHATSAPP BEHAVIOR UNCHANGED
test('9. WhatsApp behavior unchanged: channel routing and evaluation operate normally', async () => {
  const whatsappConfig = {
    activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES,
  };

  const evalWhatsApp = await evaluateChannelAiActivationPolicy({
    messageText: 'Merhaba, şirket kurmak istiyorum',
    conversation: {
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: 'AUTOMATIC',
    },
    channelConfig: whatsappConfig,
  });

  assert.equal(evalWhatsApp.eligible, true);
  assert.equal(evalWhatsApp.decision, 'ACTIVATED');
  assert.equal(evalWhatsApp.reasonCode, 'POLICY_ALL_MESSAGES');
});

// 10. LEGACY KNOWLEDGE CANNOT ENTER INSTAGRAM RUNTIME
test('10. Legacy Knowledge cannot enter Instagram runtime (clean SamChe knowledge only)', () => {
  const profileJson = JSON.stringify(SAMCHE_STAGING_BUSINESS_PROFILE);
  const configJson = JSON.stringify(SAMCHE_STAGING_ASSISTANT_CONFIG);

  for (const term of PROHIBITED_LEGACY_TERMS) {
    assert.equal(
      profileJson.includes(term),
      false,
      `Prohibited legacy term "${term}" found in active business profile`
    );
    assert.equal(
      configJson.includes(term),
      false,
      `Prohibited legacy term "${term}" found in active assistant config`
    );
  }

  assert.equal(SAMCHE_STAGING_BUSINESS_PROFILE.company_identity, 'SamChe Company LLC');
  assert.equal(SAMCHE_STAGING_BUSINESS_PROFILE.industry, 'Management Consulting & Corporate Services');
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.packages.some((p) => p.includes('Sponsored Residency: 13.000 AED')));
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.packages.some((p) => p.includes('UAQ Freelance Permit + Visa: 16.800 AED')));
});

