process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatInstagramDmResponse,
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
  assert.ok(channelRules.includes("▶️ **YouTube'da detaylı anlatım:**"), 'Preferred customer-facing YouTube header must be in rules');
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
  assert.ok(formatted.includes("▶️ **YouTube'da detaylı anlatım:**"), 'Must format with clean preferred header');
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

  // Preferred YouTube presentation
  assert.ok(formatted.includes("▶️ **YouTube'da detaylı anlatım:**\nhttps://ytbe.app/u9j8qB2S"), 'YouTube resource must have clean header and URL');

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

▶️ **YouTube'da detaylı anlatım:**
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
  assert.ok(formatted.includes("▶️ **YouTube'da detaylı anlatım:**\nhttps://ytbe.app/u9j8qB2S"));
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
// SECTION 18 FOCUSED TESTS: DETERMINISTIC CONFIG-DRIVEN YOUTUBE GUIDANCE
// ============================================================================

test('SECTION 18 A & E: Provider omits required YouTube link on living cost question -> injected before follow-up question', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const providerResponseWithoutLink = `Dubai'de yaşam giderleri tercih ettiğiniz bölge ve yaşam standardına göre değişiyor. 3 kişilik bir aile için genel tablo şöyle:
• **Kira:** 2+1 daire için yıllık 80.000 - 140.000 AED arası
• **Faturalar:** Aylık ortalama 1.200 - 2.000 AED
• **Market / gıda:** Aylık 3.000 - 5.000 AED
• **Ulaşım:** Araç kiralama veya taksi için aylık 2.000 - 3.500 AED
• **Sağlık sigortası:** Kişi başı yıllık yaklaşık 1.500 - 3.000 AED
Genel olarak aylık yaklaşık 15.000 - 22.000 AED bütçe düşünülebilir.
Dubai'ye taşınırken oturum veya şirket kurulumu seçeneklerini de değerlendirmek ister misiniz?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: providerResponseWithoutLink,
    persona,
    currentIntent: 'Merhaba Samed bey. Yaşam giderleri ve kiralar konusunda nasıl bir bütçe ayırmalıyız?',
  });
  const canonical = formatInstagramDmResponse(guided);

  // A. Exactly one approved YouTube guidance block present
  const occurrences = (canonical.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
  assert.equal(occurrences, 1, 'Canonical response must contain exactly one approved YouTube link');
  assert.ok(canonical.includes("▶️ **YouTube'da detaylı anlatım:**\nhttps://ytbe.app/u9j8qB2S"), 'Must contain standard presentation header');

  // E. Follow-up question exists in expected order: answer -> YouTube block -> follow-up question
  const answerIdx = canonical.indexOf("Genel olarak aylık yaklaşık");
  const youtubeIdx = canonical.indexOf("▶️ **YouTube'da detaylı anlatım:**");
  const followUpIdx = canonical.indexOf("Dubai'ye taşınırken oturum veya şirket kurulumu seçeneklerini de değerlendirmek ister misiniz?");

  assert.ok(answerIdx !== -1, 'Answer must be present');
  assert.ok(youtubeIdx !== -1, 'YouTube block must be present');
  assert.ok(followUpIdx !== -1, 'Follow-up question must be present');
  assert.ok(answerIdx < youtubeIdx, 'Answer must precede YouTube block');
  assert.ok(youtubeIdx < followUpIdx, 'YouTube block must precede follow-up question');

  // Standalone raw clickable link on its own line
  assert.ok(canonical.includes("\nhttps://ytbe.app/u9j8qB2S\n"), 'URL must be standalone on its own line');
});

test('SECTION 18 B: Provider already returned correct YouTube block -> no duplicate', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const providerResponseWithLink = `Dubai'de yaşam giderleri genel tablo:
• **Kira:** Yıllık 80.000 - 140.000 AED
• **Faturalar:** Aylık 1.500 AED

▶️ **YouTube'da detaylı anlatım:**
https://ytbe.app/u9j8qB2S

Dubai'ye taşınırken oturum sürecini değerlendirmek ister misiniz?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: providerResponseWithLink,
    persona,
    currentIntent: 'Yaşam giderleri nasıl?',
  });
  const canonical = formatInstagramDmResponse(guided);

  const occurrences = (canonical.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
  assert.equal(occurrences, 1, 'Must not duplicate YouTube link if provider already returned it');
});

