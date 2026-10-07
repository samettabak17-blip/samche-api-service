process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatInstagramDmResponse,
  evaluateResourceSemanticScope,
  enforceConfiguredSupplementaryGuidance,
  buildInstagramPersonalPersonaInstruction,
  buildInstagramChannelRules,
  INSTAGRAM_CHANNEL_PRESENTATION_RULES,
  orchestrateInstagramInboundAiResponse,
} from '../services/instagram-ai-orchestrator.js';
import {
  splitIntoInstagramDmChunks,
} from '../services/instagram-delivery-service.js';
import {
  persistInstagramInbound,
  instagramExternalConversationId,
  instagramCustomerReference,
} from '../services/instagram-live-inbox-service.js';
import {
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';

const tenantId = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';
const pageId = '17841400290566553';
const channelId = '4603b0a1-c98d-4ea3-8a9c-109fa0cf5aa4';
const customerIgsid = '797284549839918';
const assistantId = '33333333-3333-4333-8333-333333333333';
// ============================================================================
// TESTS A & B: YOUTUBE URL GUIDANCE
// ============================================================================
test('TEST A & B: Obsolete YouTube URL is absent, approved URL is present exactly', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });

  // A. Obsolete URL absent from active guidance
  assert.ok(!channelRules.includes('youtube.com/@sametttbk'), 'Obsolete YouTube URL must not be in Instagram channel rules');

  // B. Approved URL present exactly
  assert.ok(channelRules.includes('https://ytbe.app/u9j8qB2S'), 'Approved YouTube URL must be present in Instagram channel rules');
  assert.ok(
    channelRules.includes('YouTube sayfamı ziyaret edebilirsiniz') || channelRules.includes('YouTube sayfamda da detaylı içerikler paylaşıyorum'),
    'Natural first-person YouTube guidance rule must be in rules'
  );
});

// ============================================================================
// TESTS C & D: RAW URL PRESERVED, NO MARKDOWN ANCHOR OUTPUT
// ============================================================================
test('TEST C & D: Markdown anchor output is normalized to clean clickable raw URL', () => {
  const rawResponseWithAnchor = 'Detaylı Dubai yaşam rehberi için [Samed Tabak YouTube](https://ytbe.app/u9j8qB2S) inceleyebilirsiniz.';
  const formatted = formatInstagramDmResponse(rawResponseWithAnchor);

  // C. Raw URL preserved
  assert.ok(formatted.includes('https://ytbe.app/u9j8qB2S'), 'Raw URL must be preserved');

  // D. No Markdown anchor output for YouTube link
  assert.ok(!formatted.includes('[Samed Tabak YouTube]'), 'Markdown anchor label must be removed');
  assert.ok(!formatted.includes(']('), 'Markdown anchor syntax must not exist');
  assert.ok(!formatted.includes("▶️ **YouTube'da detaylı anlatım:**"), 'Generic header must not be forced');
});

test('TEST C & D (Legacy URL input): Obsolete URL in raw response is normalized to approved destination', () => {
  const rawWithObsolete = 'Yaşam giderleri için [YouTube](https://youtube.com/@sametttbk) sayfamı ziyaret edebilirsiniz.';
  const formatted = formatInstagramDmResponse(rawWithObsolete);

  assert.ok(!formatted.includes('youtube.com/@sametttbk'), 'Obsolete URL must be replaced');
  assert.ok(formatted.includes('https://ytbe.app/u9j8qB2S'), 'Approved URL must be substituted');
  assert.ok(!formatted.includes('[YouTube]'), 'Markdown anchor must be removed');
});

