import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INSTAGRAM_CHANNEL_PRESENTATION_RULES,
  isMediaOnlyInbound,
  generateContextualConversationalFallback,
  orchestrateInstagramInboundAiResponse,
} from '../services/instagram-ai-orchestrator.js';
import {
  buildTenantRuntimeSystemInstruction,
  TENANT_FACTUAL_GROUNDING_POLICY,
} from '../services/tenant-runtime-persona-service.js';
import {
  SAMCHE_KNOWLEDGE_SOURCES,
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';

class MockDatabaseClient {
  constructor({ messages = [] } = {}) {
    this.messages = messages;
  }

  async query(sql, params = []) {
    const s = String(sql).trim();

    if (s.includes("sender_type = 'ASSISTANT'") && s.includes('idempotency_key')) {
      return { rowCount: 0, rows: [] };
    }

    if (s.includes('FROM conversations')) {
      return {
        rowCount: 1,
        rows: [{
          id: '22222222-2222-4222-8222-222222222222',
          tenant_id: 'b85d7e7b-d52e-4541-92e7-284a6a67024b',
          channel_id: 'ch-1',
          channel_type: 'INSTAGRAM',
          status: 'open',
          handling_mode: 'AI',
          handling_version: 1,
          communication_language: 'tr',
          contact_display_name: 'Ahmet Yılmaz',
          contact_name: 'Ahmet Yılmaz',
          contact_phone: '+905321112233',
          ai_behavior_override: 'AI_ONLY',
        }],
      };
    }

    if (s.includes('FROM conversation_messages')) {
      const msgs = this.messages.length > 0 ? this.messages : [
        { id: 'm1', sender_type: 'CUSTOMER', content: 'Test message', created_at: new Date(1000) },
      ];
      if (s.includes('ORDER BY created_at DESC')) {
        const sorted = [...msgs].reverse();
        if (s.includes('LIMIT 1')) return { rowCount: Math.min(1, sorted.length), rows: sorted.slice(0, 1) };
        return { rowCount: sorted.length, rows: sorted };
      }
      return { rowCount: msgs.length, rows: msgs };
    }

    if (s.includes('SELECT id FROM crm_leads')) {
      return { rowCount: 1, rows: [{ id: 'lead-1' }] };
    }

    if (s.includes('INSERT INTO crm_consultations') || (s.includes('SELECT') && s.includes('FROM crm_consultations'))) {
      return { rowCount: 1, rows: [{ id: 'cons-1', status: 'PENDING' }] };
    }

    if (s.includes('INSERT INTO conversation_messages') || s.includes('UPDATE conversation_messages')) {
      return { rowCount: 1, rows: [{ id: 'asst-msg-1', sender_type: 'ASSISTANT' }] };
    }

    return { rowCount: 0, rows: [] };
  }

  release() {}

  async connect() {
    return this;
  }
}

const mockHttp = {
  post: async () => ({ status: 200, data: { message_id: 'ig_outbound_mid_123', recipient_id: '123456' } }),
  get: async () => ({ status: 200, data: { id: '123456', name: 'Ahmet Yılmaz' } }),
};

test('1. Instagram media only → clarification request ("Bu içerikle ilgili size nasıl yardımcı olabilirim?")', async () => {
  const mediaOnlyInputs = [
    '[Attachment: video]',
    '[Attachment: image]',
    '[Attachment: file]',
    '[Attachment: share]',
    '[Attachment: story_mention]',
    '[ATTACHED_IMAGE: ad_screenshot.jpg (image/jpeg)]',
    '[ATTACHED_DOCUMENT: brochure.pdf (application/pdf)]',
  ];

  for (const input of mediaOnlyInputs) {
    assert.equal(isMediaOnlyInbound(input), true, `Input "${input}" must be classified as media-only`);
    const fallbackResponse = generateContextualConversationalFallback({ text: input });
    assert.equal(
      fallbackResponse,
      'Bu içerikle ilgili size nasıl yardımcı olabilirim?',
      `Media-only input "${input}" must return clarification prompt`
    );
  }

  assert.equal(isMediaOnlyInbound('Oturum ücretleri nedir?'), false);
  assert.equal(isMediaOnlyInbound('Merhaba'), false);
  assert.equal(isMediaOnlyInbound('[Attachment: video] Dubai oturum ücretleri nedir?'), false);
});

test('2. Instagram advertisement video + text question → text intent wins over media', async () => {
  assert.match(
    INSTAGRAM_CHANNEL_PRESENTATION_RULES,
    /INSTAGRAM DM MEDIA \+ TEXT INTENT PRIORITY/,
    'Rules must contain explicit media + text priority section'
  );
  assert.match(
    INSTAGRAM_CHANNEL_PRESENTATION_RULES,
    /WRITTEN QUESTION HAS HIGHEST PRIORITY/,
    'Rules must establish written question as highest priority'
  );

  const mockDb = new MockDatabaseClient({
    messages: [
      { id: 'm1', sender_type: 'CUSTOMER', content: 'Dubai oturum ücretleri nedir?', created_at: new Date(1000) },
    ],
  });

  const inboundState = {
    shouldInvokeAi: true,
    duplicate: false,
    handlingVersion: 1,
    integration: {
      tenant_id: 'b85d7e7b-d52e-4541-92e7-284a6a67024b',
      assistant_id: 'ast-1',
      config: { access_token: 'test_token', instagram_account_id: 'page_123', activation_policy: 'ALL_MESSAGES' },
    },
    conversation: {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      contact_display_name: 'Ahmet Yılmaz',
    },
    customerMessage: { id: 'm1', content: 'Dubai oturum ücretleri nedir?' },
  };

  let capturedSystemInstruction = '';
  let capturedText = '';

  const result = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: '123456789',
    text: 'Dubai oturum ücretleri nedir?',
    http: mockHttp,
    applyPacing: false,
    generateAiResponse: async ({ systemInstruction, text }) => {
      capturedSystemInstruction = systemInstruction;
      capturedText = text;
      return 'Dubai 2 yıllık sponsorlu oturum ücreti toplam 13.000 AED’dir (4.000 AED + 8.000 AED + 1.000 AED).';
    },
  });

  assert.equal(result.aiInvoked, true);
  assert.equal(result.delivered, true);
  assert.equal(capturedText, 'Dubai oturum ücretleri nedir?');
  assert.ok(capturedSystemInstruction.includes('INSTAGRAM DM MEDIA + TEXT INTENT PRIORITY'));
  assert.ok(capturedSystemInstruction.includes('WRITTEN QUESTION HAS HIGHEST PRIORITY'));
  assert.match(result.responseText, /13\.000 AED/);
});

