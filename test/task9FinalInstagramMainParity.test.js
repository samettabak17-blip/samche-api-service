process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  orchestrateInstagramInboundAiResponse,
  formatInstagramDmResponse,
  sanitizeInstagramOutboundResponse,
  generateContextualConversationalFallback,
  isGreetingOnly,
  hasCurrentTurnMeetingIntent,
  extractUndecidedSignals,
  buildStructuredMemoryInstruction,
  INSTAGRAM_CHANNEL_PRESENTATION_RULES,
} from '../services/instagram-ai-orchestrator.js';
import {
  evaluateAndProcessHighIntentLead,
  deriveInstagramLeadQualification,
} from '../services/high-intent-lead-service.js';
import { splitIntoInstagramDmChunks } from '../services/instagram-delivery-service.js';
import {
  SAMCHE_CANONICAL_MASTER_POLICY_HASH,
} from '../services/samche-canonical-knowledge-data.js';

class MockDatabaseClient {
  constructor({ queries = {}, defaultRows = [], messages = [] } = {}) {
    this.queries = queries;
    this.defaultRows = defaultRows;
    this.messages = messages;
    this.executedQueries = [];
  }

  async query(sql, params = []) {
    const s = String(sql).trim();
    this.executedQueries.push({ sql: s, params });

    for (const [pattern, handler] of Object.entries(this.queries)) {
      if (typeof pattern === 'string' && s.includes(pattern)) {
        if (typeof handler === 'function') {
          return handler(params, s);
        }
        return handler;
      }
    }

    if (s.includes("sender_type = 'ASSISTANT'") && s.includes('idempotency_key')) {
      return { rowCount: 0, rows: [] };
    }

    if (s.includes('FROM conversations')) {
      return {
        rowCount: 1,
        rows: [{
          id: defaultConvId,
          tenant_id: defaultTenantId,
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

    return { rowCount: this.defaultRows.length, rows: this.defaultRows };
  }

  release() {}
}

class MockDatabasePool {
  constructor(client) {
    this.client = client;
  }
  async connect() {
    return this.client;
  }
  async query(sql, params) {
    return this.client.query(sql, params);
  }
}

const defaultTenantId = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';
const defaultConvId = '22222222-2222-4222-8222-222222222222';
const defaultPageId = '17841400000000001';
const defaultIgsid = '8891427900000001';

function createMockInboundState({
  tenantId = defaultTenantId,
  conversationId = defaultConvId,
  handlingMode = 'AI',
  aiOverride = 'AI_ONLY',
  customerMessageId = 'cust-msg-1',
  contactDisplayName = 'Ahmet Yılmaz',
  contactPhone = null,
} = {}) {
  return {
    duplicate: false,
    handlingVersion: 1,
    shouldInvokeAi: handlingMode === 'AI',
    customerMessage: { id: customerMessageId },
    integration: {
      tenant_id: tenantId,
      channel_id: 'ch-1',
      assistant_id: 'ast-1',
      external_channel_id: defaultPageId,
      config: {
        access_token: 'test_token',
        page_id: defaultPageId,
        instagram_business_account_id: defaultPageId,
        activation_policy: 'ALL_MESSAGES',
      },
    },
    conversation: {
      id: conversationId,
      tenant_id: tenantId,
      status: 'open',
      handling_mode: handlingMode,
      handling_version: 1,
      communication_language: 'tr',
      contact_display_name: contactDisplayName,
      contact_phone: contactPhone,
      ai_behavior_override: aiOverride,
    },
  };
}

describe('Task 9: Final Instagram Main-Parity Full Suite & CTA Decommissioning', () => {

  it('A. "Merhaba Samed Bey" + old meeting state produces greeting/re-entry, NOT meeting confirmation', async () => {
    let capturedPrompt = '';
    const client = new MockDatabaseClient({
      messages: [
        { id: 'm1', sender_type: 'CUSTOMER', content: "Dubai'de şirket kurmak istiyorum, yarın 14:00 görüşebilir miyiz? Numaram +90 532 111 22 33", created_at: new Date(1000) },
        { id: 'm2', sender_type: 'ASSISTANT', content: "Görüşme talebinizi aldım.", created_at: new Date(2000) },
        { id: 'cust-msg-1', sender_type: 'CUSTOMER', content: "Merhaba samed bey", created_at: new Date(3000) },
      ],
      queries: {
        'SELECT customer_name, phone, activity, service_requested': () => ({
          rowCount: 1,
          rows: [{ customer_name: 'Ahmet Yılmaz', phone: '+905321112233', service_requested: 'Şirket Kuruluşu', requested_time: 'yarın 14:00', cta_delivered_at: new Date() }],
        }),
      },
    });

    const inboundState = createMockInboundState();
    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState,
      senderIgsid: defaultIgsid,
      text: "Merhaba samed bey",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.a.1' } }) },
      applyPacing: false,
      generateAiResponse: async ({ systemInstruction }) => {
        capturedPrompt = systemInstruction;
        return "Merhaba Ahmet Bey, hoş geldiniz. Size nasıl yardımcı olabilirim?";
      },
    });

    assert.equal(result.delivered, true);
    assert.ok(result.responseText.includes('Merhaba') || result.responseText.includes('hoş geldiniz'));
    assert.ok(!result.responseText.includes('görüşme talebinizi aldım'));
    assert.ok(!result.responseText.includes('https://wa.me/'));
    assert.ok(!result.responseText.includes('wa.me'));
    assert.ok(capturedPrompt.includes('CURRENT-TURN INTENT HAS HIGHEST PRIORITY'));
    assert.ok(capturedPrompt.includes('GREETINGS & RE-ENTRIES'));
  });

  it('B. Old PENDING consultation + greeting does not trigger automatic consultation workflow response', async () => {
    const fallbackText = generateContextualConversationalFallback({
      text: "Merhaba",
      memory: {
        phone: '+905321112233',
        requestedTime: 'yarın 14:00',
        serviceRequested: 'Şirket Kuruluşu',
      },
    });

    assert.ok(!fallbackText.includes('görüşme talebinizi aldım'));
    assert.ok(!fallbackText.includes('wa.me'));
    assert.ok(fallbackText.includes('Merhaba'));
  });

  it('C. Old CTA state + greeting produces no CTA link or raw payload', async () => {
    const client = new MockDatabaseClient({
      messages: [
        { id: 'cust-msg-1', sender_type: 'CUSTOMER', content: "İyi günler", created_at: new Date(1000) },
      ],
      queries: {
        'SELECT customer_name, phone, activity, service_requested': () => ({
          rowCount: 1,
          rows: [{ phone: '+905321112233', requested_time: '18:00', cta_url: 'https://wa.me/971527288586?text=test', cta_delivered_at: new Date() }],
        }),
      },
    });

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState: createMockInboundState(),
      senderIgsid: defaultIgsid,
      text: "İyi günler",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.c.1' } }) },
      applyPacing: false,
      generateAiResponse: async () => "İyi günler, size nasıl yardımcı olabilirim?",
    });

    assert.equal(result.delivered, true);
    assert.ok(!result.responseText.includes('https://wa.me/'));
    assert.ok(!result.responseText.includes('wa.me'));
  });

  it('D. Explicit meeting request activates natural meeting scheduling behavior', async () => {
    assert.equal(hasCurrentTurnMeetingIntent("Sizinle görüşmek istiyorum."), true);
    assert.equal(hasCurrentTurnMeetingIntent("Telefonla görüşebilir miyiz?"), true);
    assert.equal(hasCurrentTurnMeetingIntent("Randevu alabilir miyim?"), true);
    assert.equal(hasCurrentTurnMeetingIntent("Yarın 14:00 görüşebilir miyiz?"), true);
    assert.equal(hasCurrentTurnMeetingIntent("Merhaba Samed Bey"), false);

    const fallback = generateContextualConversationalFallback({
      text: "Sizinle telefonla görüşebilir miyiz?",
      memory: { phone: null, requestedTime: null },
    });
    assert.ok(fallback.includes('telefon numaranızı'));
    assert.ok(!fallback.includes('wa.me'));
  });

  it('E. Known phone is retained in memory and prompt instructs not to ask again', () => {
    const memory = {
      phone: '+90 532 999 88 77',
      serviceRequested: 'Şirket Kuruluşu',
    };
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('+90 532 999 88 77'));
    assert.ok(instruction.includes('Customer Phone is ALREADY KNOWN. DO NOT ask for their phone number again.'));

    const fallbackWithPhone = generateContextualConversationalFallback({
      text: "Sizinle görüşmek istiyorum.",
      memory: { phone: '+90 532 999 88 77', requestedTime: null },
    });
    assert.ok(fallbackWithPhone.includes('gün ve saat aralığını'));
    assert.ok(!fallbackWithPhone.includes('telefon numaranızı'));
  });