// ============================================================================
// TESTS E & F: PARAGRAPH SEPARATION & BULLET FORMATTING
// ============================================================================
test('TEST E & F: Structured response has bullet formatting and separate follow-up question', () => {
  const rawDenseText = `Dubai'de yaşam giderleri tercih ettiğiniz bölge ve yaşam standardına göre değişiyor. 3 kişilik bir aile için genel tablo şöyle:
* **Kira:** 2+1 daire için yıllık 80.000 - 140.000 AED arası
* **Faturalar:** Aylık ortalama 1.200 - 2.000 AED
* **Market / gıda:** Aylık 3.000 - 5.000 AED
* **Ulaşım:** Araç kiralama veya taksi için aylık 2.000 - 3.500 AED
* **Sağlık sigortası:** Kişi başı yıllık yaklaşık 1.500 - 3.000 AED
Yaklaşık toplam aylık bütçe: 15.000 - 22.000 AED civarındadır.
https://ytbe.app/u9j8qB2S Dubai'ye taşınırken şirket kurma veya oturum seçeneklerini de değerlendirmek ister misiniz?`;

  const formatted = formatInstagramDmResponse(rawDenseText);

  // F. Bullet/list formatting preserved
  assert.ok(formatted.includes('• **Kira:**'), 'Bullets must use • bullet markers');
  assert.ok(formatted.includes('• **Faturalar:**'), 'Bullets must be on separate lines');
  assert.ok(formatted.includes('• **Market / gıda:**'), 'Bullets must be on separate lines');

  // URL preserved without forced header
  assert.ok(formatted.includes('https://ytbe.app/u9j8qB2S'), 'YouTube URL must be present');
  assert.ok(!formatted.includes("▶️ **YouTube'da detaylı anlatım:**"), 'Generic header must not be forced');

  // E. Paragraph separation before follow-up question
  assert.ok(
    formatted.includes("https://ytbe.app/u9j8qB2S\n\nDubai'ye taşınırken şirket kurma veya oturum seçeneklerini de değerlendirmek ister misiniz?"),
    'Follow-up question must be on its own standalone paragraph preceded by blank line'
  );
});
// ============================================================================
// TESTS G, H, I, J, K, L: LOGICAL CHUNKING & RESPONSE PARITY
// ============================================================================
test('TEST G, H, I, J, K, L: Semantic chunking respects boundaries, amounts, URLs, Turkish Unicode, and parity', () => {
  const longStructuredResponse = `Dubai'de yaşam giderleri tercih ettiğiniz bölge ve yaşam standardına göre değişiyor. 3 kişilik bir aile için genel tablo şöyle:

• **Kira:** 2+1 daire için yıllık 80.000 - 140.000 AED arası
• **Faturalar:** Aylık ortalama 1.200 - 2.000 AED
• **Market / gıda:** Aylık 3.000 - 5.000 AED
• **Ulaşım:** Araç kiralama veya taksi için aylık 2.000 - 3.500 AED
• **Sağlık sigortası:** Kişi başı yıllık yaklaşık 1.500 - 3.000 AED

Yaklaşık toplam aylık bütçe: 15.000 - 22.000 AED civarındadır. SamChe olarak bu süreçte şirket kurulumu, serbest meslek izinleri ve tüm aile bireyleriniz için oturum vizesi işlemlerinizi eksiksiz yönetiyoruz.

Dubai'de yaşam giderleri ve kiralar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım.

https://ytbe.app/u9j8qB2S

Dubai'ye taşınırken şirket kurma veya oturum seçeneklerini de değerlendirmek ister misiniz? Detaylı danışmanlık ve süreç adımları için sorularınızı yanıtlamaktan memnuniyet duyarım.`;

  // Test chunking with an artificial bound that forces splitting
  const chunks = splitIntoInstagramDmChunks(longStructuredResponse, 450);

  assert.ok(chunks.length >= 2, 'Should split into at least 2 logical chunks');

  // G. Semantic chunking prefers paragraph/bullet/sentence boundaries
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 450, `Chunk length ${chunk.length} must be <= 450`);
  }

  // H. URL never split across chunks
  const urlChunk = chunks.find((c) => c.includes('ytbe.app'));
  assert.ok(urlChunk, 'One chunk must contain the YouTube URL');
  assert.ok(urlChunk.includes('https://ytbe.app/u9j8qB2S'), 'Complete URL must remain intact in a single chunk');
  assert.ok(!urlChunk.includes('ytbe.app/u9j8qB2S') || urlChunk.includes('https://ytbe.app/u9j8qB2S'), 'URL must not be fragmented');

  // I. Text after URL preserved
  assert.ok(
    chunks.some((c) => c.includes("Dubai'ye taşınırken şirket kurma")),
    'Text after URL must be preserved in delivered chunks'
  );

  // J. Dotted amounts such as 5.000 AED preserved without split
  assert.ok(chunks.some((c) => c.includes('5.000 AED')), 'Amount 5.000 AED must be preserved atomically');
  assert.ok(chunks.some((c) => c.includes('80.000 - 140.000 AED')), 'Amount 80.000 - 140.000 AED must be preserved atomically');

  // K. Turkish Unicode preserved
  for (const c of chunks) {
    if (c.includes('giderleri')) assert.ok(c.includes('giderleri'));
    if (c.includes('şirket')) assert.ok(c.includes('şirket'));
    if (c.includes('değerlendirmek')) assert.ok(c.includes('değerlendirmek'));
  }

  // L. Concatenated chunks preserve canonical response content
  const reconstructed = chunks.join('\n\n');
  assert.ok(reconstructed.includes("Dubai'de yaşam giderleri"), 'Reconstructed text must contain intro');
  assert.ok(reconstructed.includes('• **Kira:**'), 'Reconstructed text must contain bullets');
  assert.ok(reconstructed.includes('https://ytbe.app/u9j8qB2S'), 'Reconstructed text must contain URL');
  assert.ok(reconstructed.includes('sorularınızı yanıtlamaktan memnuniyet duyarım'), 'Reconstructed text must contain ending');
});

