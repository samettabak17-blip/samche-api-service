import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractUrlsFromText,
  processMessageUrlIntelligence,
  safeFetchUrl,
  isAuthenticationRequiredUrl,
  isAuthenticationPageHtml,
  isVisualIntentRequired,
  formatUrlIntelligenceFailureExplanation,
} from '../services/url-intelligence-service.js';
import {
  inferConservativeWhatsAppLanguage,
  resolveWhatsAppCommunicationLanguage,
} from '../services/conversation-communication-language.js';
import {
  detectWhatsAppModelResponseLanguage,
  isWhatsAppResponseLanguageMismatch,
  buildWhatsAppActivePersonaTenantContext,
  buildWhatsAppTenantModelContext,
} from '../services/whatsapp-tenant-context-service.js';
import { buildContextualIntelligencePromptSection } from '../services/contextual-intelligence-service.js';

// ============================================================================
// 1. SEMANTIC INTENT UNDERSTANDING ACROSS LANGUAGES (TR, EN, AR)
// ============================================================================

test('Multilingual visual intent recognition works across TR, EN, and AR without keyword lists', () => {
  const trPhrases = [
    'Bu şekilde bir şey istiyorum.',
    'Bunun aynısından bahçem için yapabilir misiniz?',
    'Buna benzer bir model bakıyorum.',
  ];

  const enPhrases = [
    'I want something like this.',
    'I want this style for my garden.',
    'I want to like this style for my garden',
    'Could we build something similar to this for our patio?',
    'Can you do this design?',
  ];

  const arPhrases = [
    'أريد شيئاً مثل هذا.',
    'أريد هذا النمط لحديقتي.',
    'هل يمكن تنفيذ تصميم مشابه لهذا؟',
  ];

  for (const text of trPhrases) {
    assert.equal(
      isVisualIntentRequired({ text, resourceType: 'HTML_PAGE', pageData: { primaryImageUrl: 'https://example.com/garden.jpg' } }),
      true,
      `TR intent failed: "${text}"`
    );
  }

  for (const text of enPhrases) {
    assert.equal(
      isVisualIntentRequired({ text, resourceType: 'HTML_PAGE', pageData: { primaryImageUrl: 'https://example.com/garden.jpg' } }),
      true,
      `EN intent failed: "${text}"`
    );
  }

  for (const text of arPhrases) {
    assert.equal(
      isVisualIntentRequired({ text, resourceType: 'HTML_PAGE', pageData: { primaryImageUrl: 'https://example.com/garden.jpg' } }),
      true,
      `AR intent failed: "${text}"`
    );
  }
});

// ============================================================================
// 2. MODEL RESPONSE LANGUAGE DETECTION DOES NOT MISCLASSIFY ON PROPER NOUNS
// ============================================================================

test('detectWhatsAppModelResponseLanguage does not misclassify English/Arabic responses containing Turkish tenant names', () => {
  const englishModelResponse =
    'Hello! At Yeşil Vadi Landscape, we can definitely create something like this for your garden. ' +
    'The linked visual features a natural stone curved border with gravel infill and modern ornamental grasses. ' +
    'Would you like to schedule a site consultation to discuss options?';

  const detectedEn = detectWhatsAppModelResponseLanguage(englishModelResponse);
  assert.equal(detectedEn, 'en', 'English response containing "Yeşil Vadi" must be detected as English');

  const isMismatchEn = isWhatsAppResponseLanguageMismatch({
    expectedLanguage: 'en',
    responseContent: englishModelResponse,
  });
  assert.equal(isMismatchEn, false, 'English response must NOT trigger a language mismatch');

  const turkishModelResponse =
    'Merhaba! Yeşil Vadi Peyzaj olarak görseldeki gibi doğal taş yürüyüş yolu ve bitkilendirme içeren bir bahçe tasarımı yapabiliriz. ' +
    'Bahçenizin ölçülerine uygun bir keşif ve projelendirme için görüşme ayarlayabiliriz.';

  const detectedTr = detectWhatsAppModelResponseLanguage(turkishModelResponse);
  assert.equal(detectedTr, 'tr', 'Turkish response must be detected as Turkish');

  const isMismatchTr = isWhatsAppResponseLanguageMismatch({
    expectedLanguage: 'tr',
    responseContent: turkishModelResponse,
  });
  assert.equal(isMismatchTr, false, 'Turkish response must NOT trigger a language mismatch');

  const arabicModelResponse =
    'مرحباً بكم! في شركة Yeşil Vadi لتنسيق الحدائق، يمكننا بالتأكيد تصميم وتنفيذ حديقة بهذا النمط لمنزلكم. ' +
    'توضح الصورة ممشى من الحجر الطبيعي محاطاً بنباتات الزينة الحديثة. هل ترغبون في ترتيب استشارة ميدانية؟';

  const detectedAr = detectWhatsAppModelResponseLanguage(arabicModelResponse);
  assert.equal(detectedAr, 'ar', 'Arabic response must be detected as Arabic');

  const isMismatchAr = isWhatsAppResponseLanguageMismatch({
    expectedLanguage: 'ar',
    responseContent: arabicModelResponse,
  });
  assert.equal(isMismatchAr, false, 'Arabic response must NOT trigger a language mismatch');
});


