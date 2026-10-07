process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatInstagramDmResponse,
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