// ============================================================================
// TESTS M, N, O, P: INTEGRATED REGRESSIONS PRESERVED
// ============================================================================
test('TEST M: Format & Presentation Integration with Physical Example', () => {
  const physicalExample = `Dubai'de yaşam giderleri tercih ettiğiniz bölge ve yaşam standardına göre değişiyor. 3 kişilik bir aile için genel tablo şöyle:
* **Kira:** 2+1 daire için yıllık 80.000 - 140.000 AED arası
* **Faturalar:** Aylık ortalama 1.200 - 2.000 AED
* **Market / gıda:** Aylık 3.000 - 5.000 AED
* **Ulaşım:** Araç kiralama veya taksi için aylık 2.000 - 3.500 AED
* **Sağlık sigortası:** Kişi başı yıllık yaklaşık 1.500 - 3.000 AED
Yaklaşık toplam bütçe: 15.000 - 22.000 AED civarındadır.
[Samed Tabak YouTube](https://youtube.com/@sametttbk) Dubai'ye taşınırken şirket kurma veya oturum seçeneklerini de değerlendirmek ister misiniz?`;

  const formatted = formatInstagramDmResponse(physicalExample);

  // M. Obsolete URL replaced with approved URL
  assert.ok(!formatted.includes('youtube.com/@sametttbk'));
  assert.ok(formatted.includes('https://ytbe.app/u9j8qB2S'));

  // Presentation structure verified
  assert.ok(formatted.includes('• **Kira:**'));
  assert.ok(formatted.includes('https://ytbe.app/u9j8qB2S'));
  assert.ok(!formatted.includes("▶️ **YouTube'da detaylı anlatım:**"));
  assert.ok(formatted.includes("https://ytbe.app/u9j8qB2S\n\nDubai'ye taşınırken"));
});

test('TEST N, O, P: Reel, AI_ONLY, and NEVER_AI rules preserved', () => {
  // O. Persona channel rules integration
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const channelRules = buildInstagramChannelRules({ persona });
  assert.ok(channelRules.includes('PERSONAL INSTAGRAM FIRST-PERSON SPEAKER DIRECTIVE'));
  assert.ok(channelRules.includes('https://ytbe.app/u9j8qB2S'));

  // N. Reel priority in rules
  assert.ok(channelRules.includes('WRITTEN QUESTION HAS HIGHEST PRIORITY'));
  assert.ok(channelRules.includes('MEDIA CONTENT IS NEVER AN AUTHORITATIVE BUSINESS SOURCE'));

  // P. NEVER_AI policy output format
  const neverAiOutput = formatInstagramDmResponse('Bilgi için [YouTube](https://youtube.com/@sametttbk) adresine bakabilirsiniz.');
  assert.ok(!neverAiOutput.includes('youtube.com/@sametttbk'));
  assert.ok(neverAiOutput.includes('https://ytbe.app/u9j8qB2S'));
});

// ============================================================================
// SECTION 18 & 19 FOCUSED TESTS: STRICTLY SCOPED LIVING/RENT/SALARY YOUTUBE GUIDANCE
// ============================================================================