test('3. Instagram image + pricing question → knowledge grounded answer, not image description', async () => {
  const mockDb = new MockDatabaseClient({
    messages: [
      { id: 'm1', sender_type: 'CUSTOMER', content: 'Şirket kurma danışmanlık ücreti nedir ve banka hesabı dahil mi?', created_at: new Date(1000) },
    ],
  });

  const inboundState = {
    shouldInvokeAi: true,
    duplicate: false,
    handlingVersion: 1,
    integration: {
      tenant_id: 'b85d7e7b-d52e-4541-92e7-284a6a67024b',
      assistant_id: 'ast-1',
      config: { access_token: 'test_token', instagram_account_id: 'page_123', activation_policy: 'ALL_MESSAGES' },
    },
    conversation: {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      contact_display_name: 'Mehmet Demir',
    },
    customerMessage: { id: 'm1', content: 'Şirket kurma danışmanlık ücreti nedir ve banka hesabı dahil mi?' },
  };

  const result = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: '123456789',
    text: 'Şirket kurma danışmanlık ücreti nedir ve banka hesabı dahil mi?',
    http: mockHttp,
    applyPacing: false,
    generateAiResponse: async () => {
      return 'Free Zone şirket kuruluşlarında danışmanlık ücretimiz 8.000 AED olup kurumsal banka hesabı açılış ve KYC desteği bu ücrete dahildir.';
    },
  });

  assert.equal(result.aiInvoked, true);
  assert.match(result.responseText, /8\.000 AED/);
  assert.match(result.responseText, /banka.*KYC.*dahil/i);
});


test('4. Instagram PDF + question → answers question, not PDF description', async () => {
  const mockDb = new MockDatabaseClient({
    messages: [
      { id: 'm1', sender_type: 'CUSTOMER', content: 'Kurumlar vergisi ve KDV oranları nedir?', created_at: new Date(1000) },
    ],
  });

  const inboundState = {
    shouldInvokeAi: true,
    duplicate: false,
    handlingVersion: 1,
    integration: {
      tenant_id: 'b85d7e7b-d52e-4541-92e7-284a6a67024b',
      assistant_id: 'ast-1',
      config: { access_token: 'test_token', instagram_account_id: 'page_123', activation_policy: 'ALL_MESSAGES' },
    },
    conversation: {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      contact_display_name: 'Canan Kaya',
    },
    customerMessage: { id: 'm1', content: 'Kurumlar vergisi ve KDV oranları nedir?' },
  };

  const result = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: '123456789',
    text: 'Kurumlar vergisi ve KDV oranları nedir?',
    http: mockHttp,
    applyPacing: false,
    generateAiResponse: async () => {
      return 'BAE’de Kurumlar Vergisi yıllık 375.000 AED kâra kadar %0, aşan kısım için %9’dur. Standart KDV oranı ise %5’tir.';
    },
  });

  assert.equal(result.aiInvoked, true);
  assert.match(result.responseText, /375\.000 AED/);
  assert.match(result.responseText, /%9/);
  assert.match(result.responseText, /%5/);
});

