process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_ACTIVATION_MODES,
  AI_BEHAVIOR_OVERRIDES,
  matchTriggers,
  classifySemanticBusinessIntent,
  evaluateChannelAiActivationPolicy,
} from '../services/channel-ai-activation-policy-service.js';

const tenantIdA = '11111111-1111-4111-8111-111111111111';
const tenantIdB = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// 1. TRIGGER MATCHING (UNICODE & CASE-INSENSITIVE)
// ---------------------------------------------------------------------------
test('matchTriggers matches Unicode tokens and multi-word phrases case-insensitively', () => {
  const triggers = ['Dubai', 'şirket', 'banka hesabı', 'vize'];

  assert.equal(matchTriggers('Dubai hakkında bilgi almak istiyorum', triggers).matched, true);
  assert.equal(matchTriggers('DUBAI hakkında bilgi', triggers).matched, true);
  assert.equal(matchTriggers('Şirket kurulumu nasıl yapılıyor?', triggers).matched, true);
  assert.equal(matchTriggers('ŞİRKET KURULUMU', triggers).matched, true);

  assert.equal(matchTriggers('Banka hesabı açabilir miyiz?', triggers).matched, true);
  assert.equal(matchTriggers('BANKA HESABI acilisi', triggers).matched, true);

  // Avoid naive substring false positive
  assert.equal(matchTriggers('Bu dokümanı revize ettik', ['vize']).matched, false);

  assert.equal(matchTriggers('Bugün hava çok güzel', triggers).matched, false);
  assert.equal(matchTriggers('', triggers).matched, false);
  assert.equal(matchTriggers('Hello', []).matched, false);
});

// ---------------------------------------------------------------------------
// 2. SEMANTIC BUSINESS INTENT CLASSIFICATION & FAIL-SAFE
// ---------------------------------------------------------------------------
test('classifySemanticBusinessIntent classifies commercial intent vs personal/social DMs', async () => {
  const business1 = await classifySemanticBusinessIntent({
    messageText: "Dubai'de bir iş yapmak istiyorum ama nereden başlayacağımı bilmiyorum",
  });
  assert.equal(business1.isBusinessIntent, true);
  assert.equal(business1.label, 'BUSINESS');

  const business2 = await classifySemanticBusinessIntent({
    messageText: 'Şirket kurulumu ve vize fiyatları nedir?',
  });
  assert.equal(business2.isBusinessIntent, true);
  assert.equal(business2.label, 'BUSINESS');

  const social1 = await classifySemanticBusinessIntent({
    messageText: 'Naber?',
  });
  assert.equal(social1.isBusinessIntent, false);
  assert.equal(social1.label, 'SOCIAL');

  const social2 = await classifySemanticBusinessIntent({
    messageText: 'Akşam neredesin buluşalım',
  });
  assert.equal(social2.isBusinessIntent, false);
  assert.equal(social2.label, 'SOCIAL');

  const social3 = await classifySemanticBusinessIntent({
    messageText: 'Doğum günün kutlu olsun kardeşim!',
  });
  assert.equal(social3.isBusinessIntent, false);
  assert.equal(social3.label, 'SOCIAL');

  const uncertain = await classifySemanticBusinessIntent({
    messageText: 'hmm',
  });
  assert.equal(uncertain.isBusinessIntent, false);
  assert.equal(uncertain.label, 'UNCERTAIN');
});
// ---------------------------------------------------------------------------
// 3. CHANNEL AI ACTIVATION POLICY MODES
// ---------------------------------------------------------------------------
test('MANUAL_ONLY mode suppresses AI response while allowing message to persist', async () => {
  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai şirket kurulumu fiyatı nedir?',
    conversation: { handling_mode: 'AI', status: 'open' },
    channelConfig: { activation_policy: AI_ACTIVATION_MODES.MANUAL_ONLY },
  });

  assert.equal(evalResult.eligible, false);
  assert.equal(evalResult.decision, 'SUPPRESSED');
  assert.equal(evalResult.reasonCode, 'POLICY_MANUAL_ONLY');
});

test('ALL_MESSAGES mode activates AI for all open customer messages', async () => {
  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Hello there!',
    conversation: { handling_mode: 'AI', status: 'open' },
    channelConfig: { activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES },
  });

  assert.equal(evalResult.eligible, true);
  assert.equal(evalResult.decision, 'ACTIVATED');
  assert.equal(evalResult.reasonCode, 'POLICY_ALL_MESSAGES');
});

test('TRIGGER_ONLY mode activates AI only when configured trigger matches', async () => {
  const channelConfig = {
    activation_policy: AI_ACTIVATION_MODES.TRIGGER_ONLY,
    activation_triggers: ['dubai', 'şirket', 'fiyat'],
  };

  const matchResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai hakkında danışmanlık almak istiyorum',
    conversation: { handling_mode: 'AI', status: 'open' },
    channelConfig,
  });
  assert.equal(matchResult.eligible, true);
  assert.equal(matchResult.decision, 'ACTIVATED');
  assert.equal(matchResult.reasonCode, 'TRIGGER_MATCHED');
  assert.ok(matchResult.matchedTriggers.includes('dubai'));

  const nonMatchResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Merhaba nasılsınız?',
    conversation: { handling_mode: 'AI', status: 'open' },
    channelConfig,
  });
  assert.equal(nonMatchResult.eligible, false);
  assert.equal(nonMatchResult.decision, 'SUPPRESSED');
  assert.equal(nonMatchResult.reasonCode, 'NO_TRIGGER_MATCHED');
});