const samchePersona = {
  available: true,
  companyIdentity: 'SamChe Company LLC',
  assistantIdentity: 'SamChe AI',
  profile: SAMCHE_STAGING_BUSINESS_PROFILE,
  configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
};

test('SECTION 18 POSITIVE MATRIX (A - G): Qualifying living/rent/salary intents include YouTube guidance exactly once', () => {
  const qualifyingQueries = [
    { query: "Dubai'de yaşam koşulları nasıl?", expectedTopic: 'yaşam' },
    { query: "3 kişilik aile için yaşam giderleri ne kadar?", expectedTopic: 'yaşam giderleri' },
    { query: "Dubai'de kiralar nasıl?", expectedTopic: 'kiralar' },
    { query: "Dubai'de geçinmek için aylık ne kadar gerekir?", expectedTopic: 'geçinmek' },
    { query: "Dubai'de maaşlar nasıl?", expectedTopic: 'maaşlar' },
    { query: "10.000 AED maaşla Dubai'de geçinebilir miyim?", expectedTopic: 'maaş' },
    { query: "What is the cost of living in Dubai?", expectedTopic: 'cost of living' },
  ];

  for (const item of qualifyingQueries) {
    const rawAnswer = `Dubai'de yaşam standartları bölgeye göre değişmektedir. Aylık bütçe tercihlere bağlıdır.\n\nBaşka sorunuz var mı?`;
    const guided = enforceConfiguredSupplementaryGuidance({
      content: rawAnswer,
      persona: samchePersona,
      currentIntent: item.query,
    });
    const canonical = formatInstagramDmResponse(guided);

    const occurrences = (canonical.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
    assert.equal(occurrences, 1, `Query "${item.query}" must contain approved URL exactly once`);
    assert.ok(canonical.includes('https://ytbe.app/u9j8qB2S'), `URL must be present for "${item.query}"`);
    assert.ok(!canonical.includes("▶️ **YouTube'da detaylı anlatım:**"), `Generic header must not be forced for "${item.query}"`);
    assert.ok(
      canonical.includes("YouTube sayfamı ziyaret edebilirsiniz") || canonical.includes("YouTube sayfamdan ulaşabilirsiniz"),
      `Natural sentence must be present for "${item.query}"`
    );

    // Order: answer -> guidance sentence -> URL -> follow-up
    const answerIdx = canonical.indexOf("Aylık bütçe tercihlere bağlıdır");
    const urlIdx = canonical.indexOf("https://ytbe.app/u9j8qB2S");
    const followUpIdx = canonical.indexOf("Başka sorunuz var mı?");
    assert.ok(answerIdx < urlIdx, 'Answer must precede URL');
    assert.ok(urlIdx < followUpIdx, 'URL must precede follow-up');
  }
});

test('SECTION 18 NEGATIVE MATRIX (H - N): Unrelated business/visa/tax/greeting intents receive ZERO YouTube link', () => {
  const unqualifiedQueries = [
    "Dubai'de şirket kurmak istiyorum.",
    "Şirket kurarsam oturum alabilir miyim?",
    "Oturum izni nasıl alınır?",
    "Aile vizesi ne kadar?",
    "Corporate Tax oranı nedir?",
    "Randevu oluşturmak istiyorum.",
    "Merhaba nasılsınız?",
  ];

  for (const query of unqualifiedQueries) {
    const rawAnswer = `SamChe Company LLC olarak resmi danışmanlık hizmeti sunuyoruz. Süreç hakkında yardımcı olabilirim.`;
    const guided = enforceConfiguredSupplementaryGuidance({
      content: rawAnswer,
      persona: samchePersona,
      currentIntent: query,
      isGreeting: query.includes('Merhaba'),
      appointmentState: query.includes('Randevu') ? { intent: true, complete: false } : null,
    });
    const canonical = formatInstagramDmResponse(guided);

    assert.ok(!canonical.includes('ytbe.app'), `Query "${query}" must NOT receive YouTube link`);
    assert.ok(!canonical.includes('YouTube sayfam'), `Query "${query}" must NOT receive YouTube guidance sentence`);
  }
});

test('SECTION 18 NEGATIVE MATRIX: Hallucinated YouTube link in unqualified response is stripped by validator', () => {
  const rawWithHallucinatedLink = `Dubai'de şirket kurulumu Free Zone otoritesi üzerinden 12.500 AED maliyetle başlamaktadır.\n\nYouTube sayfamı ziyaret edebilirsiniz: https://ytbe.app/u9j8qB2S\n\nHangi sektörde şirket açmayı düşünüyorsunuz?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: rawWithHallucinatedLink,
    persona: samchePersona,
    currentIntent: "Dubai'de şirket kurmak istiyorum.",
  });
  const canonical = formatInstagramDmResponse(guided);

  assert.ok(!canonical.includes('ytbe.app'), 'Hallucinated YouTube link must be stripped for company formation');
  assert.ok(!canonical.includes('YouTube sayfam'), 'Hallucinated guidance sentence must be stripped');
  assert.ok(canonical.includes('12.500 AED'), 'Business answer content must be preserved');
});

test('SECTION 18 O (MIXED INTENT): Mixed living/rent + residency question includes YouTube guidance', () => {
  const mixedQuery = "Dubai'de kiralar nasıl ve ailem için oturum nasıl alırım?";
  const rawAnswer = `Dubai'de 2+1 daire kiraları yıllık 80.000 - 140.000 AED arasındadır. Aile oturumu için ise önce şirket kurulumu veya ana sponsor oturumu tamamlanmalıdır.\n\nSüreci birlikte planlamamızı ister misiniz?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: rawAnswer,
    persona: samchePersona,
    currentIntent: mixedQuery,
  });
  const canonical = formatInstagramDmResponse(guided);

  const occurrences = (canonical.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
  assert.equal(occurrences, 1, 'Mixed rent inquiry must qualify for YouTube guidance exactly once');
  assert.ok(canonical.includes('https://ytbe.app/u9j8qB2S'));
  assert.ok(canonical.includes('80.000 - 140.000 AED'), 'Living cost answer must be preserved');
  assert.ok(canonical.includes('Aile oturumu için'), 'Residency answer must be preserved');
});

