import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  orchestrateInstagramInboundAiResponse,
  INSTAGRAM_CHANNEL_PRESENTATION_RULES,
} from '../services/instagram-ai-orchestrator.js';
import { hasHighIntentAppointmentSignals } from '../services/high-intent-lead-service.js';

describe('Task 9: Real Instagram Outbound Delivery & Natural Appointment Qualification', () => {

  it('A & D: Inbound message generates AI response, invokes canonical delivery, and persists provider MID as SENT', async () => {
    const executedQueries = [];
    const httpCalls = [];

    const mockDatabase = {
      connect: async () => mockDatabase,
      release: () => {},
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        if (/FROM conversations/i.test(sql)) {
          return { rows: [{ id: 'conv-123', status: 'open', handling_mode: 'AI', handling_version: 1 }], rowCount: 1 };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          return { rows: [{ id: 'msg-assist-1', sender_type: 'ASSISTANT', content: params?.[3] || '' }], rowCount: 1 };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: 'Samed bey merhabalar' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mockHttp = {
      post: async (url, payload, options) => {
        httpCalls.push({ url, payload, options });
        return {
          status: 200,
          data: { message_id: 'mid.ig.canonical.12345' },
        };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      integration: {
        tenant_id: 'tenant-123',
        assistant_id: 'ast-1',
        external_channel_id: '17841474291887372',
        config: {
          access_token: 'EAAB_test_token',
          instagram_account_id: '17841474291887372',
          activation_policy: 'ALL_MESSAGES',
        },
      },
      conversation: {
        id: 'conv-123',
        tenant_id: 'tenant-123',
        customer_external_id: 'instagram:10203040',
        contact_display_name: 'Suleyman Isseven (@suleyman_isseven)',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
      },
      shouldInvokeAi: true,
    };

    let aiGenerated = false;
    const generateAiResponse = async () => {
      aiGenerated = true;
      return 'Merhaba, şirket kuruluşu detaylarını planlamak adına iletişim numaranızı paylaşabilir misiniz?';
    };

    const result = await orchestrateInstagramInboundAiResponse({
      database: mockDatabase,
      inboundState,
      senderIgsid: '10203040',
      text: 'Samed bey merhabalar',
      http: mockHttp,
      generateAiResponse,
      applyPacing: false,
    });

    assert.equal(aiGenerated, true, 'AI generation must be invoked');
    assert.equal(result.aiInvoked, true);
    assert.equal(result.delivered, true);
    assert.equal(result.deliveryResult?.providerMessageId, 'mid.ig.canonical.12345');
    const deliveryCalls = httpCalls.filter(c => c.payload?.message?.text);
    assert.equal(deliveryCalls.length, 1, 'Delivery endpoint must be called exactly once');
    assert.equal(deliveryCalls[0].payload.recipient.id, '10203040');

    const sentUpdate = executedQueries.find(q => /UPDATE conversation_messages/i.test(q.sql) && q.sql.includes("'SENT'"));
    assert.ok(sentUpdate, 'delivery_status must be updated to SENT');
    assert.equal(sentUpdate.params[0], 'mid.ig.canonical.12345');
  });
  it('B & G: High-intent appointment message uses normal Instagram delivery and does not suppress reply', async () => {
    const text = 'Samed bey merhabalar . Dubaide şirket kurmak istiyoruz sizinle müsait zamanda görüşmemiz mümkün mü?';
    assert.equal(hasHighIntentAppointmentSignals(text), true, 'Must detect appointment signal');

    const executedQueries = [];
    const httpCalls = [];
    const mockHttp = {
      post: async (url, payload) => {
        httpCalls.push({ url, payload });
        return { status: 200, data: { message_id: 'mid.ig.appointment.999' } };
      },
    };

    const mockDatabase = {
      connect: async () => mockDatabase,
      release: () => {},
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        if (/FROM conversations/i.test(sql)) {
          return { rows: [{ id: 'conv-123', status: 'open', handling_mode: 'AI', handling_version: 1 }], rowCount: 1 };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          return { rows: [{ id: 'msg-assist-1', sender_type: 'ASSISTANT', content: params?.[3] || '' }], rowCount: 1 };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: text }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      integration: {
        tenant_id: 'tenant-123',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: {
        id: 'conv-123',
        tenant_id: 'tenant-123',
        customer_external_id: 'instagram:10203040',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
      },
      shouldInvokeAi: true,
    };

    const result = await orchestrateInstagramInboundAiResponse({
      database: mockDatabase,
      inboundState,
      senderIgsid: '10203040',
      text,
      http: mockHttp,
      generateAiResponse: async () => 'Merhaba, randevu için iletişim numaranızı paylaşabilir misiniz?',
      applyPacing: false,
    });

    assert.equal(result.delivered, true);
    const deliveryCalls = httpCalls.filter(c => c.payload?.message?.text);
    assert.equal(deliveryCalls.length, 1, 'Outbound Instagram delivery must not be skipped for appointments');
    assert.equal(result.deliveryResult.providerMessageId, 'mid.ig.appointment.999');
  });

  it('C: Provider delivery failure marks conversation_messages as FAILED with error code and no fake MID', async () => {
    const executedQueries = [];
    const mockDatabase = {
      connect: async () => mockDatabase,
      release: () => {},
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        if (/FROM conversations/i.test(sql)) {
          return { rows: [{ id: 'conv-123', status: 'open', handling_mode: 'AI', handling_version: 1 }], rowCount: 1 };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          return { rows: [{ id: 'msg-assist-1', sender_type: 'ASSISTANT', content: params?.[3] || '' }], rowCount: 1 };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: 'Merhabalar' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mockHttp = {
      post: async () => {
        const err = new Error('Meta API error: (#100) Invalid recipient');
        err.response = {
          status: 400,
          data: { error: { message: 'Invalid recipient', code: 100 } },
        };
        throw err;
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      integration: {
        tenant_id: 'tenant-123',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: {
        id: 'conv-123',
        tenant_id: 'tenant-123',
        customer_external_id: 'instagram:invalid_recipient',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
      },
      shouldInvokeAi: true,
    };

    const result = await orchestrateInstagramInboundAiResponse({
      database: mockDatabase,
      inboundState,
      senderIgsid: 'invalid_recipient',
      text: 'Merhabalar',
      http: mockHttp,
      generateAiResponse: async () => 'Size nasıl yardımcı olabilirim?',
      applyPacing: false,
    });

    assert.equal(result.delivered, false, 'Delivery must be marked false');
    assert.ok(result.deliveryError, 'Delivery error must be recorded');

    const failUpdate = executedQueries.find(q => /UPDATE conversation_messages/i.test(q.sql) && q.params?.[0] === 'META_IG_ERROR_100');
    assert.ok(failUpdate, 'Must execute UPDATE with FAILED delivery status');
    assert.equal(failUpdate.params[0], 'META_IG_ERROR_100', 'Must store sanitized Meta failure code');
  });

  it('E & F: Appointment rules prohibit unsolicited residency/visa questions for company formation', () => {
    const rules = Array.isArray(INSTAGRAM_CHANNEL_PRESENTATION_RULES) ? INSTAGRAM_CHANNEL_PRESENTATION_RULES : [String(INSTAGRAM_CHANNEL_PRESENTATION_RULES)];
    assert.ok(rules.some(r => r.includes('DO NOT proactively ask or introduce residency/visa questions')), 'Must prohibit proactive visa questions');
    assert.ok(rules.some(r => r.includes('reference library')), 'Must clarify Knowledge scope');
  });

  it('H: NEVER_AI suppression produces 0 AI generations and 0 Instagram outbound calls', async () => {
    let aiCalled = false;
    const httpCalls = [];

    const mockHttp = {
      post: async (url) => {
        httpCalls.push(url);
        return { status: 200, data: {} };
      },
    };

    const inboundState = {
      duplicate: false,
      integration: {
        tenant_id: 'tenant-123',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token' },
      },
      conversation: {
        id: 'conv-never',
        tenant_id: 'tenant-123',
        customer_external_id: 'instagram:suleyman_isseven',
        ai_behavior_override: 'NEVER_AI',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
      },
      shouldInvokeAi: false,
    };

    const result = await orchestrateInstagramInboundAiResponse({
      database: { query: async () => ({ rows: [] }) },
      inboundState,
      senderIgsid: 'suleyman_isseven',
      text: 'Samed bey merhabalar',
      http: mockHttp,
      generateAiResponse: async () => {
        aiCalled = true;
        return 'Response';
      },
    });

    assert.equal(aiCalled, false, 'AI must not be generated');
    assert.equal(httpCalls.length, 0, 'No outbound calls must be made');
    assert.equal(result.aiInvoked, false);
  });
  it('TEST C & D & E: Qualification collects phone, availability, and sends structured WhatsApp notification', async () => {
    const executedQueries = [];
    const httpCalls = [];

    const mockDatabase = {
      connect: async () => mockDatabase,
      release: () => {},
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        if (/FROM conversations/i.test(sql)) {
          return {
            rows: [{
              id: 'conv-qual-1',
              tenant_id: 'tenant-123',
              channel_id: 'chan-ig-1',
              customer_external_id: 'instagram:10203040',
              contact_id: 'contact-1',
              channel_type: 'INSTAGRAM',
              contact_name: 'Ahmet Yılmaz',
              contact_phone: null,
            }],
            rowCount: 1,
          };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return {
            rows: [
              { id: 'm1', sender_type: 'CUSTOMER', content: 'Samed Bey merhaba, Dubai\'de e-ticaret şirketi kurmak istiyoruz sizinle görüşebilir miyiz?' },
              { id: 'm2', sender_type: 'ASSISTANT', content: 'Merhaba, tabii ki görüşebiliriz. Size ulaşabileceğimiz telefon veya WhatsApp numaranızı paylaşabilir misiniz?' },
              { id: 'm3', sender_type: 'CUSTOMER', content: 'Telefon numaram +905321112233, yarın Dubai saatiyle 15:00 uygunum.' },
            ],
            rowCount: 3,
          };
        }
        if (/SELECT id FROM crm_leads/i.test(sql)) {
          return { rows: [{ id: 'lead-canonical-777' }], rowCount: 1 };
        }
        if (/INSERT INTO crm_consultations/i.test(sql)) {
          return {
            rows: [{
              id: 'cons-canonical-777',
              tenant_id: 'tenant-123',
              conversation_id: 'conv-qual-1',
              status: 'PENDING',
              customer_name: 'Ahmet Yılmaz',
              phone: '+905321112233',
            }],
            rowCount: 1,
          };
        }
        if (/integration_type.*INSTAGRAM/i.test(sql)) {
          return {
            rows: [{
              ig_config: {
                lead_whatsapp_destination: '+971527288586',
                lead_notification_enabled: true,
                lead_notification_template: { status: 'APPROVED', name: 'instagram_qualified_lead', language_code: 'tr' },
              },
            }],
            rowCount: 1,
          };
        }
        if (/integration_type.*WHATSAPP/i.test(sql)) {
          return {
            rows: [{
              external_channel_id: '10987654321',
              wa_config: {
                phone_number_id: '10987654321',
                access_token: 'EAAB_test_wa_token',
              },
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const mockHttp = {
      post: async (url, payload, options) => {
        httpCalls.push({ url, payload, options });
        return { status: 200, data: { messages: [{ id: 'wamid.HBgL...' }] } };
      },
    };

    const { evaluateAndProcessHighIntentLead } = await import('../services/high-intent-lead-service.js');
    const outcome = await evaluateAndProcessHighIntentLead({
      tenantId: 'tenant-123',
      conversationId: 'conv-qual-1',
      database: mockDatabase,
      httpClient: mockHttp,
      env: {
        WHATSAPP_PHONE_NUMBER_ID: '10987654321',
        WHATSAPP_TOKEN: 'EAAB_test_wa_token',
      },
    });

    assert.equal(outcome.qualified, true, 'Lead must be qualified');
    assert.equal(outcome.leadDetails.phone, '+905321112233', 'Customer phone must be extracted');
    assert.ok(outcome.leadDetails.requestedTime.includes('15:00'), 'Appointment time must be extracted');
    assert.ok(outcome.leadDetails.timezone.toLowerCase().includes('dubai'), 'Timezone must be extracted');

    // Verify contact phone update
    const contactUpdate = executedQueries.find(q => /UPDATE crm_contacts/i.test(q.sql) && q.params?.[0] === '+905321112233');
    assert.ok(contactUpdate, 'Must update crm_contacts.phone');

    // Verify customer-initiated WhatsApp CTA generated and ZERO server-side WhatsApp messages sent
    assert.equal(httpCalls.length, 0, 'ZERO server-side WhatsApp messages must be sent');
    assert.ok(outcome.ctaUrl.startsWith('https://wa.me/971527288586?text='));
    assert.ok(outcome.ctaUrl.includes('Ahmet%20Y%C4%B1lmaz'));
    assert.equal(outcome.consultation?.status, 'PENDING');
  });

  it('TEST I: Instagram Ad lead preserves source attribution as Instagram Ad', async () => {
    const { formatInternalWhatsAppLeadNotification } = await import('../services/high-intent-lead-service.js');
    const text = formatInternalWhatsAppLeadNotification({
      customerName: 'Can Demir',
      instagramUsername: 'candemir',
      phone: '+905441112233',
      source: 'Instagram Ad',
      requestedTime: 'Pazartesi 14:00',
    });
    assert.ok(text.includes('Kaynak: INSTAGRAM_AD') || text.includes('Kaynak: Instagram Ad') || text.includes('Instagram Ad'), 'Must preserve Instagram Ad source attribution');
  });

  it('TEST F & G & H: Presentation rules enforce conversational Samed-voice without fake confirmation or handoff', () => {
    const rules = Array.isArray(INSTAGRAM_CHANNEL_PRESENTATION_RULES) ? INSTAGRAM_CHANNEL_PRESENTATION_RULES : [String(INSTAGRAM_CHANNEL_PRESENTATION_RULES)];
    assert.ok(rules.some(r => r.includes('Internal escalation') || r.includes('The customer initiates WhatsApp contact themselves')));
    assert.ok(rules.some(r => r.includes('NEVER say "Randevunuz kesinleşti."')));
    assert.ok(rules.some(r => r.includes('stiff or corporate artificial phrases') || r.includes('FORBIDDEN CORPORATE')));
    assert.ok(rules.some(r => r.includes("Danışmanlık ücretimiz 8.000 AED'dir")));
  });
  it('TEST 1: Generic intent signal ("Samed Bey ile görüşmek istiyorum") does not trigger HOT lead or WhatsApp notification', async () => {
    const httpCalls = [];
    const mockDatabase = {
      connect: async () => mockDatabase,
      release: () => {},
      query: async (sql, params) => {
        if (/FROM conversations/i.test(sql)) {
          return { rows: [{ id: 'conv-t1', tenant_id: 't-1', channel_id: 'ch-1', customer_external_id: 'instagram:user1' }], rowCount: 1 };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rows: [{ id: 'm1', sender_type: 'CUSTOMER', content: 'Samed Bey ile görüşmek istiyorum.' }], rowCount: 1 };
        }
        if (/SELECT id FROM crm_leads/i.test(sql)) {
          return { rows: [{ id: 'lead-t1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const { evaluateAndProcessHighIntentLead } = await import('../services/high-intent-lead-service.js');
    const outcome = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-t1',
      database: mockDatabase,
      httpClient: { post: async (...args) => httpCalls.push(args) },
    });

    assert.equal(outcome.qualified, false, 'Generic request must NOT be qualified');
    assert.equal(outcome.reason, 'QUALIFICATION_INCOMPLETE_AWAITING_REQUIREMENT');
    assert.equal(httpCalls.length, 0, 'WhatsApp notification count must be 0');
  });

  it('TEST 2 & 3: Requirement stated ("Dubai\'de şirket kuracağım") without phone/time remains incomplete with 0 notifications', async () => {
    const httpCalls = [];
    const mockDatabase = {
      connect: async () => mockDatabase,
      release: () => {},
      query: async (sql) => {
        if (/FROM conversations/i.test(sql)) {
          return { rows: [{ id: 'conv-t2', tenant_id: 't-1', channel_id: 'ch-1', customer_external_id: 'instagram:user2' }], rowCount: 1 };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return {
            rows: [
              { id: 'm1', sender_type: 'CUSTOMER', content: 'Samed Bey ile görüşmek istiyorum.' },
              { id: 'm2', sender_type: 'ASSISTANT', content: 'Tabii, nasıl bir şirket kurmayı düşünüyorsunuz?' },
              { id: 'm3', sender_type: 'CUSTOMER', content: 'Dubai\'de şirket kuracağım, e-ticaret faaliyeti.' },
            ],
            rowCount: 3,
          };
        }
        if (/SELECT id FROM crm_leads/i.test(sql)) {
          return { rows: [{ id: 'lead-t2' }], rowCount: 1 };
        }
        if (/INSERT INTO crm_consultations/i.test(sql)) {
          return {
            rows: [{
              id: 'cons-t2',
              tenant_id: 'tenant-123',
              conversation_id: 'conv-t2',
              status: 'PENDING',
              customer_name: 'Ahmet Yılmaz',
              phone: '+905321112233',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const { evaluateAndProcessHighIntentLead } = await import('../services/high-intent-lead-service.js');
    const outcome = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-t2',
      database: mockDatabase,
      httpClient: { post: async (...args) => httpCalls.push(args) },
    });

    assert.equal(outcome.qualified, false, 'Requirement without phone/time must remain incomplete');
    assert.equal(outcome.reason, 'QUALIFICATION_INCOMPLETE_AWAITING_PHONE');
    assert.equal(httpCalls.length, 0, 'WhatsApp notification count must be 0');
  });

  it('TEST 4 & 5: Fully answered qualification creates 1 PENDING consultation and customer-initiated WhatsApp CTA without server-side WhatsApp messages', async () => {
    const httpCalls = [];
    const executedQueries = [];
    const mockDatabase = {
      connect: async () => mockDatabase,
      release: () => {},
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        if (/FROM conversations/i.test(sql)) {
          return {
            rows: [{
              id: 'conv-t5',
              tenant_id: 't-1',
              channel_id: 'ch-1',
              customer_external_id: 'instagram:user5',
              contact_id: 'ct-5',
              contact_name: 'Merve Kaya',
            }],
            rowCount: 1,
          };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return {
            rows: [
              { id: 'm1', sender_type: 'CUSTOMER', content: 'Samed Bey merhaba, danışmanlık almak istiyorum.' },
              { id: 'm2', sender_type: 'ASSISTANT', content: 'Merhaba, Dubai\'de hangi sektörde faaliyet göstermeyi planlıyorsunuz?' },
              { id: 'm3', sender_type: 'CUSTOMER', content: 'Yazılım ve teknoloji danışmanlığı üzerine Free Zone şirket kurmak istiyoruz.' },
              { id: 'm4', sender_type: 'ASSISTANT', content: 'Harika. Size ulaşabileceğimiz telefon veya WhatsApp numaranızı paylaşabilir misiniz?' },
              { id: 'm5', sender_type: 'CUSTOMER', content: 'Numaram +905554443322, pazartesi 14:00 uygunum.' },
            ],
            rowCount: 5,
          };
        }
        if (/SELECT id FROM crm_leads/i.test(sql)) {
          return { rows: [{ id: 'lead-t5' }], rowCount: 1 };
        }
        if (/INSERT INTO crm_consultations/i.test(sql)) {
          return {
            rows: [{
              id: 'cons-t5',
              tenant_id: 't-1',
              conversation_id: 'conv-t5',
              status: 'PENDING',
              customer_name: 'Merve Kaya',
              phone: '+905554443322',
              service_requested: 'Free Zone Şirket Kuruluşu',
              requested_time: 'pazartesi 14:00',
              cta_destination: '+971527288586',
              cta_url: 'https://wa.me/971527288586?text=test',
            }],
            rowCount: 1,
          };
        }
        if (/integration_type.*INSTAGRAM/i.test(sql)) {
          return {
            rows: [{
              ig_config: {
                qualified_lead_contact_cta: {
                  enabled: true,
                  destination: '+971527288586',
                  contact_name: 'Samed Bey',
                },
              },
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const { evaluateAndProcessHighIntentLead } = await import('../services/high-intent-lead-service.js');
    const outcome = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-t5',
      database: mockDatabase,
      httpClient: { post: async (url, payload) => { httpCalls.push({ url, payload }); return { status: 200, data: {} }; } },
      env: { WHATSAPP_PHONE_NUMBER_ID: '10987654321', WHATSAPP_TOKEN: 'EAAB_token' },
    });

    assert.equal(outcome.qualified, true, 'Fully qualified lead must be qualified');
    assert.equal(outcome.leadDetails.phone, '+905554443322');
    assert.ok(outcome.leadDetails.requestedTime.includes('14:00'));
    assert.equal(httpCalls.length, 0, 'ZERO server-side WhatsApp Cloud API calls must be made');
    assert.ok(outcome.ctaUrl.startsWith('https://wa.me/971527288586?text='));
    assert.equal(outcome.consultation?.status, 'PENDING');

    // Verify lead updated to HOT APPOINTMENT_REQUEST
    const hotLeadUpdate = executedQueries.find(q => /UPDATE crm_leads/i.test(q.sql) && q.sql.includes("'HOT'"));
    assert.ok(hotLeadUpdate, 'Must update CRM lead to HOT APPOINTMENT_REQUEST');

    // Verify consultation inserted with PENDING status
    const consultInsert = executedQueries.find(q => /INSERT INTO crm_consultations/i.test(q.sql));
    assert.ok(consultInsert, 'Must create 1 PENDING consultation in crm_consultations');
  });

  it('Deterministic CTA prefilled text contains structured fields without LLM calls', async () => {
    const { buildQualifiedLeadWhatsAppPrefilledMessage, generateCustomerInitiatedWhatsAppCtaUrl } = await import('../services/high-intent-lead-service.js');
    const text = buildQualifiedLeadWhatsAppPrefilledMessage({
      customerName: 'Ahmet Soysal',
      instagramUsername: 'samchetravel',
      phone: '+90 531 240 49 65',
      requirement: "Dubai'de yazılım şirketi kurulumu",
      requestedTime: 'Bugün 18:00',
      contactName: 'Samed Bey',
    });

    assert.ok(text.includes('Merhaba Samed Bey, Instagram üzerinden görüşme talebi oluşturdum.'));
    assert.ok(text.includes('Ad Soyad: Ahmet Soysal'));
    assert.ok(text.includes("Konu: Dubai'de yazılım şirketi kurulumu"));
    assert.ok(text.includes('Telefon: +90 531 240 49 65'));
    assert.ok(text.includes('Görüşme: Bugün 18:00'));
    assert.ok(text.includes('Instagram: @samchetravel'));
    assert.ok(text.includes('Görüşme talebim hakkında sizinle iletişime geçmek istiyorum.'));

    const ctaUrl = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: '+971527288586',
      prefilledText: text,
    });
    assert.ok(ctaUrl.startsWith('https://wa.me/971527288586?text='));
    assert.ok(ctaUrl.includes(encodeURIComponent('Ahmet Soysal')));
  });

});