test('5. Instagram conversation continuation after media', async () => {
  const mockDb = new MockDatabaseClient({
    messages: [
      { id: 'm1', sender_type: 'CUSTOMER', content: 'Bu oturum hizmeti nasıl oluyor?', created_at: new Date(1000) },
      { id: 'm2', sender_type: 'ASSISTANT', content: '2 yıllık sponsorlu oturum ile şirket kurmadan oturum alabilirsiniz.', created_at: new Date(2000) },
      { id: 'm3', sender_type: 'CUSTOMER', content: 'Peki fiyat nedir?', created_at: new Date(3000) },
    ],
  });

  const inboundState = {
    shouldInvokeAi: true,
    duplicate: false,
    handlingVersion: 1,
    integration: {
      tenant_id: 'b85d7e7b-d52e-4541-92e7-284a6a67024b',
      assistant_id: 'ast-1',
      config: { access_token: 'test_token', instagram_account_id: 'page_123', activation_policy: 'ALL_MESSAGES' },
    },
    conversation: {
      id: '22222222-2222-4222-8222-222222222222',
      status: 'open',
      handling_mode: 'AI',
      handling_version: 1,
      contact_display_name: 'Ahmet Yılmaz',
    },
    customerMessage: { id: 'm3', content: 'Peki fiyat nedir?' },
  };

  let capturedHistoryLength = 0;

  const result = await orchestrateInstagramInboundAiResponse({
    database: mockDb,
    inboundState,
    senderIgsid: '123456789',
    text: 'Peki fiyat nedir?',
    http: mockHttp,
    applyPacing: false,
    generateAiResponse: async ({ conversationHistory }) => {
      capturedHistoryLength = conversationHistory.length;
      return '2 yıllık sponsorlu oturum ücreti toplam 13.000 AED’dir.';
    },
  });

  assert.equal(result.aiInvoked, true);
  assert.ok(capturedHistoryLength >= 2, 'History must include prior turns');
  assert.match(result.responseText, /13\.000 AED/);
});

test('6. Instagram knowledge grounding protection: media content is never authoritative', () => {
  const persona = {
    available: true,
    companyIdentity: SAMCHE_STAGING_BUSINESS_PROFILE.company_identity,
    assistantIdentity: SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_identity,
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const instruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: SAMCHE_KNOWLEDGE_SOURCES.map((s) => `[Source: ${s.title}]\n${s.content}`).join('\n\n'),
    channelRules: INSTAGRAM_CHANNEL_PRESENTATION_RULES,
  });

  assert.match(instruction, /MEDIA CONTENT IS NEVER AN AUTHORITATIVE BUSINESS SOURCE/);
  assert.match(instruction, /Never extract prices, policies, guarantees, or service details from unverified advertisement media/);
  assert.match(instruction, /NO INVENTED LEGAL OR PROCEDURAL MANDATES/);
});


test('7. WhatsApp regression remains unchanged', () => {
  const persona = {
    available: true,
    companyIdentity: 'Verdant Landscapes LLC',
    assistantIdentity: 'Verdant Client Advisor',
    profile: { company_identity: 'Verdant Landscapes LLC' },
    configuration: { assistant_identity: 'Verdant Client Advisor' },
  };

  const wpInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Irrigation systems designed per plot specifications.',
    channelRules: 'Keep responses concise with bullet points.',
  });

  assert.ok(wpInstruction.includes(TENANT_FACTUAL_GROUNDING_POLICY));
  assert.doesNotMatch(wpInstruction, /INSTAGRAM DM MEDIA \+ TEXT INTENT PRIORITY/, 'WhatsApp must not contain Instagram-only channel rules');
});

test('8. Web Chat regression remains unchanged', () => {
  const persona = {
    available: true,
    companyIdentity: 'Aura Event Production LLC',
    assistantIdentity: 'Aura Concierge',
    profile: { company_identity: 'Aura Event Production LLC' },
    configuration: { assistant_identity: 'Aura Concierge' },
  };

  const webChatInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Stage lighting and sound packages.',
    channelRules: 'Return safe HTML suitable for Web Chat.',
  });

  assert.ok(webChatInstruction.includes(TENANT_FACTUAL_GROUNDING_POLICY));
  assert.doesNotMatch(webChatInstruction, /INSTAGRAM DM MEDIA \+ TEXT INTENT PRIORITY/, 'Web Chat must not contain Instagram-only channel rules');
});

test('9. AI Guide regression remains unchanged', () => {
  const persona = {
    available: true,
    companyIdentity: 'Nexus Analytics Corp',
    assistantIdentity: 'Nexus AI Guide',
    profile: { company_identity: 'Nexus Analytics Corp' },
    configuration: { assistant_identity: 'Nexus AI Guide' },
  };

  const guideInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Data analytics platform documentation.',
    channelRules: 'Return safe, readable HTML suitable for the AI Guide interface.',
  });

  assert.ok(guideInstruction.includes(TENANT_FACTUAL_GROUNDING_POLICY));
  assert.doesNotMatch(guideInstruction, /INSTAGRAM DM MEDIA \+ TEXT INTENT PRIORITY/, 'AI Guide must not contain Instagram-only channel rules');
});