// ============================================================================
// 3. CASE 1: ACCESSIBLE REDIRECT / SHARE URL → VISUAL GROUNDING (TR, EN, AR)
// ============================================================================

test('CASE 1: Accessible share/redirect URL enters visual analysis and provides grounding across TR, EN, AR', async () => {
  const dummyJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

  const mockFetch = async (url) => {
    if (url === 'https://share.google/landscaping-sample') {
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: 'https://public-landscaping.example.com/designs/modern-zen' }),
      };
    }
    if (url === 'https://public-landscaping.example.com/designs/modern-zen') {
      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Modern Zen Garden Design - Public Gallery</title>
              <meta property="og:title" content="Modern Zen Garden Design" />
              <meta property="og:image" content="https://public-landscaping.example.com/media/zen-garden.jpg" />
              <meta property="og:description" content="Minimalist Japanese-inspired garden with slate pavers and bamboo" />
            </head>
            <body><h1>Modern Zen Garden</h1></body>
          </html>
        `,
      };
    }
    if (url === 'https://public-landscaping.example.com/media/zen-garden.jpg') {
      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(dummyJpegBytes.length) }),
        arrayBuffer: async () => dummyJpegBytes.buffer.slice(dummyJpegBytes.byteOffset, dummyJpegBytes.byteOffset + dummyJpegBytes.byteLength),
      };
    }
    throw new Error(`Unhandled mock URL: ${url}`);
  };

  const mockMultimodalAnalyzer = async ({ bytes, mimeType, userText }) => {
    return {
      category: 'LANDSCAPING',
      visual_summary: 'Minimalist Japanese Zen garden layout with slate pathway pavers, white river pebbles, and bamboo screening',
      visual_form: 'Curved stone stepping-stone path with gravel buffer and vertical bamboo privacy screen',
      visual_colors: 'Charcoal gray slate, off-white gravel, natural green bamboo',
      visual_material: 'Natural slate stone, polished river gravel, timber edging',
      visual_style: 'Modern Minimalist Zen Landscape',
      notable_features: ['Curved slate pavers', 'White gravel bed', 'Bamboo perimeter screen'],
      visible_text: '',
      approximate_proportions: 'Elongated pathway layout approximately 3:1 aspect',
      exact_dimensions_note: 'Exact physical dimensions cannot be established from the image alone without official specifications.',
    };
  };

  const queries = [
    { lang: 'tr', text: 'Bu şekilde bir şey istiyorum: https://share.google/landscaping-sample' },
    { lang: 'en', text: 'I want something like this: https://share.google/landscaping-sample' },
    { lang: 'en', text: 'I want this style for my garden: https://share.google/landscaping-sample' },
    { lang: 'ar', text: 'أريد شيئاً مثل هذا لحديقتي: https://share.google/landscaping-sample' },
  ];

  for (const { lang, text } of queries) {
    const result = await processMessageUrlIntelligence({
      text,
      fetchImpl: mockFetch,
      multimodalAnalyzer: mockMultimodalAnalyzer,
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    assert.equal(result.hasUrl, true);
    assert.equal(result.success, true, `Failed for query in ${lang}: ${text}`);
    assert.equal(result.entity.entity_name, 'Modern Zen Garden Design');
    assert.equal(result.entity.attributes.visual_category, 'LANDSCAPING');
    assert.equal(result.entity.attributes.visual_style, 'Modern Minimalist Zen Landscape');
    assert.equal(
      result.entity.attributes.dimensions_unconfirmed,
      'Exact physical dimensions cannot be established from the image alone without official specifications.'
    );

    const section = buildContextualIntelligencePromptSection({
      currentEntity: result.entity,
      channelType: 'WHATSAPP',
    });
    assert.ok(section.includes('EXTERNAL_URL_VISUAL_FACT'), 'Must contain visual fact provenance');
    assert.ok(section.includes('Modern Minimalist Zen Landscape'), 'Must contain verified visual style');
    assert.ok(!section.includes('NaN'), 'Must not contain malformed dimension tokens');
  }
});


// ============================================================================
// 4. CASE 2: AUTHENTICATION WALL / ACCESS RESTRICTION (INSTAGRAM, 401, 403)
//    MUST RETURN ACCURATE LIMITATION, NOT GENERIC CLARIFICATION FALLBACK
// ============================================================================

test('CASE 2: Short/share URL redirecting to Instagram login wall throws HTTP_401 and returns accurate limitation', async () => {
  const mockFetchInstagramLoginRedirect = async (url) => {
    // 1. Initial short link
    if (url === 'https://share.google/instagram-preview-sample') {
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: 'https://www.instagram.com/p/C_testPost123/' }),
      };
    }
    // 2. Destination redirects to login wall
    if (url === 'https://www.instagram.com/p/C_testPost123/') {
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: 'https://www.instagram.com/accounts/login/?next=%2Fp%2FC_testPost123%2F' }),
      };
    }
    throw new Error(`Unhandled mock URL: ${url}`);
  };

  const queries = [
    { lang: 'tr', text: 'Bu şekilde bir şey istiyorum: https://share.google/instagram-preview-sample' },
    { lang: 'en', text: 'I want something like this: https://share.google/instagram-preview-sample' },
    { lang: 'en', text: 'I want this style for my garden: https://share.google/instagram-preview-sample' },
    { lang: 'ar', text: 'أريد شيئاً مثل هذا: https://share.google/instagram-preview-sample' },
  ];

  for (const { lang, text } of queries) {
    const result = await processMessageUrlIntelligence({
      text,
      fetchImpl: mockFetchInstagramLoginRedirect,
      lookupImpl: async () => [{ address: '157.240.22.174', family: 4 }],
    });

    assert.equal(result.hasUrl, true);
    assert.equal(result.success, false, 'Must identify login wall as an access limitation');
    assert.equal(result.code, 'HTTP_401', 'Must map login redirect to HTTP_401');

    const limitationExplanation = formatUrlIntelligenceFailureExplanation(result, lang, { conversational: true });

    // CRITICAL ACCEPTANCE CHECKS:
    // 1. Must NOT be an unrelated generic clarification fallback
    assert.ok(
      !limitationExplanation.includes('To provide you with the most accurate guidance, could you clarify your request a little further?'),
      'Must NOT return generic English clarification fallback'
    );
    assert.ok(
      !limitationExplanation.includes('Size en doğru bilgiyi sunabilmem için konuyu biraz daha netleştirebilir misiniz?'),
      'Must NOT return generic Turkish clarification fallback'
    );
    assert.ok(
      !limitationExplanation.includes('لأتمكن من تقديم الإرشاد الأنسب لكم، هل يمكن توضيح طلبكم'),
      'Must NOT return generic Arabic clarification fallback'
    );

    // 2. Must accurately explain authentication / login requirement in customer language
    if (lang === 'tr') {
      assert.ok(limitationExplanation.includes('oturum açma veya kimlik doğrulama gerektirmektedir'));
    } else if (lang === 'en') {
      assert.ok(limitationExplanation.includes('requires authentication or login credentials'));
    } else if (lang === 'ar') {
      assert.ok(limitationExplanation.includes('تسجيل الدخول أو تصريح وصول'));
    }
  }
});

test('CASE 2: Direct HTTP 403 / 401 / Timeout returns accurate technical limitation across TR, EN, AR', () => {
  const codes = ['HTTP_401', 'HTTP_403', 'FETCH_TIMEOUT', 'SSRF_BLOCKED_TARGET'];
  const languages = ['tr', 'en', 'ar'];

  for (const code of codes) {
    for (const lang of languages) {
      const explanation = formatUrlIntelligenceFailureExplanation({ code }, lang, { conversational: true });
      assert.ok(explanation && explanation.length > 20, `Explanation missing for ${code} in ${lang}`);
      // Must not be the generic corporate fallback
      assert.ok(!explanation.includes('clarify your request a little further'));
      assert.ok(!explanation.includes('konuyu biraz daha netleştirebilir misiniz'));
    }
  }
});

// ============================================================================
// 5. WHATSAPP & WEB CHAT END-TO-END PIPELINE SIMULATION (TR, EN, AR)
// ============================================================================

test('WhatsApp pipeline: Accessible URL processes visual facts and passes language validation without fallback', () => {
  const activePersona = {
    companyIdentity: 'Yeşil Vadi Peyzaj',
    assistantIdentity: 'Can',
    available: true,
    configuration: {},
  };

  const entity = {
    entity_type: 'LANDSCAPING',
    entity_id: 'https://public-landscaping.example.com/designs/modern-zen',
    entity_name: 'Modern Zen Garden Design',
    canonical_url: 'https://public-landscaping.example.com/designs/modern-zen',
    attributes: {
      visual_category: 'LANDSCAPING',
      visual_style: 'Modern Minimalist Zen Landscape',
      dimensions_unconfirmed: 'Exact physical dimensions cannot be established from the image alone without official specifications.',
    },
    attribute_provenance: {},
    summary: 'Minimalist Japanese Zen garden layout with slate pathway pavers',
  };

  const contextualSection = buildContextualIntelligencePromptSection({
    currentEntity: entity,
    channelType: 'WHATSAPP',
  });

  const tenantContext = buildWhatsAppActivePersonaTenantContext({
    persona: activePersona,
    knowledgeContext: 'Yeşil Vadi Peyzaj bahçe düzenleme, rulo çim, doğal taş ve otomatik sulama hizmetleri sunar.',
    communicationLanguage: 'en',
    contextualIntelligence: contextualSection,
  });

  const modelContext = buildWhatsAppTenantModelContext({
    tenant: tenantContext,
    customerText: 'I want this style for my garden: https://share.google/landscaping-sample',
    communicationLanguage: 'en',
  });

  assert.ok(modelContext.systemInstruction.includes('Yeşil Vadi Peyzaj'), 'Must include tenant brand');
  assert.ok(modelContext.systemInstruction.includes('Modern Minimalist Zen Landscape'), 'Must include visual grounded context');
  assert.ok(modelContext.userPrompt.includes('CURRENT_TURN_RESPONSE_LANGUAGE_LOCK: English'), 'Must lock output language to English');

  // Assistant response in English for the Turkish tenant
  const assistantReply =
    'Hello! At Yeşil Vadi Peyzaj, we can definitely create something like this for your garden. ' +
    'The linked visual features a natural stone curved border with gravel infill and modern ornamental grasses. ' +
    'We can prepare a custom project plan and site estimate for your space.';

  const detectedLanguage = detectWhatsAppModelResponseLanguage(assistantReply);
  assert.equal(detectedLanguage, 'en', 'Model response must be recognized as English despite "Yeşil Vadi"');
  assert.equal(
    isWhatsAppResponseLanguageMismatch({ expectedLanguage: 'en', responseContent: assistantReply }),
    false,
    'No mismatch should occur'
  );
});

test('Web Chat pipeline: URL limitation returns accurate technical limitation across TR, EN, AR', () => {
  const blockedUrlResult = {
    hasUrl: true,
    url: 'https://share.google/instagram-preview-sample',
    success: false,
    code: 'HTTP_401',
    error: 'The destination URL requires authentication or login credentials.',
  };

  const queries = [
    { text: 'Bu şekilde bir şey istiyorum: https://share.google/instagram-preview-sample', lang: 'tr' },
    { text: 'I want something like this: https://share.google/instagram-preview-sample', lang: 'en' },
    { text: 'أريد شيئاً مثل هذا: https://share.google/instagram-preview-sample', lang: 'ar' },
  ];

  for (const { text, lang } of queries) {
    const inferred = inferConservativeWhatsAppLanguage(text) || 'en';
    assert.equal(inferred, lang, `Language inference failed for: ${text}`);

    const limitationMessage = formatUrlIntelligenceFailureExplanation(blockedUrlResult, inferred, { conversational: true });
    assert.ok(
      !limitationMessage.includes('clarify your request a little further'),
      'Must NOT be generic clarification fallback'
    );
    assert.ok(
      !limitationMessage.includes('Size en doğru bilgiyi sunabilmem için'),
      'Must NOT be generic Turkish clarification fallback'
    );
    assert.ok(
      limitationMessage.length > 30,
      'Must provide a substantive, accurate limitation explanation'
    );
  }
});