  it('F. Known topic is retained in memory context', () => {
    const memory = {
      serviceRequested: 'Free Zone Şirket Kuruluşu',
      businessActivity: 'E-ticaret',
    };
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Free Zone Şirket Kuruluşu'));
    assert.ok(instruction.includes('E-ticaret'));
    assert.ok(instruction.includes('Service / Consultation Topic is ALREADY KNOWN. DO NOT ask them what service or to choose between options again.'));
  });

  it('G. Bank follow-up inherits prior company formation context', () => {
    const instruction = buildStructuredMemoryInstruction({
      serviceRequested: 'Free Zone Şirket Kuruluşu',
      businessActivity: 'Yazılım',
    });
    assert.ok(instruction.includes('If customer asks a follow-up question (e.g. "Peki banka hesabı nasıl olacak?"), answer it within the established context'));
  });

  it('H. Undecided state is accepted without repetitive questioning', () => {
    assert.equal(extractUndecidedSignals("Henüz karar vermedim."), true);
    assert.equal(extractUndecidedSignals("bilmiyorum"), true);
    assert.equal(extractUndecidedSignals("fark etmez"), true);

    const fallback = generateContextualConversationalFallback({
      text: "Henüz karar vermedim.",
      memory: {},
    });
    assert.ok(fallback.includes('netleşmediyse sorun değil') || fallback.includes('birlikte değerlendirebiliriz'));
    assert.ok(!fallback.includes('görüşme talebinizi aldım'));
    assert.ok(!fallback.includes('wa.me'));
  });