test('BUSINESS_INTENT_ONLY mode activates on business inquiry and suppresses personal chat', async () => {
  const channelConfig = {
    activation_policy: AI_ACTIVATION_MODES.BUSINESS_INTENT_ONLY,
    activation_triggers: ['dubai'],
  };

  const businessResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Vize başvurusu için hangi evraklar gerekiyor?',
    conversation: { handling_mode: 'AI', status: 'open' },
    channelConfig,
  });
  assert.equal(businessResult.eligible, true);
  assert.equal(businessResult.decision, 'ACTIVATED');
  assert.equal(businessResult.reasonCode, 'BUSINESS_INTENT_CLASSIFIED');

  const socialResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Akşam neredesin buluşalım',
    conversation: { handling_mode: 'AI', status: 'open' },
    channelConfig,
  });
  assert.equal(socialResult.eligible, false);
  assert.equal(socialResult.decision, 'SUPPRESSED');
  assert.equal(socialResult.reasonCode, 'SOCIAL_OR_NON_BUSINESS_INTENT');
});

// ---------------------------------------------------------------------------
// 4. CONTACT / CONVERSATION OVERRIDE PRECEDENCE
// ---------------------------------------------------------------------------
test('NEVER_AI override strictly suppresses AI even when business triggers match', async () => {
  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai şirket kurulumu fiyatı nedir?',
    conversation: {
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: AI_BEHAVIOR_OVERRIDES.NEVER_AI,
    },
    channelConfig: {
      activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES,
      activation_triggers: ['dubai'],
    },
  });

  assert.equal(evalResult.eligible, false);
  assert.equal(evalResult.decision, 'SUPPRESSED');
  assert.equal(evalResult.reasonCode, 'OVERRIDE_NEVER_AI');
});

test('ALWAYS_AI override bypasses MANUAL_ONLY channel policy', async () => {
  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'Hi, I need help',
    conversation: {
      handling_mode: 'AI',
      status: 'open',
      ai_behavior_override: AI_BEHAVIOR_OVERRIDES.ALWAYS_AI,
    },
    channelConfig: {
      activation_policy: AI_ACTIVATION_MODES.MANUAL_ONLY,
    },
  });

  assert.equal(evalResult.eligible, true);
  assert.equal(evalResult.decision, 'ACTIVATED');
  assert.equal(evalResult.reasonCode, 'OVERRIDE_ALWAYS_AI');
});

test('Human Takeover (handling_mode = HUMAN) strictly suppresses AI even with ALWAYS_AI override', async () => {
  const evalResult = await evaluateChannelAiActivationPolicy({
    messageText: 'I want to proceed',
    conversation: {
      handling_mode: 'HUMAN',
      status: 'open',
      ai_behavior_override: AI_BEHAVIOR_OVERRIDES.ALWAYS_AI,
    },
    channelConfig: {
      activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES,
    },
  });

  assert.equal(evalResult.eligible, false);
  assert.equal(evalResult.decision, 'SUPPRESSED');
  assert.equal(evalResult.reasonCode, 'HUMAN_MODE_ACTIVE');
});

// ---------------------------------------------------------------------------
// 5. TWO-TENANT ISOLATION
// ---------------------------------------------------------------------------
test('TWO-TENANT ISOLATION: Tenant A policies and triggers do not affect Tenant B', async () => {
  const configA = {
    activation_policy: AI_ACTIVATION_MODES.TRIGGER_ONLY,
    activation_triggers: ['special-keyword-a'],
  };
  const configB = {
    activation_policy: AI_ACTIVATION_MODES.MANUAL_ONLY,
    activation_triggers: ['special-keyword-b'],
  };

  const evalA = await evaluateChannelAiActivationPolicy({
    messageText: 'Tell me about special-keyword-a',
    conversation: { handling_mode: 'AI', status: 'open', tenant_id: tenantIdA },
    channelConfig: configA,
    tenantContext: { tenantId: tenantIdA },
  });

  const evalB = await evaluateChannelAiActivationPolicy({
    messageText: 'Tell me about special-keyword-a',
    conversation: { handling_mode: 'AI', status: 'open', tenant_id: tenantIdB },
    channelConfig: configB,
    tenantContext: { tenantId: tenantIdB },
  });

  assert.equal(evalA.eligible, true);
  assert.equal(evalA.decision, 'ACTIVATED');
  assert.equal(evalA.reasonCode, 'TRIGGER_MATCHED');

  assert.equal(evalB.eligible, false);
  assert.equal(evalB.decision, 'SUPPRESSED');
  assert.equal(evalB.reasonCode, 'POLICY_MANUAL_ONLY');
});

