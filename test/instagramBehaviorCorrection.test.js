import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  orchestrateInstagramInboundAiResponse,
  INSTAGRAM_CHANNEL_PRESENTATION_RULES,
} from '../services/instagram-ai-orchestrator.js';
import {
  deriveInstagramLeadQualification,
  evaluateAndProcessHighIntentLead,
  formatInternalWhatsAppLeadNotification,
} from '../services/high-intent-lead-service.js';

describe('Final Instagram Behavior Correction: Strictly Request-Driven Pricing & Natural Progressive Qualification', () => {

  const expectedPolicySha256 = 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58';

  it('TEST A: Meeting request with SaaS details triggers progressive qualification without unsolicited pricing, Free Zone lecture, or process dump', async () => {
    let capturedSystemInstruction = '';
    const fakeHttp = {
      async post() {
        return { data: { recipient_id: '8891427900000001', message_id: 'mid.testa.1' } };
      },
    };

    const mockDb = {
      async query(sql) {
        if (sql.includes('FROM conversations')) {
          return {
            rows: [{
              id: 'conv-test-a',
              tenant_id: 'tenant-1',
              channel_id: 'chan-1',
              status: 'open',
              handling_mode: 'AI',
              handling_version: 1,
              communication_language: 'tr',
            }],
          };
        }
        if (sql.includes('INSERT INTO conversation_messages') || sql.includes('UPDATE conversation_messages')) {
          return { rows: [{ id: 'msg-assist-1', sender_type: 'ASSISTANT' }] };
        }
        return { rows: [] };
      },
      async connect() { return this; },
      release() {},
    };

    const inboundState = {
      integration: {
        tenant_id: 'tenant-1',
        channel_id: 'chan-1',
        assistant_id: 'ast-1',
        external_channel_id: '17841400000000001',
        config: { access_token: 'token-1', page_id: '17841400000000001', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: {
        id: 'conv-test-a',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
        communication_language: 'tr',
      },
      shouldInvokeAi: true,
      handlingVersion: 1,
    };

    const customerText = "Dubai'de bir SaaS yazılım şirketi kurmak istiyoruz, Türkiye'deki müşterilerimize hizmet vereceğiz, 1 ay içinde başlamak istiyoruz. Samed Bey ile görüşebilir miyiz?";

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '8891427900000001',
      text: customerText,
      http: fakeHttp,
      generateAiResponse: async ({ systemInstruction }) => {
        capturedSystemInstruction = systemInstruction;
        return "Elbette görüşebiliriz. Görüşme talebinizi oluşturabilmem için sizden birkaç kısa bilgi almam gerekiyor. Şirketi tek ortaklı mı düşünüyorsunuz, yoksa başka ortaklar da olacak mı?";
      },
    });

    assert.equal(outcome.delivered, true);
    assert.ok(!outcome.responseText.includes('8.000 AED'), 'Must NOT disclose 8.000 AED consultancy fee when price is not asked');
    assert.ok(!outcome.responseText.includes('8000 AED'), 'Must NOT disclose 8000 AED when price is not asked');
    assert.ok(!outcome.responseText.includes('13.000 AED'), 'Must NOT mention 13.000 AED residency package');
    assert.ok(!outcome.responseText.includes('ücret'), 'Must NOT talk about fee/pricing when not asked');
    assert.ok(!outcome.responseText.includes('maliyet'), 'Must NOT talk about cost when not asked');
    assert.ok(outcome.responseText.includes('görüşebiliriz') || outcome.responseText.includes('Görüşme'));
    assert.ok(capturedSystemInstruction.includes('PRICING IS STRICTLY REQUEST-DRIVEN (NO UNSOLICITED PRICE DISCLOSURE)'));
    assert.ok(capturedSystemInstruction.includes('MEETING / APPOINTMENT INTENT OVERRIDES SALES EXPLANATION'));
  });
  it('TEST B: Explicit consultancy fee question returns authoritative 8.000 AED fee with bank/KYC and no unrelated pricing', async () => {
    const fakeHttp = {
      async post() {
        return { data: { recipient_id: '8891427900000001', message_id: 'mid.testb.1' } };
      },
    };

    const mockDb = {
      async query(sql) {
        if (sql.includes('FROM conversations')) {
          return { rows: [{ id: 'conv-test-b', tenant_id: 'tenant-1', channel_id: 'chan-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (sql.includes('INSERT INTO conversation_messages') || sql.includes('UPDATE conversation_messages')) {
          return { rows: [{ id: 'msg-assist-1', sender_type: 'ASSISTANT' }] };
        }
        return { rows: [] };
      },
      async connect() { return this; },
      release() {},
    };

    const inboundState = {
      integration: {
        tenant_id: 'tenant-1',
        channel_id: 'chan-1',
        assistant_id: 'ast-1',
        external_channel_id: '17841400000000001',
        config: { access_token: 'token-1', page_id: '17841400000000001', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-test-b', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
      handlingVersion: 1,
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '8891427900000001',
      text: "Danışmanlık ücretiniz ne kadar?",
      http: fakeHttp,
      generateAiResponse: async () => {
        return "Danışmanlık ücretimiz 8.000 AED'dir. Şirket banka hesabı açılışı ve KYC desteği bu ücrete dahildir.";
      },
    });

    assert.equal(outcome.delivered, true);
    assert.ok(outcome.responseText.includes('8.000 AED') || outcome.responseText.includes('8000 AED'));
    assert.ok(outcome.responseText.includes('banka') && outcome.responseText.includes('KYC'));
    assert.ok(!outcome.responseText.includes('13.000 AED'));
    assert.ok(!outcome.responseText.includes('16.800 AED'));
  });

  it('TEST C: Explicit setup cost inquiry explains main variables and 8.000 AED fee without expanding into unrelated packages', async () => {
    const fakeHttp = {
      async post() {
        return { data: { recipient_id: '8891427900000001', message_id: 'mid.testc.1' } };
      },
    };

    const mockDb = {
      async query(sql) {
        if (sql.includes('FROM conversations')) {
          return { rows: [{ id: 'conv-test-c', tenant_id: 'tenant-1', channel_id: 'chan-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (sql.includes('INSERT INTO conversation_messages') || sql.includes('UPDATE conversation_messages')) {
          return { rows: [{ id: 'msg-assist-1', sender_type: 'ASSISTANT' }] };
        }
        return { rows: [] };
      },
      async connect() { return this; },
      release() {},
    };

    const inboundState = {
      integration: {
        tenant_id: 'tenant-1',
        channel_id: 'chan-1',
        assistant_id: 'ast-1',
        external_channel_id: '17841400000000001',
        config: { access_token: 'token-1', page_id: '17841400000000001', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-test-c', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
      handlingVersion: 1,
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '8891427900000001',
      text: "Dubai'de şirket toplam ne kadara kurulur, maliyeti nedir?",
      http: fakeHttp,
      generateAiResponse: async () => {
        return [
          "Şirket kurulum maliyeti seçilecek serbest bölgeye (Free Zone) veya Mainland yapısına, lisans faaliyetine ve gereken vize sayısına göre belirlenir.",
          "",
          "• Resmi lisans maliyeti serbest bölgeye göre değişir.",
          "• SamChe danışmanlık ücretimiz 8.000 AED'dir (şirket banka hesabı açılışı ve KYC desteği dahildir).",
        ].join('\n');
      },
    });

    assert.equal(outcome.delivered, true);
    assert.ok(outcome.responseText.includes('8.000 AED') || outcome.responseText.includes('8000 AED'));
    assert.ok(!outcome.responseText.includes('13.000 AED'));
    assert.ok(!outcome.responseText.includes('Sponsorlu'));
  });
  it('TEST D: Already provided facts (SaaS, timeline, clients) are reused and not redundantly re-asked', () => {
    const customerMessages = [
      { content: "Dubai'de bir SaaS yazılım şirketi kurmak istiyoruz, Türkiye'deki müşterilerimize hizmet vereceğiz, 1 ay içinde başlamak istiyoruz. Samed Bey ile görüşebilir miyiz?" },
    ];

    const qualification = deriveInstagramLeadQualification({ customerMessages });
    assert.equal(qualification.hasHighIntent, true);
    assert.equal(qualification.serviceRequested, 'Şirket Kuruluşu');
    assert.ok(qualification.structuredRequirement.includes('SaaS') || qualification.structuredRequirement.includes('yazılım'));
    assert.ok(INSTAGRAM_CHANNEL_PRESENTATION_RULES.includes('USE INFORMATION ALREADY PROVIDED (NEVER ASK REDUNDANTLY)'));
  });

  it('TEST E: Qualification progressively collects partner count, visa count, phone, and availability before completing', async () => {
    // Step 1: initial meeting request -> incomplete (awaiting details/phone/time)
    const turn1Messages = [
      { id: '1', sender_type: 'CUSTOMER', content: "Dubai'de SaaS şirketi kurmak istiyorum, görüşebilir miyiz?" },
    ];
    const q1 = deriveInstagramLeadQualification({ customerMessages: turn1Messages });
    assert.equal(q1.complete, false, 'Turn 1 must not be marked complete');

    // Step 2: customer provides partner count & visa requirement -> still awaiting phone & time
    const turn2Messages = [
      ...turn1Messages,
      { id: '2', sender_type: 'CUSTOMER', content: "2 ortağız ve 2 kişi için oturum vizesi gerekecek." },
    ];
    const q2 = deriveInstagramLeadQualification({ customerMessages: turn2Messages });
    assert.equal(q2.complete, false, 'Turn 2 must still await phone and time');
    assert.ok(q2.missing.includes('CUSTOMER_PHONE'));
    assert.ok(q2.missing.includes('MEETING_AVAILABILITY'));

    // Step 3: customer provides phone and availability -> complete
    const turn3Messages = [
      ...turn2Messages,
      { id: '3', sender_type: 'CUSTOMER', content: "Numaram +971501234567, yarın saat 15:00 Dubai saati uygunum." },
    ];
    const q3 = deriveInstagramLeadQualification({ customerMessages: turn3Messages });
    assert.equal(q3.complete, true, 'Turn 3 with phone and availability must be complete');
    assert.equal(q3.phone, '+971501234567');
    assert.ok(q3.requestedTime.includes('15:00'));
  });

  it('TEST F: Authoritative Main policy SHA-256 matches exact required hash', () => {
    const rawPolicy = fs.readFileSync('policies/samche-whatsapp-master-business-policy.tr.txt', 'utf8');
    const canonicalPolicy = rawPolicy.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const computedHash = createHash('sha256').update(canonicalPolicy, 'utf8').digest('hex');

    assert.equal(computedHash, expectedPolicySha256, 'Authoritative Main policy hash must remain exactly unchanged');
  });


  it('TEST G: Internal notification renderer uses 0 LLM calls and 0 AI tokens', () => {
    const text = formatInternalWhatsAppLeadNotification({
      customerName: 'Ahmet Yılmaz',
      instagramUsername: 'ahmetyilmaz',
      phone: '+905321112233',
      serviceRequested: 'Free Zone Şirket Kuruluşu',
      activity: 'SaaS Yazılım',
      structuredRequirement: 'Dubai üzerinden global SaaS şirketi',
      requestedTime: '15:00',
      timezone: 'Asia/Dubai',
      source: 'Instagram DM',
    });

    assert.ok(text.includes('YENİ INSTAGRAM LEAD'));
    assert.ok(text.includes('Müşteri: Ahmet Yılmaz'));
    assert.ok(text.includes('Telefon / WhatsApp: +905321112233'));
    assert.ok(text.includes('Faaliyet: SaaS Yazılım'));
    assert.ok(!text.includes('WhatsApp numaranız üzerinden'));
  });

  it('TEST H: Same provider inbound MID delivered twice results in exactly 1 assistant reply and 1 outbound delivery', async () => {
    let assistantMessageCount = 0;
    const outboundDMs = [];
    const fakeHttp = {
      async post(url, body) {
        outboundDMs.push(body);
        return { data: { recipient_id: '8891427900000001', message_id: 'mid.h.1' } };
      },
    };

    const insertedMessages = [];
    const mockDb = {
      async query(sql, params) {
        if (sql.includes('FROM conversations')) {
          return { rows: [{ id: 'conv-test-h', tenant_id: 'tenant-1', channel_id: 'chan-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (sql.includes('FROM conversation_messages') && sql.includes('ORDER BY created_at DESC')) {
          return { rows: insertedMessages.slice().reverse() };
        }
        if (sql.includes('INSERT INTO conversation_messages')) {
          const idempotencyKey = params?.[5];
          if (idempotencyKey && insertedMessages.some(m => m.idempotency_key === idempotencyKey)) {
            return { rows: [] }; // ON CONFLICT DO NOTHING
          }
          const msg = { id: `msg-${insertedMessages.length + 1}`, sender_type: 'ASSISTANT', content: params?.[3], idempotency_key: idempotencyKey };
          insertedMessages.push(msg);
          assistantMessageCount++;
          return { rows: [msg] };
        }
        if (sql.includes('UPDATE conversation_messages')) {
          return { rows: [{ id: 'msg-1' }] };
        }
        return { rows: [] };
      },
      async connect() { return this; },
      release() {},
    };

    const customerMsg = { id: 'cust-msg-unique-1', sender_type: 'CUSTOMER', content: 'SaaS şirketi kurmak istiyorum' };
    insertedMessages.push(customerMsg);

    const inboundState = {
      integration: {
        tenant_id: 'tenant-1',
        channel_id: 'chan-1',
        assistant_id: 'ast-1',
        external_channel_id: '17841400000000001',
        config: { access_token: 'token-1', page_id: '17841400000000001', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-test-h', status: 'open', handling_mode: 'AI', handling_version: 1 },
      customerMessage: customerMsg,
      shouldInvokeAi: true,
      handlingVersion: 1,
    };

    // First delivery -> generates and delivers
    const res1 = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '8891427900000001',
      text: 'SaaS şirketi kurmak istiyorum',
      http: fakeHttp,
      generateAiResponse: async () => 'Harika, şirket detaylarını netleştirelim.',
    });

    assert.equal(res1.delivered, true);
    assert.equal(assistantMessageCount, 1);

    // Second delivery of same message -> skipped via idempotency
    const res2 = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '8891427900000001',
      text: 'SaaS şirketi kurmak istiyorum',
      http: fakeHttp,
      generateAiResponse: async () => 'Harika, şirket detaylarını netleştirelim.',
    });

    assert.equal(Boolean(res2.delivered), false);
    assert.equal(assistantMessageCount, 1, 'Exactly ONE assistant message must be persisted');
    const actualDMs = outboundDMs.filter(d => d?.message?.text);
    assert.equal(actualDMs.length, 1, 'Exactly ONE outbound DM must be delivered');
  });

  it('TEST I: High-intent qualification workflow does NOT generate a second customer-facing response', async () => {
    const executedQueries = [];
    const mockDb = {
      async query(sql, params) {
        executedQueries.push({ sql, params });
        if (sql.includes('FROM conversations')) {
          return { rows: [{ id: 'conv-test-i', tenant_id: 't-1', channel_id: 'ch-1', customer_external_id: 'instagram:u1', contact_id: 'ct-1', channel_type: 'INSTAGRAM', contact_name: 'Ahmet' }] };
        }
        if (sql.includes('FROM conversation_messages')) {
          return { rows: [
            { id: 'm1', sender_type: 'CUSTOMER', content: "SaaS şirketi kurmak istiyorum, görüşelim." },
            { id: 'm2', sender_type: 'CUSTOMER', content: "Numaram +971501112233, yarın 15:00 uygunum." },
          ] };
        }
        if (sql.includes('SELECT id FROM crm_leads')) return { rows: [{ id: 'lead-1' }] };
        if (sql.includes('SELECT id FROM crm_pipeline_stages')) return { rows: [{ id: 'stage-1' }] };
        if (sql.includes('SELECT ci.config AS ig_config')) {
          return { rows: [{ ig_config: { lead_notification_enabled: true, lead_whatsapp_destination: '+971527288586', lead_notification_template: { status: 'APPROVED', name: 'instagram_qualified_lead', language_code: 'tr' } } }] };
        }
        if (sql.includes('SELECT tc.external_channel_id')) return { rows: [{ external_channel_id: '1234567890', wa_config: {} }] };
        return { rows: [] };
      },
      async connect() { return this; },
      release() {},
    };

    const httpCalls = [];
    const result = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-test-i',
      database: mockDb,
      httpClient: { post: async (url, payload) => { httpCalls.push({ url, payload }); return { status: 200, data: { messages: [{ id: 'wamid.1' }] } }; } },
      env: { WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_TOKEN: 'token' },
    });

    assert.equal(result.qualified, true);
    // Ensure high intent lead workflow only updates CRM & internal notification, NEVER inserts customer-facing message
    const assistantMessageInsert = executedQueries.find(q => q.sql.includes('INSERT INTO conversation_messages') && q.params?.includes('ASSISTANT'));
    assert.equal(assistantMessageInsert, undefined, 'High intent workflow must NEVER create customer-facing message');
  });

  it('TEST J: Concurrent duplicate webhook requests for same conversation produce at most 1 AI reply', async () => {
    let aiGenerationInvocations = 0;
    const fakeHttp = {
      async post() {
        return { data: { recipient_id: '8891427900000001', message_id: 'mid.j.1' } };
      },
    };

    const mockDb = {
      async query(sql) {
        if (sql.includes('FROM conversations')) {
          return { rows: [{ id: 'conv-test-j', tenant_id: 'tenant-1', channel_id: 'chan-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (sql.includes('INSERT INTO conversation_messages') || sql.includes('UPDATE conversation_messages')) {
          return { rows: [{ id: 'msg-j-1', sender_type: 'ASSISTANT' }] };
        }
        return { rows: [] };
      },
      async connect() { return this; },
      release() {},
    };

    const inboundState = {
      integration: {
        tenant_id: 'tenant-1',
        channel_id: 'chan-1',
        assistant_id: 'ast-1',
        external_channel_id: '17841400000000001',
        config: { access_token: 'token-1', page_id: '17841400000000001', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-test-j', status: 'open', handling_mode: 'AI', handling_version: 1 },
      customerMessage: { id: 'cust-msg-j-1' },
      shouldInvokeAi: true,
      handlingVersion: 1,
    };

    // Run 2 parallel concurrent orchestrations for the exact same conversation
    const [res1, res2] = await Promise.all([
      orchestrateInstagramInboundAiResponse({
        database: mockDb,
        inboundState,
        senderIgsid: '8891427900000001',
        text: 'Parallel test',
        http: fakeHttp,
        generateAiResponse: async () => {
          aiGenerationInvocations++;
          await new Promise((r) => setTimeout(r, 50));
          return 'Response';
        },
      }),
      orchestrateInstagramInboundAiResponse({
        database: mockDb,
        inboundState,
        senderIgsid: '8891427900000001',
        text: 'Parallel test',
        http: fakeHttp,
        generateAiResponse: async () => {
          aiGenerationInvocations++;
          await new Promise((r) => setTimeout(r, 50));
          return 'Response';
        },
      }),
    ]);

    assert.equal(aiGenerationInvocations, 1, 'Only 1 parallel generation must proceed');
    const successfulDeliveries = [res1, res2].filter(r => r.delivered === true);
    assert.equal(successfulDeliveries.length, 1, 'Exactly 1 concurrent orchestration must deliver');
  });


});