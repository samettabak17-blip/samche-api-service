import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FINAL_INSTAGRAM_CHUNK_LENGTH,
  splitIntoInstagramDmChunks,
  deliverInstagramText,
  InstagramDeliveryError,
} from '../services/instagram-delivery-service.js';
import {
  mergeConsecutiveConversationTurns,
  resolveDurableConversationMemory,
  buildStructuredMemoryInstruction,
  orchestrateInstagramInboundAiResponse,
  generateContextualConversationalFallback,
} from '../services/instagram-ai-orchestrator.js';
import {
  evaluateAndProcessHighIntentLead,
  buildQualifiedLeadWhatsAppPrefilledMessage,
  generateCustomerInitiatedWhatsAppCtaUrl,
  extractShareholderCount,
} from '../services/high-intent-lead-service.js';
import {
  evaluateChannelAiActivationPolicy,
  AI_BEHAVIOR_OVERRIDES,
  AI_ACTIVATION_MODES,
} from '../services/channel-ai-activation-policy-service.js';

describe('Mandatory Regression Suite: Safe Chunking, Multi-Turn Memory & CTA', () => {

  it('1. 900 chars -> exactly one chunk <= 900', () => {
    const text900 = 'A'.repeat(900);
    const chunks = splitIntoInstagramDmChunks(text900, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 900);
  });

  it('2. 901 chars -> >= 2 chunks, every chunk <= 900', () => {
    const text901 = 'A'.repeat(901);
    const chunks = splitIntoInstagramDmChunks(text901, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH);
    assert.ok(chunks.length >= 2, `Expected >=2 chunks, got ${chunks.length}`);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 900, `Chunk length ${chunk.length} exceeds 900`);
    }
  });

  it('3. 2,500 chars -> multiple chunks, every chunk <= 900', () => {
    const para = 'Dubai şirket kuruluşu sürecinde Free Zone ve Mainland lisansları mevcuttur. '.repeat(35);
    const chunks = splitIntoInstagramDmChunks(para, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH);
    assert.ok(chunks.length >= 3, `Expected >= 3 chunks for 2500 chars, got ${chunks.length}`);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 900, `Chunk exceeds 900: ${chunk.length}`);
    }
    const joined = chunks.join(' ');
    assert.ok(joined.includes('Dubai şirket kuruluşu'));
  });

  it('4. 5,000 chars -> multiple chunks, every chunk <= 900 without failure', () => {
    const hugeText = 'Detaylı Dubai mevzuatı ve vergilendirme bilgileri:\n\n' + 'Madde: Free Zone şirketleri %0 kurumlar vergisi avantajından yararlanabilir.\n'.repeat(65);
    assert.ok(hugeText.length >= 5000);
    const chunks = splitIntoInstagramDmChunks(hugeText, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH);
    assert.ok(chunks.length >= 6);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 900, `Chunk length ${chunk.length} must be <= 900`);
    }
  });

  it('0. 500 chars -> exactly one chunk', () => {
    const text500 = 'A'.repeat(500);
    const chunks = splitIntoInstagramDmChunks(text500, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 500);
  });

  it('5. Turkish Unicode characters are fully preserved without corruption', () => {
    const turkishText = 'Şirket kuruluşu için gerekli belgeler: Çözüm ortaklığı, İkamet izni, Sağlık testi, Ödeme dekontu ve Üyelik kaydı.';
    const chunks = splitIntoInstagramDmChunks(turkishText, 900);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], turkishText);
    assert.ok(chunks[0].includes('Şirket'));
    assert.ok(chunks[0].includes('Çözüm'));
    assert.ok(chunks[0].includes('İkamet'));
    assert.ok(chunks[0].includes('Ödeme'));
    assert.ok(chunks[0].includes('Üyelik'));
  });

  it('6. Arabic Unicode characters are fully preserved without corruption', () => {
    const arabicText = 'تأسيس الشركات في دبي: استشارات قانونية وتراخيص تجارية وإقامة مستثمر.';
    const chunks = splitIntoInstagramDmChunks(arabicText, 900);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], arabicText);
    assert.ok(chunks[0].includes('تأسيس'));
    assert.ok(chunks[0].includes('دبي'));
  });

  it('6b. Emoji and multi-byte Unicode safety', () => {
    const emojiText = 'Dubai Şirket Kuruluşu 🚀💼✨ • Ücretsiz Danışmanlık 👍💬';
    const chunks = splitIntoInstagramDmChunks(emojiText, 900);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], emojiText);
    assert.ok(chunks[0].includes('🚀'));
    assert.ok(chunks[0].includes('💼'));
  });
  it('7. Long wa.me CTA URLs and web links remain intact within chunks', () => {
    const ctaUrl = 'https://wa.me/971527288586?text=' + encodeURIComponent('Merhaba Samed Bey, Dubai şirket kuruluşu için görüşme talebi oluşturdum.');
    const fullMessage = `Harika! Bilgilerinizi aldım. Aşağıdaki bağlantıdan doğrudan WhatsApp üzerinden iletişime geçebilirsiniz:\n\n${ctaUrl}`;
    const chunks = splitIntoInstagramDmChunks(fullMessage, 900);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].includes(ctaUrl));
    assert.ok(chunks[0].length <= 900);
  });

  it('8. Provider failure in middle chunk halts subsequent sends and returns failed state', async () => {
    const longContent = 'A'.repeat(800) + '\n\n' + 'B'.repeat(800) + '\n\n' + 'C'.repeat(800);
    const sentChunks = [];
    const fakeHttp = {
      post: async (url, payload) => {
        const text = payload.message?.text || '';
        sentChunks.push(text[0]);
        if (text.startsWith('B')) {
          const err = new Error('Meta transient network error');
          err.response = { status: 500, data: { error: { message: 'Meta rate limit', code: 613 } } };
          throw err;
        }
        return { data: { message_id: `mid.${sentChunks.length}` } };
      },
    };

    await assert.rejects(
      async () => {
        await deliverInstagramText({
          recipientId: '10203040',
          content: longContent,
          accessToken: 'EAAB_token',
          authMode: 'INSTAGRAM_LOGIN',
          http: fakeHttp,
        });
      },
      (err) => {
        assert.equal(err.chunkIndex, 1);
        assert.equal(err.deliveredProviderIds?.length, 1);
        return true;
      }
    );

    // Chunk C was NEVER attempted because Chunk B failed
    assert.equal(sentChunks.filter(c => c === 'C').length, 0);
  });

  it('9. Chunks are delivered sequentially in strict order (1 -> 2 -> 3)', async () => {
    const text = '1. First section: ' + 'A'.repeat(800) + '\n\n2. Second section: ' + 'B'.repeat(800) + '\n\n3. Third section: ' + 'C'.repeat(800);
    const deliveredOrder = [];
    const fakeHttp = {
      post: async (url, payload) => {
        deliveredOrder.push(payload.message.text.slice(0, 17));
        return { data: { message_id: `mid.${deliveredOrder.length}` } };
      },
    };

    const res = await deliverInstagramText({
      recipientId: '10203040',
      content: text,
      accessToken: 'EAAB_token',
      http: fakeHttp,
    });

    assert.equal(res.delivery, 'SENT_TO_INSTAGRAM');
    assert.ok(res.providerMessageIds.length >= 3);
    assert.equal(deliveredOrder[0], '1. First section:');
    assert.equal(deliveredOrder[1], '2. Second section');
    assert.equal(deliveredOrder[2], '3. Third section:');
  });

  it('10. No duplicate provider delivery on identical customer message retry', async () => {
    const httpPostPayloads = [];
    const fakeHttp = {
      post: async (url, payload) => {
        httpPostPayloads.push(payload);
        return { data: { message_id: `mid.unique.${httpPostPayloads.length}` } };
      },
    };

    const mockMessages = [];
    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql, params) => {
        if (/idempotency_key/i.test(sql) && /SELECT/i.test(sql)) {
          const keyToFind = params?.[2] || params?.[1];
          const match = mockMessages.find((m) => m.idempotency_key === keyToFind);
          return { rowCount: match ? 1 : 0, rows: match ? [match] : [] };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          const newMsg = { id: 'msg-ai-1', idempotency_key: params?.[4] || params?.[5] };
          mockMessages.push(newMsg);
          return { rowCount: 1, rows: [newMsg] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: 'Merhaba' }] };
        }
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-1', tenant_id: 't-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      customerMessage: { id: 'cust-msg-100' },
      integration: {
        tenant_id: 't-1',
        assistant_id: 'ast-1',
        config: {
          access_token: 'EAAB_test_token',
          instagram_account_id: '17841474291887372',
          activation_policy: 'ALL_MESSAGES',
        },
      },
      conversation: {
        id: 'conv-1',
        tenant_id: 't-1',
        customer_external_id: 'instagram:10203040',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
      },
      shouldInvokeAi: true,
    };

    const res1 = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '10203040',
      text: 'Merhaba',
      http: fakeHttp,
      generateAiResponse: async () => 'Merhaba size nasıl yardımcı olabilirim?',
      applyPacing: false,
    });
    assert.equal(res1.delivered, true);
    const textDeliveries1 = httpPostPayloads.filter((p) => p?.message?.text);
    assert.equal(textDeliveries1.length, 1);

    const res2 = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '10203040',
      text: 'Merhaba',
      http: fakeHttp,
      generateAiResponse: async () => 'Merhaba size nasıl yardımcı olabilirim?',
      applyPacing: false,
    });
    assert.equal(res2.skipped, true);
    assert.equal(res2.reason, 'ASSISTANT_REPLY_ALREADY_EXISTS');
    const textDeliveries2 = httpPostPayloads.filter((p) => p?.message?.text);
    assert.equal(textDeliveries2.length, 1, 'Delivery must not be duplicated');
  });


  it('6. Arabic Unicode characters are fully preserved without corruption', () => {
    const arabicText = 'تأسيس الشركات في دبي: المنطقة الحرة والبر الرئيسي مع فتح حساب مصرفي وإقامة المستثمر.';
    const chunks = splitIntoInstagramDmChunks(arabicText, 900);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], arabicText);
    assert.ok(chunks[0].includes('تأسيس الشركات في دبي'));
  });

  // =========================================================================
  // MEMORY & STRUCTURED CONTEXT TESTS (11 to 20)
  // =========================================================================

  it('11. Customer gives business activity -> durable memory persists and AI never asks activity again', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "Dubai'de yazılım ve danışmanlık şirketi açmak istiyorum." },
      ],
    });

    assert.equal(memory.businessActivity, 'yazılım');
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Business Activity / Sector: "yazılım"'));
    assert.ok(instruction.includes('Business Activity is ALREADY ANSWERED') || instruction.includes('DO NOT ask for their business activity'));
  });

  it('12. Customer gives phone -> durable memory persists and AI never asks phone again', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "Telefonum +905312404965, arayabilirsiniz." },
      ],
    });

    assert.equal(memory.phone, '+905312404965');
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Contact Phone / WhatsApp: +905312404965'));
    assert.ok(instruction.includes('Customer Phone is ALREADY KNOWN. DO NOT ask for their phone number again.'));
  });

  it('13. Customer gives meeting time -> durable memory persists and AI never asks meeting time again', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "Yarın saat 18:00 uygun görüşelim." },
      ],
    });

    assert.ok(memory.requestedTime.includes('18:00'));
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Preferred Meeting Time:'));
    assert.ok(instruction.includes('Preferred Meeting Time is ALREADY KNOWN. DO NOT ask for their preferred time'));
  });

  it('14. Customer gives shareholder count -> persists across later turns', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "2 ortak olarak şirketi kuracağız." },
      ],
    });

    assert.equal(memory.shareholderCount, '2 ortak');
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Shareholder / Partner Count: 2 ortak'));
  });

  it('15. Customer corrects known fact -> latest explicit customer statement wins', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "2 ortak olarak şirketi kuracağız." },
        { sender_type: 'ASSISTANT', content: "Anladım, 2 ortak için Free Zone kurulumunu inceliyoruz." },
        { sender_type: 'CUSTOMER', content: "Aslında tek ortak olacağım, ortağım vazgeçti." },
      ],
    });

    assert.equal(memory.shareholderCount, '1 ortak (Tek ortak)');
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Shareholder / Partner Count: 1 ortak (Tek ortak)'));
  });

  it('15b. Customer says "İkiside olabilir" -> both company formation and residency retained in topic', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "Samed bey sizinle telefonda görüşmek isterim" },
        { sender_type: 'ASSISTANT', content: "Telefon numaranızı ve görüşmek istediğiniz konuyu paylaşabilir misiniz?" },
        { sender_type: 'CUSTOMER', content: "+905312404965" },
        { sender_type: 'ASSISTANT', content: "Şirket kuruluşu mu yoksa sponsorlu oturum mu görüşmek istersiniz?" },
        { sender_type: 'CUSTOMER', content: "İkiside olabilir" },
      ],
    });

    assert.equal(memory.phone, '+905312404965');
    assert.equal(memory.serviceRequested, 'Şirket Kuruluşu ve Sponsorlu Oturum');
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Şirket Kuruluşu ve Sponsorlu Oturum'));
    assert.ok(instruction.includes('Service / Consultation Topic is ALREADY KNOWN'));
  });

  it('15c. Customer says "Henüz karar vermedim" -> memory stores NOT_DECIDED and AI does not re-ask', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "+905312404965" },
        { sender_type: 'CUSTOMER', content: "İkiside olabilir" },
        { sender_type: 'CUSTOMER', content: "Henüz karar vermedim" },
      ],
    });

    assert.equal(memory.activityState, 'NOT_DECIDED');
    assert.ok(memory.businessActivity.includes('karar verilmedi'));
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Business Activity State: NOT_DECIDED'));
    assert.ok(instruction.includes('Business Activity is ALREADY ANSWERED (known or undecided)'));
  });

  it('15d. Customer later provides previously undecided activity -> latest explicit statement updates memory', async () => {
    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: [
        { sender_type: 'CUSTOMER', content: "Henüz karar vermedim" },
        { sender_type: 'ASSISTANT', content: "Sorun değil, görüşmede netleştirebiliriz. Size uygun gün ve saat nedir?" },
        { sender_type: 'CUSTOMER', content: "Aslında yazılım şirketi kurmaya karar verdim, yarın 15:00 uygun." },
      ],
    });

    assert.equal(memory.activityState, 'KNOWN');
    assert.equal(memory.businessActivity, 'yazılım');
    assert.ok(memory.requestedTime.includes('15:00'));
  });

  it('15e. Fallback safety: "Bilmiyorum" or "Emin değilim" returns friendly response without silent turn', () => {
    const memory = { phone: '+905312404965' };
    const fallback1 = generateContextualConversationalFallback({ text: 'Henüz karar vermedim', memory });
    assert.ok(fallback1.includes('netleşmediyse') || fallback1.includes('birlikte değerlendirebiliriz') || fallback1.includes('yardımcı'));

    const fallback2 = generateContextualConversationalFallback({ text: 'Bilmiyorum', memory });
    assert.ok(fallback2.includes('netleşmediyse') || fallback2.includes('birlikte değerlendirebiliriz') || fallback2.includes('yardımcı'));

    const fallback3 = generateContextualConversationalFallback({ text: 'Emin değilim', memory });
    assert.ok(fallback3.includes('netleşmediyse') || fallback3.includes('birlikte değerlendirebiliriz') || fallback3.includes('yardımcı'));
  });

  it('16. Follow-up "peki banka hesabı?" preserves active company-formation context', () => {
    const memory = {
      businessActivity: 'yazılım',
      jurisdictionPreference: 'Free Zone',
    };
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Active Topic / Context: Company Formation & Consultancy (UAE / Dubai)'));
    assert.ok(instruction.includes('answer it within the established context'));
  });

  it('17. Long conversation retains all durable qualification facts without token explosion', async () => {
    const turns = [
      { sender_type: 'CUSTOMER', content: "Merhaba ben Ahmet Soysal. Dubai'de e-ticaret yapmak istiyorum." },
      { sender_type: 'ASSISTANT', content: "Merhaba Ahmet Bey, e-ticaret için Free Zone lisansı uygundur." },
      { sender_type: 'CUSTOMER', content: "2 vize alacağız." },
      { sender_type: 'ASSISTANT', content: "2 vize tahsisi yapılabilir." },
      { sender_type: 'CUSTOMER', content: "Numaram +971501234567" },
      { sender_type: 'ASSISTANT', content: "Numaranızı aldım. Ne zaman görüşelim?" },
      { sender_type: 'CUSTOMER', content: "Pazartesi 15:00 Dubai saati" },
    ];

    const memory = await resolveDurableConversationMemory({
      tenantId: 't-1',
      conversationId: 'conv-1',
      rawMessages: turns,
    });

    assert.equal(memory.customerName, 'Ahmet Soysal');
    assert.equal(memory.businessActivity, 'e-ticaret');
    assert.equal(memory.visaCount, '2 kişi');
    assert.equal(memory.phone, '+971501234567');
    assert.ok(memory.requestedTime.includes('15:00'));

    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Ahmet Soysal'));
    assert.ok(instruction.includes('e-ticaret'));
    assert.ok(instruction.includes('+971501234567'));
    assert.ok(instruction.includes('15:00'));
  });

  it('18. Chunked assistant response is merged as ONE logical assistant turn in conversation history', () => {
    const rawHistory = [
      { sender_type: 'CUSTOMER', content: "Dubai şirket kurulumu nasıl işler?" },
      { sender_type: 'ASSISTANT', content: "1. Bölüm: Lisans başvurusu yapılır." },
      { sender_type: 'ASSISTANT', content: "2. Bölüm: Şirket evrakları onaylanır." },
      { sender_type: 'ASSISTANT', content: "3. Bölüm: Vize ve banka hesabı tamamlanır." },
      { sender_type: 'CUSTOMER', content: "Peki maliyet nedir?" },
    ];

    const merged = mergeConsecutiveConversationTurns(rawHistory);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].role, 'user');
    assert.equal(merged[1].role, 'model');
    assert.ok(merged[1].parts[0].text.includes('1. Bölüm'));
    assert.ok(merged[1].parts[0].text.includes('2. Bölüm'));
    assert.ok(merged[1].parts[0].text.includes('3. Bölüm'));
    assert.equal(merged[2].role, 'user');
  });

  it('19. Contact-level NEVER_AI override persists independently of archive/unarchive', async () => {
    const contact = { ai_behavior_override: 'NEVER_AI' };
    const conversation = { contact_ai_behavior_override: 'NEVER_AI', status: 'archived' };

    const evaluation = await evaluateChannelAiActivationPolicy({
      messageText: 'Dubai şirket kurulumu',
      conversation,
      contact,
      channelConfig: { activation_policy: 'ALL_MESSAGES' },
    });

    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.reasonCode, 'OVERRIDE_NEVER_AI');
  });

  it('20. Conversation restart/redeploy reloads persisted qualification facts from DB', async () => {
    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql) => {
        if (/FROM crm_leads/i.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              contact_name: 'Murat Kaya',
              phone: '+905321112233',
              service_interest: 'yazılım',
              timeline: 'Cuma 14:00',
            }],
          };
        }
        if (/FROM crm_consultations/i.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              customer_name: 'Murat Kaya',
              phone: '+905321112233',
              activity: 'yazılım',
              requested_time: 'Cuma 14:00',
              timezone: 'Dubai saati',
            }],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const memory = await resolveDurableConversationMemory({
      database: mockDb,
      tenantId: 't-1',
      conversationId: 'conv-restarted',
      rawMessages: [],
    });

    assert.equal(memory.customerName, 'Murat Kaya');
    assert.equal(memory.phone, '+905321112233');
    assert.equal(memory.businessActivity, 'yazılım');
    assert.equal(memory.requestedTime, 'Cuma 14:00');
  });

  it('20b. Contact-level CRM facts (crm_contacts.phone) feed durable memory and prevent re-asking phone', async () => {
    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql, params) => {
        if (/FROM crm_contacts/i.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              display_name: 'Suleyman Isseven (@suleyman_isseven)',
              phone: '+905312404965',
            }],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const memory = await resolveDurableConversationMemory({
      database: mockDb,
      tenantId: 't-1',
      conversationId: 'conv-crm-phone',
      conversation: { contact_id: 'contact-uuid-1', contact_display_name: 'Suleyman' },
      rawMessages: [],
    });

    assert.equal(memory.phone, '+905312404965');
    const instruction = buildStructuredMemoryInstruction(memory);
    assert.ok(instruction.includes('Contact Phone / WhatsApp: +905312404965'));
    assert.ok(instruction.includes('Customer Phone is ALREADY KNOWN'));
  });

  // =========================================================================
  // ACTIVATION TESTS (21 to 24)
  // =========================================================================

  it('21. AI_ONLY override + MANUAL_ONLY channel -> AI responds immediately', async () => {
    const conversation = { ai_behavior_override: 'AI_ONLY', handling_mode: 'AI', status: 'open' };
    const evaluation = await evaluateChannelAiActivationPolicy({
      messageText: 'Merhaba',
      conversation,
      channelConfig: { activation_policy: 'MANUAL_ONLY' },
    });
    assert.equal(evaluation.eligible, true);
    assert.equal(evaluation.reasonCode, 'OVERRIDE_AI_ONLY');
  });

  it('22. NEVER_AI override -> strictly suppresses AI under all channel policies', async () => {
    const conversation = { ai_behavior_override: 'NEVER_AI', handling_mode: 'AI', status: 'open' };
    const evaluation = await evaluateChannelAiActivationPolicy({
      messageText: 'Dubai şirket kurulumu ve randevu talebi',
      conversation,
      channelConfig: { activation_policy: 'ALL_MESSAGES' },
    });
    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.reasonCode, 'OVERRIDE_NEVER_AI');
  });

  it('23. Human Mode (handling_mode = HUMAN) -> strictly suppresses AI', async () => {
    const conversation = { ai_behavior_override: 'AI_ONLY', handling_mode: 'HUMAN', status: 'open' };
    const evaluation = await evaluateChannelAiActivationPolicy({
      messageText: 'Merhaba',
      conversation,
      channelConfig: { activation_policy: 'ALL_MESSAGES' },
    });
    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.reasonCode, 'HUMAN_MODE_ACTIVE');
  });

  it('24. AUTOMATIC mode evaluates canonical channel policy', async () => {
    const convAuto = { ai_behavior_override: 'AUTOMATIC', handling_mode: 'AI', status: 'open' };

    const manualEval = await evaluateChannelAiActivationPolicy({
      messageText: 'Merhaba',
      conversation: convAuto,
      channelConfig: { activation_policy: 'MANUAL_ONLY' },
    });
    assert.equal(manualEval.eligible, false);
    assert.equal(manualEval.reasonCode, 'POLICY_MANUAL_ONLY');

    const allMsgEval = await evaluateChannelAiActivationPolicy({
      messageText: 'Merhaba',
      conversation: convAuto,
      channelConfig: { activation_policy: 'ALL_MESSAGES' },
    });
    assert.equal(allMsgEval.eligible, true);
    assert.equal(allMsgEval.reasonCode, 'POLICY_ALL_MESSAGES');
  });

  // =========================================================================
  // CTA TESTS (25 to 27)
  // =========================================================================

  it('25. Incomplete qualification (missing phone/time) creates NO consultation and NO CTA', async () => {
    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-inc', tenant_id: 't-1', channel_id: 'ch-1', channel_type: 'INSTAGRAM' }] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return {
            rowCount: 2,
            rows: [
              { sender_type: 'CUSTOMER', content: "Dubai'de yazılım şirketi kurmak istiyorum randevu alabilir miyiz?" },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const res = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-inc',
      database: mockDb,
    });

    assert.equal(res.qualified, false);
    assert.equal(res.reason, 'QUALIFICATION_INCOMPLETE_AWAITING_PHONE');
    assert.ok(res.missing.includes('phone'));
    assert.equal(res.ctaUrl, undefined);
  });

  it('26. Complete qualification creates exactly 1 PENDING consultation + 1 deterministic WhatsApp CTA', async () => {
    let consultationCreated = 0;
    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql, params) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-comp', tenant_id: 't-1', channel_id: 'ch-1', channel_type: 'INSTAGRAM', contact_id: 'ct-1' }] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return {
            rowCount: 3,
            rows: [
              { sender_type: 'CUSTOMER', content: "Dubai'de yazılım şirketi kurmak istiyorum randevu alabilir miyiz?" },
              { sender_type: 'CUSTOMER', content: "Telefonum +905312404965" },
              { sender_type: 'CUSTOMER', content: "Bugün 18:00 uygun görüşelim." },
            ],
          };
        }
        if (/INSERT INTO crm_consultations/i.test(sql)) {
          consultationCreated++;
          return {
            rowCount: 1,
            rows: [{
              id: 'c-100',
              status: 'PENDING',
              customer_name: params[5],
              phone: params[7],
              requested_time: params[10],
              cta_prefilled_text: params[14],
            }],
          };
        }
        if (/FROM crm_pipeline_stages/i.test(sql)) return { rowCount: 1, rows: [{ id: 'stage-qual' }] };
        if (/UPDATE crm_leads/i.test(sql)) return { rowCount: 1, rows: [] };
        if (/FROM channel_integrations/i.test(sql)) return { rowCount: 1, rows: [{ ig_config: { qualified_lead_contact_cta: { destination: '+971527288586', contact_name: 'Samed Bey' } } }] };
        return { rowCount: 0, rows: [] };
      },
    };

    const outcome = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-comp',
      database: mockDb,
    });

    assert.equal(outcome.qualified, true);
    assert.equal(consultationCreated, 1);
    assert.equal(outcome.consultation?.status, 'PENDING');
    assert.ok(outcome.ctaUrl.startsWith('https://wa.me/971527288586?text='));
    assert.ok(outcome.prefilledText.includes('+905312404965'));
    assert.ok(outcome.prefilledText.includes('18:00'));
  });

  it('27. Subsequent customer message after completed qualification evaluates normal AI without duplicate CTA', async () => {
    let consultationCreated = 0;
    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-comp', tenant_id: 't-1', channel_id: 'ch-1', channel_type: 'INSTAGRAM', contact_id: 'ct-1' }] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return {
            rowCount: 4,
            rows: [
              { sender_type: 'CUSTOMER', content: "Dubai'de yazılım şirketi kurmak istiyorum randevu alabilir miyiz?" },
              { sender_type: 'CUSTOMER', content: "Telefonum +905312404965" },
              { sender_type: 'CUSTOMER', content: "Bugün 18:00 uygun görüşelim." },
              { sender_type: 'CUSTOMER', content: "Ayrıca ofis kiralama zorunlu mu?" },
            ],
          };
        }
        if (/INSERT INTO crm_consultations/i.test(sql)) {
          consultationCreated++;
          return { rowCount: 1, rows: [{ id: 'c-100', status: 'PENDING' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const outcome = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-comp',
      database: mockDb,
    });

    assert.equal(outcome.qualified, true);
    assert.equal(consultationCreated, 1);
  });

  // =========================================================================
  // MULTI-TENANT ISOLATION TESTS (28 to 30)
  // =========================================================================

  it('28. Two distinct tenants have strictly isolated conversations, facts, and configs', async () => {
    const memoryTenantA = await resolveDurableConversationMemory({
      tenantId: 'tenant-aaa',
      conversationId: 'conv-a',
      rawMessages: [{ sender_type: 'CUSTOMER', content: "Dubai'de inşaat şirketi kuracağız. Tel: +905001112233" }],
    });

    const memoryTenantB = await resolveDurableConversationMemory({
      tenantId: 'tenant-bbb',
      conversationId: 'conv-b',
      rawMessages: [{ sender_type: 'CUSTOMER', content: "Dubai'de restoran açacağız. Tel: +905998887766" }],
    });

    assert.equal(memoryTenantA.businessActivity, 'inşaat');
    assert.equal(memoryTenantA.phone, '+905001112233');

    assert.equal(memoryTenantB.businessActivity, 'restoran');
    assert.equal(memoryTenantB.phone, '+905998887766');
  });

  it('29. Zero cross-tenant context leakage across memory instructions', () => {
    const memoryA = { businessActivity: 'kripto', phone: '+905111111111' };
    const memoryB = { businessActivity: 'turizm', phone: '+905222222222' };

    const promptA = buildStructuredMemoryInstruction(memoryA);
    const promptB = buildStructuredMemoryInstruction(memoryB);

    assert.ok(promptA.includes('kripto') && !promptA.includes('turizm'));
    assert.ok(promptB.includes('turizm') && !promptB.includes('kripto'));
  });

  it('30. Distinct CTA destinations and contact names resolved strictly from tenant configs', () => {
    const ctaTenantA = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: '+971501112233',
      prefilledText: buildQualifiedLeadWhatsAppPrefilledMessage({
        customerName: 'Tenant A Client',
        contactName: 'Ahmet Bey',
        requirement: 'Danışmanlık',
      }),
    });

    const ctaTenantB = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: '+971509998877',
      prefilledText: buildQualifiedLeadWhatsAppPrefilledMessage({
        customerName: 'Tenant B Client',
        contactName: 'Fatma Hanım',
        requirement: 'Restoran',
      }),
    });

    assert.ok(ctaTenantA.startsWith('https://wa.me/971501112233?text='));
    assert.ok(ctaTenantA.includes(encodeURIComponent('Ahmet Bey')));

    assert.ok(ctaTenantB.startsWith('https://wa.me/971509998877?text='));
    assert.ok(ctaTenantB.includes(encodeURIComponent('Fatma Hanım')));
  });

  // =========================================================================
  // TYPING LIFECYCLE TESTS (31 to 34)
  // =========================================================================

  it('31. Normal Success: typing_on -> generate -> format -> deliver -> typing_off', async () => {
    const senderActions = [];
    const fakeHttp = {
      post: async (url, payload) => {
        if (payload?.sender_action) {
          senderActions.push(payload.sender_action);
          return { data: { recipient_id: payload.recipient?.id } };
        }
        return { data: { message_id: 'mid.success.1' } };
      },
    };

    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql, params) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-typing-1', tenant_id: 't-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-ai-1', content: params?.[3] }] };
        }
        if (/idempotency_key/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: 'Merhaba' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      customerMessage: { id: 'msg-cust-1' },
      integration: {
        tenant_id: 't-1',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-typing-1', tenant_id: 't-1', customer_external_id: '10203040', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '10203040',
      text: 'Merhaba',
      http: fakeHttp,
      generateAiResponse: async () => 'SamChe danışmanlık hizmetlerine hoş geldiniz.',
      applyPacing: false,
    });

    assert.equal(outcome.delivered, true);
    assert.deepEqual(senderActions, ['typing_on', 'typing_off']);
  });

  it('32. Generation Failure after typing_on: typing_off must be attempted without hanging', async () => {
    const senderActions = [];
    const fakeHttp = {
      post: async (url, payload) => {
        if (payload?.sender_action) {
          senderActions.push(payload.sender_action);
          return { data: { recipient_id: payload.recipient?.id } };
        }
        return { data: { message_id: 'mid.1' } };
      },
    };

    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-typing-2', tenant_id: 't-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (/idempotency_key/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: 'Merhaba' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      customerMessage: { id: 'msg-cust-1' },
      integration: {
        tenant_id: 't-1',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-typing-2', tenant_id: 't-1', customer_external_id: '10203040', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '10203040',
      text: 'Merhaba',
      http: fakeHttp,
      generateAiResponse: async () => '', // Empty AI response
      applyPacing: false,
    });

    assert.equal(outcome.delivered, false);
    assert.equal(outcome.reason, 'EMPTY_AI_RESPONSE');
    assert.deepEqual(senderActions, ['typing_on', 'typing_off']);
  });

  it('33. Generation Exception/Timeout: typing_off must be attempted', async () => {
    const senderActions = [];
    const fakeHttp = {
      post: async (url, payload) => {
        if (payload?.sender_action) {
          senderActions.push(payload.sender_action);
          return { data: { recipient_id: payload.recipient?.id } };
        }
        return { data: { message_id: 'mid.1' } };
      },
    };

    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-typing-3', tenant_id: 't-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (/idempotency_key/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: 'Merhaba' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      customerMessage: { id: 'msg-cust-1' },
      integration: {
        tenant_id: 't-1',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-typing-3', tenant_id: 't-1', customer_external_id: '10203040', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
    };

    await assert.rejects(
      async () => {
        await orchestrateInstagramInboundAiResponse({
          database: mockDb,
          inboundState,
          senderIgsid: '10203040',
          text: 'Merhaba',
          http: fakeHttp,
          generateAiResponse: async () => { throw new Error('LLM connection timed out'); },
          applyPacing: false,
        });
      },
      /LLM connection timed out/
    );

    assert.deepEqual(senderActions, ['typing_on', 'typing_off']);
  });

  it('34. Provider Rejection on Delivery: typing_off must be attempted', async () => {
    const senderActions = [];
    const fakeHttp = {
      post: async (url, payload) => {
        if (payload?.sender_action) {
          senderActions.push(payload.sender_action);
          return { data: { recipient_id: payload.recipient?.id } };
        }
        const err = new Error('Meta API 400 Bad Request');
        err.response = { status: 400, data: { error: { message: 'Invalid token', code: 190 } } };
        throw err;
      },
    };

    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql, params) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-typing-4', tenant_id: 't-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-ai-1', content: params?.[3] }] };
        }
        if (/idempotency_key/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-cust-1', sender_type: 'CUSTOMER', content: 'Merhaba' }] };
        }
        if (/UPDATE conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      customerMessage: { id: 'msg-cust-1' },
      integration: {
        tenant_id: 't-1',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-typing-4', tenant_id: 't-1', customer_external_id: '10203040', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '10203040',
      text: 'Merhaba',
      http: fakeHttp,
      generateAiResponse: async () => 'SamChe danışmanlık.',
      applyPacing: false,
    });

    assert.equal(outcome.delivered, false);
    assert.deepEqual(senderActions, ['typing_on', 'typing_off']);
  });

  // =========================================================================
  // CONCURRENCY & DEDUPLICATION BARRIER TESTS (35 to 38)
  // =========================================================================

  it('35. 10 Concurrent Claims for same inbound: exactly 1 wins, 9 exit without generation', async () => {
    let generationCount = 0;
    const fakeHttp = {
      post: async () => ({ data: { message_id: 'mid.concurrent.1' } }),
    };

    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql, params) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-conc-1', tenant_id: 't-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-ai-conc', content: params?.[3] }] };
        }
        if (/idempotency_key/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-cust-conc', sender_type: 'CUSTOMER', content: 'Merhaba' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      customerMessage: { id: 'msg-cust-conc' },
      integration: {
        tenant_id: 't-1',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-conc-1', tenant_id: 't-1', customer_external_id: '10203040', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
    };

    const results = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        orchestrateInstagramInboundAiResponse({
          database: mockDb,
          inboundState,
          senderIgsid: '10203040',
          text: 'Merhaba',
          http: fakeHttp,
          generateAiResponse: async () => {
            generationCount++;
            await new Promise((r) => setTimeout(r, 20));
            return 'Tek seferlik yanıt.';
          },
          applyPacing: false,
        })
      )
    );

    const successfulDeliveries = results.filter((r) => r.delivered === true);
    assert.equal(successfulDeliveries.length, 1, 'Exactly ONE concurrent execution must deliver');
    assert.equal(generationCount, 1, 'Generation must be invoked AT MOST once');
  });

  it('36. Delivery/read receipts without message/postback are dropped with null', async () => {
    const { parseInstagramMessagingEvent } = await import('../services/instagram-inbound-adapter.js');

    const deliveryReceipt = {
      sender: { id: '91450420' },
      recipient: { id: '17841400' },
      timestamp: 1727603764000,
      delivery: { mids: ['aWdfZAG1...'], watermark: 1727603764000 },
    };
    assert.equal(parseInstagramMessagingEvent({ id: '17841400' }, deliveryReceipt), null);

    const readReceipt = {
      sender: { id: '91450420' },
      recipient: { id: '17841400' },
      timestamp: 1727603764000,
      read: { watermark: 1727603764000 },
    };
    assert.equal(parseInstagramMessagingEvent({ id: '17841400' }, readReceipt), null);
  });

  it('37. Outbound echo webhooks are recognized and flagged as isEcho: true', async () => {
    const { parseInstagramMessagingEvent } = await import('../services/instagram-inbound-adapter.js');

    const echoEvent = {
      sender: { id: '17841400' },
      recipient: { id: '91450420' },
      timestamp: 1727603764000,
      message: { mid: 'aWdfZAG1...', is_echo: true, text: 'Bot response' },
    };
    const parsed = parseInstagramMessagingEvent({ id: '17841400' }, echoEvent);
    assert.ok(parsed);
    assert.equal(parsed.isEcho, true);
  });

  it('38. Outbound circuit breaker prevents duplicate delivery within 6 seconds', async () => {
    let httpSendCount = 0;
    const fakeHttp = {
      post: async () => {
        httpSendCount++;
        return { data: { message_id: `mid.cb.${httpSendCount}` } };
      },
    };

    const res1 = await deliverInstagramText({
      recipientId: '99887766',
      content: 'Circuit breaker test content message.',
      accessToken: 'EAAB_token',
      http: fakeHttp,
    });

    const res2 = await deliverInstagramText({
      recipientId: '99887766',
      content: 'Circuit breaker test content message.',
      accessToken: 'EAAB_token',
      http: fakeHttp,
    });

    assert.equal(httpSendCount, 1, 'Provider HTTP call must be made exactly ONCE');
    assert.equal(res1.providerMessageId, res2.providerMessageId);
  });

  it('39. Exact physical failure reproduction: sanitizes false promise and removes Customer-Initiated WhatsApp CTA', async () => {
    let deliveredText = '';
    const fakeHttp = {
      post: async (url, payload) => {
        if (payload?.message?.text) {
          deliveredText = payload.message.text;
        }
        return { data: { message_id: 'mid.exact.qual.1' } };
      },
    };

    let ctaDeliveredAtSet = false;
    const mockDb = {
      connect: async () => mockDb,
      release: () => {},
      query: async (sql, params) => {
        if (/FROM conversations/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'conv-real-test', tenant_id: 't-1', channel_id: 'ch-1', contact_id: 'cnt-1', status: 'open', handling_mode: 'AI', handling_version: 1 }] };
        }
        if (/FROM crm_contacts/i.test(sql)) {
          return { rowCount: 1, rows: [{ display_name: 'Suleyman (@suleyman_isseven)', phone: '+905312404965' }] };
        }
        if (/FROM crm_consultations/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/FROM crm_leads/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/INSERT INTO crm_consultations/i.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              id: 'c-new',
              status: 'PENDING',
              phone: '+905312404965',
              requested_time: 'Yarın 14:00',
              cta_url: null,
              cta_delivered_at: null,
            }],
          };
        }
        if (/UPDATE crm_consultations/i.test(sql)) {
          ctaDeliveredAtSet = true;
          return { rowCount: 1, rows: [] };
        }
        if (/INSERT INTO conversation_messages/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 'msg-ai-real', content: params?.[3] }] };
        }
        if (/idempotency_key/i.test(sql)) {
          return { rowCount: 0, rows: [] };
        }
        if (/FROM conversation_messages/i.test(sql)) {
          return {
            rowCount: 3,
            rows: [
              { sender_type: 'CUSTOMER', content: '+905312404965' },
              { sender_type: 'CUSTOMER', content: 'İkiside olabilir' },
              { sender_type: 'CUSTOMER', content: 'Henüz karar vermedim' },
              { sender_type: 'CUSTOMER', content: 'Yarın 14:00 uygunum.GORUSME ICIN' },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      customerMessage: { id: 'msg-cust-final', content: 'Yarın 14:00 uygunum.GORUSME ICIN' },
      integration: {
        tenant_id: 't-1',
        assistant_id: 'ast-1',
        config: { access_token: 'EAAB_token', instagram_account_id: '17841474291887372', activation_policy: 'ALL_MESSAGES' },
      },
      conversation: { id: 'conv-real-test', tenant_id: 't-1', contact_id: 'cnt-1', customer_external_id: '10203040', status: 'open', handling_mode: 'AI', handling_version: 1 },
      shouldInvokeAi: true,
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockDb,
      inboundState,
      senderIgsid: '10203040',
      text: 'Yarın 14:00 uygunum.GORUSME ICIN',
      http: fakeHttp,
      generateAiResponse: async () => 'Yarın saat 14:00 için notumu aldım. Paylaştığınız telefon numarası üzerinden sizinle iletişime geçeceğiz. Görüşmek üzere.',
      applyPacing: false,
    });

    assert.equal(outcome.delivered, true);
    assert.ok(!deliveredText.includes('sizinle iletişime geçeceğiz'), 'False automated promise must be stripped');
    assert.ok(!deliveredText.includes('numara üzerinden'), 'False automated promise must be stripped');
    assert.ok(!deliveredText.includes('https://wa.me/'), 'Customer-Initiated WhatsApp CTA link must NOT be appended');
    assert.ok(!deliveredText.includes('wa.me'), 'wa.me link must not be present');
    assert.ok(deliveredText.includes('görüşme talebinizi kaydettim'));
  });

});