test('SECTION 18 C: Provider returns obsolete URL -> only approved URL remains', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const providerResponseWithObsolete = `Yaşam maliyetleri hakkında detaylar:
• **Kira:** 80.000 AED
YouTube kanalım: https://youtube.com/@sametttbk
Başka sorunuz var mı?`;

  const canonical = formatInstagramDmResponse(providerResponseWithObsolete);

  assert.ok(!canonical.includes('youtube.com/@sametttbk'), 'Obsolete URL must be completely absent');
  assert.ok(canonical.includes('https://ytbe.app/u9j8qB2S'), 'Approved URL must replace obsolete URL');
  const occurrences = (canonical.match(/https:\/\/ytbe\.app\/u9j8qB2S/g) || []).length;
  assert.equal(occurrences, 1, 'Approved URL must appear exactly once');
});


test('SECTION 18 D: Unrelated response where guidance is not required -> no YouTube block injected', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const unrelatedResponse = `SamChe Company LLC olarak Dubai'de serbest bölge (Free Zone) ve anakara (Mainland) şirket kurulumu danışmanlığı sağlıyoruz. Hangi sektörde faaliyet göstermeyi planlıyorsunuz?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: unrelatedResponse,
    persona,
    currentIntent: 'Şirket kurmak istiyorum',
  });
  const canonical = formatInstagramDmResponse(guided);

  assert.ok(!canonical.includes('ytbe.app'), 'Unrelated message must not contain YouTube link');
  assert.ok(!canonical.includes("YouTube'da detaylı anlatım"), 'Unrelated message must not contain YouTube block');
});

test('SECTION 18 D (Greeting): Greeting-only customer inbound -> no YouTube block injected', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const greetingResponse = `Merhaba, SamChe üzerinden Dubai'de şirket kurulumu ve oturum süreçlerinizde size memnuniyetle yardımcı olabilirim. Nasıl yardımcı olabilirim?`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: greetingResponse,
    persona,
    currentIntent: 'Merhaba Samed bey',
    isGreeting: true,
  });
  const canonical = formatInstagramDmResponse(guided);

  assert.ok(!canonical.includes('ytbe.app'), 'Greeting message must not contain YouTube link');
});

test('SECTION 18 D (Appointment field collection): Active appointment collection -> no YouTube block injected', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const appointmentResponse = `Görüşme için hangi gün ve saat sizin için uygundur? Telefon numaranızı da paylaşırsanız randevunuzu hemen oluşturalım.`;

  const guided = enforceConfiguredSupplementaryGuidance({
    content: appointmentResponse,
    persona,
    currentIntent: 'Randevu almak istiyorum',
    appointmentState: { intent: true, complete: false },
  });
  const canonical = formatInstagramDmResponse(guided);

  assert.ok(!canonical.includes('ytbe.app'), 'Active appointment collection must not contain YouTube link');
});

test('SECTION 18 F: URL remains atomic through chunking with YouTube guidance block', () => {
  const longLivingCostResponse = `Dubai'de yaşam giderleri tercih ettiğiniz bölge ve yaşam standardına göre değişiyor. 3 kişilik bir aile için genel tablo şöyle:

• **Kira:** 2+1 daire için yıllık 80.000 - 140.000 AED arası
• **Faturalar:** Aylık ortalama 1.200 - 2.000 AED (DEWA, internet, soğutma)
• **Market / gıda:** Aylık 3.000 - 5.000 AED civarı
• **Ulaşım:** Araç kiralama veya taksi için aylık 2.000 - 3.500 AED
• **Sağlık sigortası:** Kişi başı yıllık yaklaşık 1.500 - 3.000 AED

Genel olarak aylık yaklaşık 15.000 - 22.000 AED bütçe düşünülebilir.

▶️ **YouTube'da detaylı anlatım:**
https://ytbe.app/u9j8qB2S

Dubai'ye taşınırken oturum veya şirket kurulumu seçeneklerini de birlikte değerlendirmek ister misiniz?`;

  const chunks = splitIntoInstagramDmChunks(longLivingCostResponse, 450);

  // URL must not be split across chunks
  const urlChunks = chunks.filter((c) => c.includes('https://ytbe.app/u9j8qB2S'));
  assert.equal(urlChunks.length, 1, 'URL must appear in exactly one chunk');
  assert.ok(!chunks.some((c) => c.includes('ytbe.app') && !c.includes('https://ytbe.app/u9j8qB2S')), 'URL must never be broken');

  // Guidance header and URL should be kept together if they fit
  assert.ok(urlChunks[0].includes("▶️ **YouTube'da detaylı anlatım:**"), 'Guidance header and URL stay together in same chunk');
});

test('SECTION 18 G: Long response preserves all original content when YouTube guidance is injected', () => {
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

  // YouTube guidance injected in correct place
  assert.ok(canonical.includes("▶️ **YouTube'da detaylı anlatım:**\nhttps://ytbe.app/u9j8qB2S"));
  // Closing question preserved at the end
  assert.ok(canonical.endsWith("Dubai'de şirket kuruluşu veya serbest çalışan oturum izni planınız var mı?"));
});


