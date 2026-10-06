import test from 'node:test';
import assert from 'node:assert/strict';
import { sendInstagramMarkSeen } from '../services/instagram-delivery-service.js';
import {
  buildNaturalCustomerConversationPolicy,
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';
import {
  buildInstagramPersonalPersonaInstruction,
  buildInstagramChannelRules,
} from '../services/instagram-ai-orchestrator.js';
import {
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';

test('NATIVE SYNC — sendInstagramMarkSeen safely returns NATIVE_STATE_SYNC_NOT_SUPPORTED without calling Meta API', async () => {
  let httpCalled = false;
  const mockHttp = {
    post: async () => {
      httpCalled = true;
      return { status: 200, data: { success: true } };
    },
  };

  const result = await sendInstagramMarkSeen({
    recipientId: 'instagram:1234567890',
    accessToken: 'test_token_abc',
    http: mockHttp,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NATIVE_STATE_SYNC_NOT_SUPPORTED');
  assert.equal(httpCalled, false, 'Must never make a network call to Meta for mark_seen');
});
test('PERSONA RULE — buildNaturalCustomerConversationPolicy contains first-person direct voice and anti-narration rules', () => {
  const policy = buildNaturalCustomerConversationPolicy('SamChe Company LLC');

  assert.ok(policy.includes('FIRST-PERSON DIRECT PROSE'), 'Must enforce first-person prose');
  assert.ok(policy.includes('NOT NARRATION TEMPLATE'), 'Must instruct that knowledge is fact-only, not narrative template');
  assert.ok(policy.includes('NO UNSOLICITED FOUNDER OR SOCIAL PROMOTION'), 'Must prohibit unsolicited founder/social/YouTube promotion');
  assert.ok(policy.includes('TRUTHFUL AI IDENTITY DISCLOSURE'), 'Must retain truthful AI disclosure when explicitly asked');
});

test('PERSONAL PERSONA — buildInstagramPersonalPersonaInstruction generates first-person directives for personal account', () => {
  const instruction = buildInstagramPersonalPersonaInstruction({
    persona_type: 'PERSONAL',
    speaker_name: 'Samed Tabak',
  });

  assert.ok(instruction.includes('PERSONAL INSTAGRAM FIRST-PERSON SPEAKER DIRECTIVE'));
  assert.ok(instruction.includes('This Instagram account is the personal account of Samed Tabak'));
  assert.ok(instruction.includes('You MUST speak directly AS Samed Tabak in the first person'));
  assert.ok(instruction.includes('Do NOT say "kurucumuz Samed Tabak"'));
  assert.ok(instruction.includes('Do NOT say "[Company] olarak bizler..."'));
  assert.ok(instruction.includes('YouTube sayfamda da detaylı içerikler paylaşıyorum'));
  assert.ok(instruction.includes('EXISTING APPROVED PROMPT REMAINS AUTHORITATIVE'));
});

test('PERSONAL PERSONA — Corporate accounts or unconfigured personas omit personal directive cleanly', () => {
  const instruction1 = buildInstagramPersonalPersonaInstruction({});
  assert.equal(instruction1, '');

  const instruction2 = buildInstagramPersonalPersonaInstruction({ persona_type: 'CORPORATE' });
  assert.equal(instruction2, '');
});

test('PERSONA RULE — buildTenantRuntimeSystemInstruction integrates personal Instagram directive with highest precedence', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    channelRules,
    knowledgeContext: 'Dubai şirket kuruluşu maliyetleri 12.500 AED den başlar. Kurucu Samed Tabak Dubai de 5 yıldır yaşamaktadır.',
  });

  assert.ok(systemInstruction.includes('PERSONAL INSTAGRAM FIRST-PERSON SPEAKER DIRECTIVE'));
  assert.ok(systemInstruction.includes('You MUST speak directly AS Samed Tabak in the first person'));
  assert.ok(systemInstruction.includes('Do NOT say "kurucumuz Samed Tabak"'));
  assert.ok(systemInstruction.includes('YouTube sayfamda da detaylı içerikler paylaşıyorum'));
});

test('PERSONA TEST A — General inquiry ("Dubai\'de şirket kurmak istiyorum"): persona requires first-person Samed response and prohibits "kurucumuz Samed Tabak"', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('Do NOT say "kurucumuz Samed Tabak"'));
  assert.ok(channelRules.includes('You MUST speak directly AS Samed Tabak in the first person'));
});

test('PERSONA TEST B — Earnings inquiry: persona requires first-person voice and prohibits "kurucumuzun deneyimleri" / "Samed Tabak\'ın deneyimleri"', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('kurucumuzun deneyimleri'));
  assert.ok(channelRules.includes('Samed Tabak\'ın...'));
});