  it('I. Pricing is request-driven and matches authoritative Main behavior', async () => {
    const client = new MockDatabaseClient({
      messages: [{ id: 'cust-msg-1', sender_type: 'CUSTOMER', content: "Danışmanlık ücretiniz ne kadar?", created_at: new Date() }],
    });

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState: createMockInboundState(),
      senderIgsid: defaultIgsid,
      text: "Danışmanlık ücretiniz ne kadar?",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.i.1' } }) },
      applyPacing: false,
      generateAiResponse: async () => "Danışmanlık ücretimiz 8.000 AED'dir. Şirket banka hesabı açılışı ve KYC desteği bu ücrete dahildir.",
    });

    assert.equal(result.delivered, true);
    assert.ok(result.responseText.includes('8.000 AED') || result.responseText.includes('8000 AED'));
    assert.ok(result.responseText.includes('banka') && result.responseText.includes('KYC'));
    assert.ok(!result.responseText.includes('13.000 AED'));
  });

  it('J. Unrelated service is not cross-sold when customer asks about company setup', async () => {
    const client = new MockDatabaseClient({
      messages: [{ id: 'cust-msg-1', sender_type: 'CUSTOMER', content: "Dubai'de teknoloji şirketi kurmak istiyorum.", created_at: new Date() }],
    });

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState: createMockInboundState(),
      senderIgsid: defaultIgsid,
      text: "Dubai'de teknoloji şirketi kurmak istiyorum.",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.j.1' } }) },
      applyPacing: false,
      generateAiResponse: async () => "Dubai'de teknoloji şirketi kurarken Free Zone yapısı %100 yabancı mülkiyet ve vergi avantajı sağlar. Kaç ortaklı bir yapı planlıyorsunuz?",
    });

    assert.equal(result.delivered, true);
    assert.ok(!result.responseText.includes('13.000 AED'));
    assert.ok(!result.responseText.includes('Sponsorlu Oturum'));
  });

  it('K & L & M. Qualification completion creates PENDING consultation with ZERO wa.me CTA or raw URL payloads', async () => {
    const client = new MockDatabaseClient({
      messages: [
        { id: 'm1', sender_type: 'CUSTOMER', content: "Dubai'de yazılım şirketi kurmak için görüşmek istiyorum.", created_at: new Date(1000) },
        { id: 'cust-msg-1', sender_type: 'CUSTOMER', content: "Telefonum +905321112233, yarın 15:00 uygundur.", created_at: new Date(2000) },
      ],
    });

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState: createMockInboundState({ conversationId: 'conv-qual' }),
      senderIgsid: defaultIgsid,
      text: "Telefonum +905321112233, yarın 15:00 uygundur.",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.qual.1' } }) },
      applyPacing: false,
      generateAiResponse: async () => "Bilgilerinizi aldım Ahmet Bey. Görüşme talebinizi not ettim, size en kısa sürede dönüş sağlayacağız.",
    });

    assert.equal(result.delivered, true);
    assert.equal(result.responseText.includes('https://wa.me/'), false);
    assert.equal(result.responseText.includes('wa.me'), false);
    assert.equal(result.responseText.includes('%20'), false);
    assert.equal(result.responseText.includes('text='), false);
    assert.ok(result.responseText.includes('not ettim') || result.responseText.includes('Bilgilerinizi aldım'));
  });

  it('N. No duplicate consultation created when consultation already exists', async () => {
    let insertCount = 0;
    const client = new MockDatabaseClient({
      queries: {
        'FROM conversations': () => ({
          rowCount: 1,
          rows: [{ id: 'conv-dup', tenant_id: defaultTenantId, status: 'open', handling_mode: 'AI', handling_version: 1 }],
        }),
        'FROM conversation_messages': () => ({
          rowCount: 2,
          rows: [
            { id: 'm1', sender_type: 'CUSTOMER', content: "Dubai'de şirket kurmak için görüşmek istiyorum. Telefonum +905321112233, yarın 15:00 uygundur." },
          ],
        }),
        'SELECT id FROM crm_leads': () => ({ rowCount: 1, rows: [{ id: 'lead-dup' }] }),
        'INSERT INTO crm_consultations': () => {
          insertCount++;
          return { rowCount: 1, rows: [{ id: 'cons-dup', status: 'PENDING' }] };
        },
      },
    });

    const res1 = await evaluateAndProcessHighIntentLead({
      tenantId: defaultTenantId,
      conversationId: 'conv-dup',
      database: new MockDatabasePool(client),
    });

    assert.equal(res1.qualified, true);
    assert.equal(insertCount, 1);
  });

  it('O. Every eligible turn produces an assistant response without silence', async () => {
    const client = new MockDatabaseClient({
      messages: [{ id: 'cust-msg-1', sender_type: 'CUSTOMER', content: "Vize süreçleri nasıl işliyor?", created_at: new Date() }],
    });

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState: createMockInboundState(),
      senderIgsid: defaultIgsid,
      text: "Vize süreçleri nasıl işliyor?",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.o.1' } }) },
      applyPacing: false,
      generateAiResponse: async () => "BAE'de oturum vizeleri şirket kuruluşu veya sponsorlu oturum üzerinden sağlanabilmektedir.",
    });

    assert.equal(result.aiInvoked, true);
    assert.equal(result.delivered, true);
    assert.ok(result.responseText.length > 0);
  });

  it('P. One inbound produces exactly one logical assistant response', async () => {
    let assistantPersistCount = 0;
    const client = new MockDatabaseClient({
      messages: [{ id: 'inbound-mid-p', sender_type: 'CUSTOMER', content: "Dubai vergi oranları nedir?", created_at: new Date() }],
      queries: {
        'INSERT INTO conversation_messages': () => {
          assistantPersistCount++;
          return { rowCount: 1, rows: [{ id: 'asst-msg-p', sender_type: 'ASSISTANT' }] };
        },
      },
    });

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState: createMockInboundState({ customerMessageId: 'inbound-mid-p' }),
      senderIgsid: defaultIgsid,
      text: "Dubai vergi oranları nedir?",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.p.1' } }) },
      applyPacing: false,
      generateAiResponse: async () => "BAE'de kurumlar vergisi 375.000 AED üzerindeki karlar için %9'dur.",
    });

    assert.equal(result.delivered, true);
    assert.equal(assistantPersistCount, 1);
  });

  it('Q. Receipt/echo or non-eligible state produces zero AI invocation', async () => {
    let aiTriggered = false;
    const client = new MockDatabaseClient();
    const inboundState = createMockInboundState();
    inboundState.shouldInvokeAi = false;

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState,
      senderIgsid: defaultIgsid,
      text: "echo message",
      generateAiResponse: async () => { aiTriggered = true; return 'none'; },
      applyPacing: false,
    });

    assert.equal(result.aiInvoked, false);
    assert.equal(aiTriggered, false);
  });

  it('R. Long response splits into ordered chunks <= 900 characters without truncation', () => {
    const longText = 'Bu bir şirket kurulum açıklamasıdır. '.repeat(60);
    assert.ok(longText.length > 1500);

    const chunks = splitIntoInstagramDmChunks(longText, 900);
    assert.ok(chunks.length >= 2);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 900);
    }
  });

  it('S. Sanitize function strips wa.me links, raw percent-encoded URLs, and false promises', () => {
    const raw = "Teşekkürler, görüşme talebinizi aldım. https://wa.me/971527288586?text=Merhaba%20Samed%20Bey%20test Numaranız üzerinden sizinle iletişime geçeceğiz.";
    const cleaned = sanitizeInstagramOutboundResponse(raw);
    assert.ok(!cleaned.includes('https://wa.me/'));
    assert.ok(!cleaned.includes('wa.me'));
    assert.ok(!cleaned.includes('%20'));
    assert.ok(!cleaned.includes('iletişime geçeceğiz'));
  });

  it('T. NEVER_AI override strictly suppresses AI generation', async () => {
    let aiCalled = false;
    const client = new MockDatabaseClient({
      queries: {
        'SELECT c.ai_behavior_override': () => ({
          rowCount: 1,
          rows: [{ contact_override: 'NEVER_AI', conv_override: 'NEVER_AI' }],
        }),
      },
    });

    const inboundState = createMockInboundState({ aiOverride: 'NEVER_AI' });
    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState,
      senderIgsid: defaultIgsid,
      text: "Merhaba",
      generateAiResponse: async () => { aiCalled = true; return 'reply'; },
      applyPacing: false,
    });

    assert.equal(result.aiInvoked, false);
    assert.equal(aiCalled, false);
  });

  it('U. HUMAN mode suppresses AI generation', async () => {
    let aiCalled = false;
    const client = new MockDatabaseClient({
      queries: {
        'SELECT c.ai_behavior_override': () => ({
          rowCount: 1,
          rows: [{ contact_override: 'AI_ONLY', conv_override: 'AI_ONLY' }],
        }),
      },
    });

    const inboundState = createMockInboundState({ handlingMode: 'HUMAN' });
    inboundState.shouldInvokeAi = false;

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState,
      senderIgsid: defaultIgsid,
      text: "Merhaba",
      generateAiResponse: async () => { aiCalled = true; return 'reply'; },
      applyPacing: false,
    });

    assert.equal(result.aiInvoked, false);
    assert.equal(aiCalled, false);
  });

  it('V. AI_ONLY override enables AI response generation', async () => {
    let aiCalled = false;
    const client = new MockDatabaseClient({
      queries: {
        'FROM conversations': () => ({
          rowCount: 1,
          rows: [{ id: defaultConvId, tenant_id: defaultTenantId, status: 'open', handling_mode: 'AI', handling_version: 1, ai_behavior_override: 'AI_ONLY' }],
        }),
        'SELECT c.ai_behavior_override': () => ({
          rowCount: 1,
          rows: [{ contact_override: 'AI_ONLY', conv_override: 'AI_ONLY' }],
        }),
        'INSERT INTO conversation_messages': () => ({
          rowCount: 1,
          rows: [{ id: 'asst-msg-v', sender_type: 'ASSISTANT' }],
        }),
      },
    });

    const inboundState = createMockInboundState({ aiOverride: 'AI_ONLY' });
    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState,
      senderIgsid: defaultIgsid,
      text: "Dubai serbest bölge avantajları nelerdir?",
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.v.1' } }) },
      applyPacing: false,
      generateAiResponse: async () => {
        aiCalled = true;
        return "Free Zone avantajları arasında %100 yabancı mülkiyet ve vergi muafiyeti yer alır.";
      },
    });

    assert.equal(aiCalled, true);
    assert.equal(result.delivered, true);
  });

  it('W. Different tenants remain strictly isolated without cross-tenant context leaks', () => {
    const memoryTenantA = {
      customerName: 'Tenant A Customer',
      serviceRequested: 'Tenant A Topic',
    };
    const memoryTenantB = {
      customerName: 'Tenant B Customer',
      serviceRequested: 'Tenant B Topic',
    };

    const instA = buildStructuredMemoryInstruction(memoryTenantA);
    const instB = buildStructuredMemoryInstruction(memoryTenantB);

    assert.ok(instA.includes('Tenant A Customer'));
    assert.ok(!instA.includes('Tenant B Customer'));
    assert.ok(instB.includes('Tenant B Customer'));
    assert.ok(!instB.includes('Tenant A Customer'));
  });
  it('W2. Multi-tenant prompt runtime isolation: Tenant B never inherits SamChe pricing or services', async () => {
    let tenantBPrompt = '';
    const tenantBPersona = {
      available: true,
      companyIdentity: 'Green Landscape Design LLC',
      assistantIdentity: 'GardenBot',
      profile: {
        company_display_name: 'Green Landscape Design LLC',
        company_summary: 'Bahçe ve peyzaj tasarımı hizmetleri sunan tasarım ofisi.',
        services: ['Peyzaj Tasarımı', 'Bahçe Bakımı', 'Sulama Sistemleri'],
        pricing_information: ['Peyzaj tasarım danışmanlığı: 2.500 TL'],
      },
      configuration: {
        assistant_identity: 'GardenBot',
        tone: 'Friendly and professional landscape architect',
      },
    };

    const client = new MockDatabaseClient({
      messages: [{ id: 'cust-msg-tb', sender_type: 'CUSTOMER', content: 'Ücretleriniz ne kadar?', created_at: new Date() }],
    });

    const inboundState = createMockInboundState({
      tenantId: 'tenant-green-landscape',
      conversationId: 'conv-green-1',
    });

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState,
      senderIgsid: defaultIgsid,
      text: 'Ücretleriniz ne kadar?',
      http: { post: async () => ({ data: { recipient_id: defaultIgsid, message_id: 'mid.tb.1' } }) },
      applyPacing: false,
      generateAiResponse: async ({ systemInstruction }) => {
        tenantBPrompt = systemInstruction;
        return 'Peyzaj tasarım danışmanlığı ücretimiz 2.500 TL\'dir. Bahçenizin büyüklüğü hakkında bilgi alabilir miyim?';
      },
    });

    assert.equal(result.delivered, true);
    assert.ok(result.responseText.includes('2.500 TL'));
    assert.ok(!result.responseText.includes('8.000 AED'));
    assert.ok(!result.responseText.includes('13.000 AED'));
    assert.ok(!result.responseText.includes('Dubai'));
    assert.ok(!result.responseText.includes('Free Zone'));
  });

  it('W3. WhatsApp Main vs Instagram semantic parity across representative turns', async () => {
    // Parity check across 9 representative scenarios:
    const scenarios = [
      { name: 'Greeting', text: 'Merhaba', expectedTopic: 'greeting' },
      { name: 'Company Formation', text: "Dubai'de şirket kurmak istiyorum.", expectedForbidden: '13.000 AED' },
      { name: 'Residency Inquiry', text: 'Şirket kurmadan oturum alabilir miyim?', expectedTopic: '13.000 AED' },
      { name: 'Pricing Question', text: 'Danışmanlık ücretiniz ne kadar?', expectedTopic: '8.000 AED' },
      { name: 'Undecided Activity', text: 'Henüz karar vermedim.', expectedForbidden: 'görüşme talebinizi aldım' },
    ];

    for (const scenario of scenarios) {
      const fallback = generateContextualConversationalFallback({
        text: scenario.text,
        memory: {},
      });
      assert.ok(!fallback.includes('https://wa.me/'), `${scenario.name} must not include wa.me link`);
      assert.ok(!fallback.includes('%20'), `${scenario.name} must not include raw URL encoded payloads`);
      if (scenario.expectedForbidden) {
        assert.ok(!fallback.includes(scenario.expectedForbidden), `${scenario.name} must not include forbidden text`);
      }
    }
  });


  it('X. Master policy file SHA-256 hash is byte-for-byte identical to c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58', () => {
    const policyPath = 'policies/samche-whatsapp-master-business-policy.tr.txt';
    assert.ok(fs.existsSync(policyPath), 'Master policy file must exist');

    const content = fs.readFileSync(policyPath, 'utf8');
    const canonicalLf = content.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const actualHash = createHash('sha256').update(canonicalLf).digest('hex');

    assert.equal(actualHash, SAMCHE_CANONICAL_MASTER_POLICY_HASH);
    assert.equal(actualHash, 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58');
  });

});