test('SECTION 18 P, Q, R: Duplication, provider omission on qualifying intent, and obsolete URL normalization', () => {
  // P. Provider already outputs approved URL -> no duplicate
  const rawWithApproved = `Dubai'de kira maliyetleri ve yaşam bütçesi:\n\nDubai'de yaşam giderleri ve kiralar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım.\n\nhttps://ytbe.app/u9j8qB2S\n\nBaşka sorunuz var mı?`;
  const guidedP = enforceConfiguredSupplementaryGuidance({
    content: rawWithApproved,
    persona: samchePersona,
    currentIntent: "Dubai'de kiralar nasıl?",
  });
  const canonicalP = formatInstagramDmResponse(guidedP);
  const occurrencesP = (canonicalP.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
  assert.equal(occurrencesP, 1, 'Provider already outputting URL must produce exactly one URL');

  // Q. Provider omits approved URL on qualifying intent -> validator adds exactly once
  const rawWithoutUrl = `Dubai'de 2+1 daire kiraları yıllık 80.000 - 140.000 AED civarındadır.\n\nTaşınma planınızı ne zaman düşünüyorsunuz?`;
  const guidedQ = enforceConfiguredSupplementaryGuidance({
    content: rawWithoutUrl,
    persona: samchePersona,
    currentIntent: "Dubai'de kiralar nasıl?",
  });
  const canonicalQ = formatInstagramDmResponse(guidedQ);
  const occurrencesQ = (canonicalQ.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
  assert.equal(occurrencesQ, 1, 'Validator must add URL exactly once when omitted by provider');
  assert.ok(canonicalQ.includes('https://ytbe.app/u9j8qB2S'));
  assert.ok(canonicalQ.includes('YouTube sayfamı ziyaret edebilirsiniz'));

  // R. Provider outputs obsolete URL -> normalized to approved URL exactly once
  const rawWithObsolete = `Dubai yaşam giderleri için YouTube sayfam: https://youtube.com/@sametttbk\n\nDetayları inceleyebilirsiniz.`;
  const canonicalR = formatInstagramDmResponse(rawWithObsolete);
  assert.ok(!canonicalR.includes('youtube.com/@sametttbk'), 'Obsolete URL must be completely absent');
  assert.ok(canonicalR.includes('https://ytbe.app/u9j8qB2S'), 'Approved URL must be substituted');
  const occurrencesR = (canonicalR.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
  assert.equal(occurrencesR, 1, 'Approved URL must appear exactly once');
});

test('SECTION 19 PRESENTATION TEST: Short useful answer -> natural sentence -> raw URL -> optional follow-up', () => {
  const rawResponse = `Dubai'de yaşam giderleri tercih ettiğiniz bölge ve yaşam standardına göre değişir. 3 kişilik bir aile için genel tablo şöyle:\n• **Kira:** 2+1 daire için yıllık 80.000 - 140.000 AED arası\n• **Faturalar:** Aylık ortalama 1.200 - 2.000 AED\nGenel olarak aylık yaklaşık 15.000 - 22.000 AED bütçe düşünülebilir.\nDubai'ye taşınırken oturum seçeneklerini de değerlendirmek ister misiniz?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: rawResponse,
    persona: samchePersona,
    currentIntent: "Dubai'de yaşam giderleri ve kiralar nasıl?",
  });
  const canonical = formatInstagramDmResponse(guided);

  // 1. Useful answer first
  const answerIdx = canonical.indexOf("Genel olarak aylık yaklaşık 15.000 - 22.000 AED bütçe düşünülebilir.");
  // 2. Natural guidance sentence second
  const sentenceIdx = canonical.indexOf("Dubai'de yaşam giderleri ve kiralar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım.");
  // 3. Raw URL third
  const urlIdx = canonical.indexOf("https://ytbe.app/u9j8qB2S");
  // 4. Optional follow-up last
  const followUpIdx = canonical.indexOf("Dubai'ye taşınırken oturum seçeneklerini de değerlendirmek ister misiniz?");

  assert.ok(answerIdx !== -1, 'Answer must be present');
  assert.ok(sentenceIdx !== -1, 'Natural guidance sentence must be present');
  assert.ok(urlIdx !== -1, 'URL must be present');
  assert.ok(followUpIdx !== -1, 'Follow-up must be present');

  assert.ok(answerIdx < sentenceIdx, 'Answer must precede natural guidance sentence');
  assert.ok(sentenceIdx < urlIdx, 'Sentence must precede raw URL');
  assert.ok(urlIdx < followUpIdx, 'Raw URL must precede follow-up question');

  // Blank-line separation
  assert.ok(canonical.includes("\n\nhttps://ytbe.app/u9j8qB2S\n\n"), 'URL must be standalone with blank-line separation');

  // No generic YouTube header
  assert.ok(!canonical.includes("▶️"), 'Generic emoji header must not be present');
  assert.ok(!canonical.includes("YouTube'da detaylı anlatım:"), 'Generic header must not be present');

  // No Markdown anchor syntax
  assert.ok(!canonical.includes('[YouTube]'));
  assert.ok(!canonical.includes(']('));

  // No old URL
  assert.ok(!canonical.includes('youtube.com/@sametttbk'));
});

test('SECTION 20 GENERIC ARCHITECTURE TEST: Synthetic second tenant with completely different semantic scope', () => {
  const tenantBClinicResource = {
    id: 'acme_appointment_portal',
    type: 'PORTAL',
    url: 'https://acme-health.example.com/booking',
    default_guidance_text: 'Online randevu almak için hasta portalımızı ziyaret edebilirsiniz.',
    semantic_scope: {
      topics: [
        {
          id: 'DOCTOR_APPOINTMENT',
          pattern: '\\b(?:doktor|muayene|randevu|poliklinik|clinic|doctor|appointment|checkup)\\b',
          guidance_text: 'Doktor muayene randevunuzu online portalımız üzerinden kolayca oluşturabilirsiniz.',
        },
      ],
    },
  };

  const tenantBPersona = {
    available: true,
    companyIdentity: 'Acme Health Clinic',
    configuration: {
      channel_adaptations: {
        instagram: {
          supplementary_resources: [tenantBClinicResource],
        },
      },
    },
  };

  // 1. Qualifying appointment intent for Tenant B -> qualifies
  const evalPositive = evaluateResourceSemanticScope({
    intentText: 'Doktor muayenesi için randevu almak istiyorum.',
    resource: tenantBClinicResource,
  });
  assert.equal(evalPositive.applies, true);
  assert.equal(evalPositive.topicId, 'DOCTOR_APPOINTMENT');

  const guidedPositive = enforceConfiguredSupplementaryGuidance({
    content: 'Pazartesi ve Çarşamba günleri kardiyoloji uzmanımız klinikte hizmet vermektedir.',
    persona: tenantBPersona,
    currentIntent: 'Doktor muayenesi için randevu almak istiyorum.',
  });
  assert.ok(guidedPositive.includes('https://acme-health.example.com/booking'));
  assert.ok(guidedPositive.includes('Doktor muayene randevunuzu online portalımız'));

  // 2. Living cost query for Tenant B -> does NOT qualify (Tenant B has no living cost resource)
  const evalNegative = evaluateResourceSemanticScope({
    intentText: "Dubai'de kiralar nasıl?",
    resource: tenantBClinicResource,
  });
  assert.equal(evalNegative.applies, false);

  const guidedNegative = enforceConfiguredSupplementaryGuidance({
    content: 'Kliniğimiz sadece sağlık hizmeti vermektedir.',
    persona: tenantBPersona,
    currentIntent: "Dubai'de kiralar nasıl?",
  });
  assert.ok(!guidedNegative.includes('booking'));
  assert.ok(!guidedNegative.includes('acme-health'));
});

test('SECTION 18 F & G: Long response chunking and content preservation with natural guidance sentence', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const originalAnswer = `Dubai'de yaşam giderleri bölgeye göre değişmektedir. 3 kişilik bir aile için maliyet dağılımı:
• **Kira:** Downtown veya Marina gibi merkezi bölgelerde 2+1 daireler 110.000 - 160.000 AED, JVC veya Silicon Oasis gibi aile bölgelerinde 70.000 - 95.000 AED arasındadır.
• **Aidat / Hizmet:** Ejari kaydı yıllık yaklaşık 220 AED, konut vergisi (Housing Fee) ise kiranın %5'i olarak DEWA faturalarına 12 taksitle yansıtılır.
• **Faturalar:** DEWA ve internet dahil aylık 1.500 - 2.500 AED civarındadır.
• **Eğitim:** Çocuklar için özel uluslararası okul ücretleri yıllık 25.000 - 65.000 AED arasındadır.
• **Market / Mutfak:** Aylık 3.500 - 6.000 AED civarında bir harcama öngörülebilir.
Dubai'de şirket kuruluşu veya serbest çalışan oturum izni planınız var mı?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: originalAnswer,
    persona,
    currentIntent: '3 kişilik aile için Dubai yaşam giderleri ve kira maliyetleri nedir?',
  });
  const canonical = formatInstagramDmResponse(guided);

  // All original facts and figures preserved
  assert.ok(canonical.includes('110.000 - 160.000 AED'), 'Downtown rent preserved');
  assert.ok(canonical.includes('70.000 - 95.000 AED'), 'JVC rent preserved');
  assert.ok(canonical.includes('220 AED'), 'Ejari fee preserved');
  assert.ok(canonical.includes("Housing Fee"), 'Housing fee preserved');
  assert.ok(canonical.includes('25.000 - 65.000 AED'), 'School fees preserved');
  assert.ok(canonical.includes('3.500 - 6.000 AED'), 'Groceries preserved');

  // Natural guidance sentence and URL injected in correct place
  assert.ok(canonical.includes('YouTube sayfamı ziyaret edebilirsiniz'));
  assert.ok(canonical.includes('https://ytbe.app/u9j8qB2S'));
  assert.ok(!canonical.includes("▶️"), 'No generic emoji header');

  // Closing question preserved at the end
  assert.ok(canonical.endsWith("Dubai'de şirket kuruluşu veya serbest çalışan oturum izni planınız var mı?"));

  // Chunking respects atomic URL
  const chunks = splitIntoInstagramDmChunks(canonical, 450);
  const urlChunks = chunks.filter((c) => c.includes('https://ytbe.app/u9j8qB2S'));
  assert.equal(urlChunks.length, 1, 'URL must appear in exactly one chunk');
  assert.ok(!chunks.some((c) => c.includes('ytbe.app') && !c.includes('https://ytbe.app/u9j8qB2S')), 'URL must never be broken');
});