test('PERSONA TEST C & D — YouTube inquiries: clickable YouTube URL format is preserved with first-person wording ("YouTube sayfam...")', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('YouTube sayfamda da detaylı içerikler paylaşıyorum: [Samed Tabak YouTube](https://youtube.com/@sametttbk)'));
  assert.ok(channelRules.includes('YouTube sayfamdan da detaylara ulaşabilirsiniz: [Samed Tabak YouTube](https://youtube.com/@sametttbk)'));
});

test('PERSONA TEST E — Explicit founder inquiry ("Samed Tabak kim?"): allowed to answer directly without awkward third-person narration', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('EXPLICIT IDENTITY INQUIRIES'));
  assert.ok(channelRules.includes('asks "Samed Tabak kim?", answer directly and naturally using approved factual knowledge'));
});

test('PERSONA TEST F — Unsupported personal claims: instruction strictly forbids inventing ungrounded experiences', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('NO INVENTED PERSONAL CLAIMS'));
  assert.ok(channelRules.includes('Only express personal experiences or achievements when grounded in approved assistant knowledge'));
});

test('PERSONA ISOLATION — WhatsApp, Web Chat, and AI Guide channel rules remain corporate and untouched', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const whatsappSystemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    channelRules: 'WHATSAPP_CHANNEL_RULES_ONLY',
  });

  assert.ok(!whatsappSystemInstruction.includes('PERSONAL INSTAGRAM FIRST-PERSON SPEAKER DIRECTIVE'));
  assert.ok(whatsappSystemInstruction.includes('WHATSAPP_CHANNEL_RULES_ONLY'));
});


test('DELIVERY PARITY — EXACT PHYSICAL SHAPE: Full Dubai living & rent response delivered completely across chunks with 100% parity', async () => {
  const { deliverInstagramText } = await import('../services/instagram-delivery-service.js');

  const canonicalResponse = `Dubai'de yaşam standartları oldukça yüksek, aileler için güvenli, konforlu ve sosyal olanakları zengin bir çevre sunmaktadır. Eğitim, sağlık ve altyapı uluslararası standartlardadır.

Aile olarak gelmeyi düşündüğünüzde kiralık konut fiyatları seçeceğiniz bölgeye (Downtown, Marina, Business Bay, JVC, Dubai Hills vb.), mülk tipine ve büyüklüğüne göre değişir.

Genel fikir vermesi açısından ortalama yıllık kira aralıkları:
• Stüdyo Daireler: 40.000 - 65.000 AED
• 1+1 Daireler: 60.000 - 100.000 AED
• 2+1 ve Aile Daireleri: 95.000 - 170.000 AED
• Villa ve Müstakil Konutlar: 180.000 AED ve üzeri

Kira fiyatları ortalama olarak aylık 5.000 AED ile 15.000 AED civarından başlar ve genellikle yıllık 1 ila 4 çekle peşin/taksitli ödenir.

Dubai'deki yaşam standartları ve kiralar hakkında daha detaylı bilgiler için, deneyimlerimi paylaştığım YouTube sayfamda daha fazla içerik bulabilirsiniz: [Samed Tabak YouTube](https://youtube.com/@sametttbk). Daha spesifik bir konuda yardımcı olmamı ister misiniz?`;

  const sentPayloads = [];
  const mockHttp = {
    post: async (url, body) => {
      sentPayloads.push(body);
      return { status: 200, data: { message_id: `mid_msg_${sentPayloads.length}` } };
    },
  };

  const deliveryResult = await deliverInstagramText({
    recipientId: 'instagram:1234567890',
    content: canonicalResponse,
    accessToken: 'test_token_valid',
    http: mockHttp,
  });

  assert.equal(deliveryResult.delivery, 'SENT_TO_INSTAGRAM');
  assert.ok(sentPayloads.length >= 2, 'Must split into multiple chunks');
  assert.equal(deliveryResult.chunksDelivered, sentPayloads.length);
  assert.equal(deliveryResult.totalChunks, sentPayloads.length);

  for (const p of sentPayloads) {
    assert.ok(p.message?.text?.length <= 900, `Every chunk must be <= 900 chars, got ${p.message?.text?.length}`);
  }

  const allDeliveredText = sentPayloads.map((p) => p.message?.text).join('\n\n');

  // Verify full fidelity across chunks
  assert.ok(allDeliveredText.includes("Dubai'de yaşam standartları"), 'Beginning must be present');
  assert.ok(allDeliveredText.includes('ortalama yıllık kira aralıkları'), 'Middle must be present');
  assert.ok(allDeliveredText.includes('5.000 AED'), 'Rent amount 5.000 AED must be present');
  assert.ok(allDeliveredText.includes('YouTube sayfamda daha fazla içerik'), 'YouTube guidance sentence must be present');
  assert.ok(allDeliveredText.includes('https://youtube.com/@sametttbk'), 'Complete YouTube URL must be present');
  assert.ok(allDeliveredText.includes('Daha spesifik bir konuda yardımcı olmamı ister misiniz?'), 'Final follow-up question after URL must be present');
});