// ---------------------------------------------------------------------------
// 6. DURABLE CONTACT-LEVEL OVERRIDE PERSISTENCE
// ---------------------------------------------------------------------------
test('Durable Contact Override: NEVER_AI persists on contact and carries over to new conversations', async () => {
  const customerExtId = 'instagram:17841499999999999';
  const convId1 = '33333333-3333-4333-8333-333333333333';
  const convId2 = '44444444-4444-4444-8444-444444444444';
  const contactId = '55555555-5555-4555-8555-555555555555';

  const mockDbData = {
    contacts: {
      [contactId]: {
        id: contactId,
        tenant_id: tenantIdA,
        identity_hash: 'hash-contact-1',
        ai_behavior_override: 'AUTOMATIC',
      },
    },
    conversations: {
      [convId1]: {
        id: convId1,
        tenant_id: tenantIdA,
        customer_external_id: customerExtId,
        contact_id: contactId,
        handling_mode: 'AI',
        status: 'open',
        ai_behavior_override: 'AUTOMATIC',
      },
      [convId2]: {
        id: convId2,
        tenant_id: tenantIdA,
        customer_external_id: customerExtId,
        contact_id: contactId,
        handling_mode: 'AI',
        status: 'open',
        ai_behavior_override: 'AUTOMATIC',
      },
    },
  };

  const { setConversationAiOverride } = await import('../services/live-inbox-service.js');
  const { ensureConversationCrmIdentity } = await import('../services/crm-lead-service.js');

  const mockClient = {
    async query(sql, params) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('SELECT id, handling_mode, status, ai_behavior_override')) {
        const row = mockDbData.conversations[params[0]];
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes('UPDATE conversations') && sql.includes('SET ai_behavior_override = $1')) {
        const override = params[0];
        const targetId = params[1];
        if (mockDbData.conversations[targetId]) {
          mockDbData.conversations[targetId].ai_behavior_override = override;
        }
        return { rows: [mockDbData.conversations[targetId]] };
      }
      if (sql.includes('UPDATE crm_contacts') && sql.includes('SET ai_behavior_override = $1')) {
        const override = params[0];
        const targetContactId = params[1];
        if (mockDbData.contacts[targetContactId]) {
          mockDbData.contacts[targetContactId].ai_behavior_override = override;
        }
        return { rows: [mockDbData.contacts[targetContactId]] };
      }
      if (sql.includes('INSERT INTO audit_events')) return {};
      if (sql.includes('SELECT pg_notify')) return {};
      if (sql.includes('SELECT id, tenant_id, customer_external_id, contact_id')) {
        const row = mockDbData.conversations[params[0]];
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes('INSERT INTO crm_contacts')) {
        return { rowCount: 1, rows: [mockDbData.contacts[contactId]] };
      }
      if (sql.includes('INSERT INTO crm_leads')) {
        return { rowCount: 1, rows: [{ id: 'lead-1' }] };
      }
      if (sql.includes('SELECT id, tenant_id, contact_id, conversation_id FROM crm_leads')) {
        return { rowCount: 1, rows: [{ id: 'lead-1' }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const mockDb = {
    async connect() { return mockClient; },
  };

  // 1. Operator in Live Inbox marks Conversation 1 as NEVER_AI
  await setConversationAiOverride({
    tenantId: tenantIdA,
    conversationId: convId1,
    override: 'NEVER_AI',
    database: mockDb,
  });

  // Verify Conversation 1 is NEVER_AI
  assert.equal(mockDbData.conversations[convId1].ai_behavior_override, 'NEVER_AI');
  // Verify durable Contact is also updated to NEVER_AI
  assert.equal(mockDbData.contacts[contactId].ai_behavior_override, 'NEVER_AI');

  // 2. New inbound message arrives, creating / initializing Conversation 2 with that same contact
  await ensureConversationCrmIdentity(mockClient, {
    tenantId: tenantIdA,
    conversationId: convId2,
    source: 'INSTAGRAM',
    externalCustomerId: customerExtId,
  });

  // Verify Conversation 2 inherits durable contact-level NEVER_AI
  assert.equal(mockDbData.conversations[convId2].ai_behavior_override, 'NEVER_AI');

  // 3. Evaluate AI Activation Policy on Conversation 2 even with ALL_MESSAGES channel setting
  const evalNewThread = await evaluateChannelAiActivationPolicy({
    messageText: 'Dubai şirket fiyatı nedir?',
    conversation: mockDbData.conversations[convId2],
    channelConfig: { activation_policy: AI_ACTIVATION_MODES.ALL_MESSAGES },
  });

  // Strict proof: AI is suppressed due to durable contact-level NEVER_AI override
  assert.equal(evalNewThread.eligible, false);
  assert.equal(evalNewThread.decision, 'SUPPRESSED');
  assert.equal(evalNewThread.reasonCode, 'OVERRIDE_NEVER_AI');
});