test('DELIVERY PARITY — Boundary tests: Short, Exact 900, Over 901, and Substantially Long', async () => {
  const { splitIntoInstagramDmChunks } = await import('../services/instagram-delivery-service.js');

  // A. Short response
  const shortText = 'Kısa yanıt. Yardımcı olabilir miyim?';
  const shortChunks = splitIntoInstagramDmChunks(shortText, 900);
  assert.equal(shortChunks.length, 1);
  assert.equal(shortChunks[0], shortText);

  // B. Exactly 900 chars
  const exact900 = 'X'.repeat(900);
  const exactChunks = splitIntoInstagramDmChunks(exact900, 900);
  assert.equal(exactChunks.length, 1);
  assert.equal(exactChunks[0].length, 900);

  // C. Just over boundary (901 chars)
  const over901 = 'Y'.repeat(890) + ' kelime ' + 'Z'.repeat(20);
  const overChunks = splitIntoInstagramDmChunks(over901, 900);
  assert.equal(overChunks.length, 2);
  for (const c of overChunks) {
    assert.ok(c.length <= 900, `Chunk exceeds 900 chars: ${c.length}`);
  }
  assert.ok(overChunks.join(' ').includes('kelime'));

  // D. Substantially long response (3000 chars)
  const longText = Array.from({ length: 6 }, (_, i) => `Paragraf ${i + 1}: ${'Açıklama metni '.repeat(30)}`).join('\n\n');
  const longChunks = splitIntoInstagramDmChunks(longText, 900);
  assert.ok(longChunks.length >= 3);
  for (const c of longChunks) {
    assert.ok(c.length <= 900, `Long chunk exceeds 900: ${c.length}`);
  }
});

test('DELIVERY PARITY — URL at boundary remains completely intact without middle splits', async () => {
  const { splitIntoInstagramDmChunks } = await import('../services/instagram-delivery-service.js');

  const padding = 'P'.repeat(850);
  const textWithUrlAtBoundary = `${padding} Bilgi için: [Samed Tabak YouTube](https://youtube.com/@sametttbk) kanalını inceleyebilirsiniz. Sonraki soru?`;
  const chunks = splitIntoInstagramDmChunks(textWithUrlAtBoundary, 900);

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].length <= 900);
  assert.ok(chunks[1].length <= 900);

  const combined = chunks.join(' ');
  assert.ok(combined.includes('[Samed Tabak YouTube](https://youtube.com/@sametttbk)'), 'Markdown link and URL must remain 100% intact');
  assert.ok(combined.includes('Sonraki soru?'), 'Text after link must be preserved');
});

test('DELIVERY PARITY — Turkish Unicode characters preserved across chunk boundaries', async () => {
  const { splitIntoInstagramDmChunks } = await import('../services/instagram-delivery-service.js');

  const turkishText = "İstanbul'da yaşayan Çağlar Şimşek, Öğretmenlik ve Mühendislik süreçlerini araştırıyor. Ğüşıöç İĞÜŞÖÇ. ".repeat(15);
  const chunks = splitIntoInstagramDmChunks(turkishText, 900);

  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(c.length <= 900);
    assert.ok(!c.includes('\uFFFD'), 'No corrupted Unicode replacement characters');
    assert.ok(c.includes('Çağlar') || c.includes('Şimşek') || c.includes('Ğüşıöç'));
  }
});

test('DELIVERY PARITY — Partial delivery failure (chunk 1 success, chunk 2 fail) throws observable error with failed chunk telemetry', async () => {
  const { deliverInstagramText } = await import('../services/instagram-delivery-service.js');

  const multiChunkText = 'Birinci Bölüm: ' + 'A'.repeat(850) + '\n\nİkinci Bölüm: ' + 'B'.repeat(500);

  let calls = 0;
  const mockHttpFailOnChunk2 = {
    post: async () => {
      calls++;
      if (calls === 1) {
        return { status: 200, data: { message_id: 'mid_chunk_1' } };
      }
      const err = new Error('Meta API error: (#4) Rate limit exceeded');
      err.response = { status: 429, data: { error: { message: 'Rate limited', code: 4 } } };
      throw err;
    },
  };

  await assert.rejects(
    async () => {
      await deliverInstagramText({
        recipientId: 'instagram:1234567890',
        content: multiChunkText,
        accessToken: 'test_token_valid',
        http: mockHttpFailOnChunk2,
      });
    },
    (err) => {
      assert.equal(err.chunkIndex, 1, 'Must record chunkIndex = 1 as failed chunk');
      assert.equal(err.totalChunks, 2, 'Must record totalChunks = 2');
      assert.deepEqual(err.deliveredProviderIds, ['mid_chunk_1'], 'Must record chunk 1 as delivered');
      return true;
    }
  );
});
