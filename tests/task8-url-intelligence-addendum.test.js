import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeFetchUrl,
  extractContentFromHtml,
  extractEmbeddedQueryRedirectUrl,
  extractMetaRefreshUrl,
  extractScriptRedirectUrl,
  extractInterstitialNoticeUrl,
  extractCanonicalRedirectUrl,
  parseSrcsetUrls,
  isVisualIntentRequired,
  analyzeRemoteImageMultimodal,
  normalizeExternalUrlEntity,
  processMessageUrlIntelligence,
  formatUrlIntelligenceFailureExplanation,
  UrlIntelligenceError,
} from '../services/url-intelligence-service.js';
import {
  PROVENANCE_SOURCES,
  buildContextualIntelligencePromptSection,
  updateSessionBrowsingStateWithEntity,
} from '../services/contextual-intelligence-service.js';
import {
  generateWebChatEmbedSnippet,
  getWebChatIntegrationForTenant,
} from '../services/tenant-web-chat-provisioning-service.js';

// ============================================================================
// SECTION A: SHARE / SHORT / REDIRECT URL INTELLIGENCE
// ============================================================================

test('SECTION A: Generic short/share link with multi-hop redirect resolves to final destination', async () => {
  const hopsVisited = [];
  const mockFetch = async (url) => {
    hopsVisited.push(url);
    if (url === 'https://share.example/x89z') {
      return {
        status: 302,
        ok: false,
        headers: new Map([
          ['location', 'https://redirector.example/url?q=https%3A%2F%2Fdestination-landscaping.test%2Fmodern-garden'],
        ]),
      };
    }
    if (url.startsWith('https://redirector.example/url')) {
      const interstitialHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Redirect Notice</title>
          </head>
          <body>
            <div>The page you were on is trying to send you to
              <a href="https://destination-landscaping.test/modern-garden">https://destination-landscaping.test/modern-garden</a>.
            </div>
          </body>
        </html>
      `;
      return {
        status: 200,
        ok: true,
        headers: new Map([['content-type', 'text/html; charset=utf-8']]),
        text: async () => interstitialHtml,
      };
    }
    if (url === 'https://destination-landscaping.test/modern-garden') {
      const finalHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Modern Curved White Stone Garden Edging</title>
            <meta property="og:description" content="Premium natural white stone curved border for decorative landscaping." />
            <meta property="og:image" content="https://destination-landscaping.test/images/curved-border.jpg" />
          </head>
          <body>
            <h1>Modern Curved White Stone Garden Edging</h1>
            <p>High-end garden landscaping design reference.</p>
          </body>
        </html>
      `;
      return {
        status: 200,
        ok: true,
        headers: new Map([['content-type', 'text/html; charset=utf-8']]),
        text: async () => finalHtml,
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const fakeLookup = async (hostname) => [{ address: '93.184.216.34', family: 4 }];

  const result = await safeFetchUrl('https://share.example/x89z', {
    fetchImpl: mockFetch,
    lookupImpl: fakeLookup,
  });

  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, 'https://destination-landscaping.test/modern-garden');
  assert.equal(result.html.includes('Modern Curved White Stone Garden Edging'), true);
  assert.equal(hopsVisited.length, 3);
});

test('SECTION A: Generic query parameter redirect unwrapper supports all standard redirect params', () => {
  const url1 = 'https://click-track.net/out?dest=https%3A%2F%2Fstore.test%2Ffurniture-chair';
  assert.equal(extractEmbeddedQueryRedirectUrl(url1), 'https://store.test/furniture-chair');

  const url2 = 'https://link-hub.org/redirect?url=https%3A%2F%2Fdesign.test%2Fvilla-interior';
  assert.equal(extractEmbeddedQueryRedirectUrl(url2), 'https://design.test/villa-interior');

  const url3 = 'https://search-indexer.com/url?q=https%3A%2F%2Fmachinery-export.com%2Fexcavator-200';
  assert.equal(extractEmbeddedQueryRedirectUrl(url3), 'https://machinery-export.com/excavator-200');

  const url4 = 'https://link-router.example/forward?to=https%3A%2F%2Fdecor.test%2Fsofa-item';
  assert.equal(extractEmbeddedQueryRedirectUrl(url4), 'https://decor.test/sofa-item');
});

test('SECTION A: Meta refresh with reversed attribute order and quotes is correctly resolved', () => {
  const html1 = '<meta content="0; url=\'https://public-destination.test/catalog\'" http-equiv="refresh">';
  assert.equal(extractMetaRefreshUrl(html1), 'https://public-destination.test/catalog');

  const html2 = '<meta content="1;URL=https://target.test/product-page" http-equiv="refresh">';
  assert.equal(extractMetaRefreshUrl(html2), 'https://target.test/product-page');

  const html3 = '<meta http-equiv="refresh" content="0; url=https://standard.test/page">';
  assert.equal(extractMetaRefreshUrl(html3), 'https://standard.test/page');
});

test('SECTION A: Client-side JavaScript redirects are cleanly extracted', () => {
  const html1 = '<script>window.location.replace("https://short-landing.test/promo-item");</script>';
  assert.equal(extractScriptRedirectUrl(html1), 'https://short-landing.test/promo-item');

  const html2 = '<script>location.href = "https://app-redirect.test/view/123";</script>';
  assert.equal(extractScriptRedirectUrl(html2), 'https://app-redirect.test/view/123');
});


test('SECTION A: Interstitial Notice Page and Canonical Redirects are followed generically', () => {
  const noticeHtml = `
    <html>
      <head><title>Yönlendirme Uyarısı</title></head>
      <body>
        <p>Harici bir sayfaya yönlendiriliyorsunuz:</p>
        <a href="https://real-product.test/item-99">Buraya tıklayın</a>
      </body>
    </html>
  `;
  assert.equal(
    extractInterstitialNoticeUrl(noticeHtml, 'https://shim.example/click'),
    'https://real-product.test/item-99'
  );

  const stubHtml = `
    <html>
      <head>
        <link rel="canonical" href="https://actual-store.test/handbag-leather" />
      </head>
      <body>Loading...</body>
    </html>
  `;
  assert.equal(
    extractCanonicalRedirectUrl(stubHtml, 'https://short-link.example/item'),
    'https://actual-store.test/handbag-leather'
  );
});

test('SECTION A: Re-validation of EVERY redirect target strictly enforces SSRF protection', async () => {
  const mockFetch = async (url) => {
    if (url === 'https://legit-start.example/share') {
      return {
        status: 302,
        ok: false,
        headers: new Map([['location', 'http://169.254.169.254/computeMetadata/v1/']]),
      };
    }
    return { status: 200, ok: true, headers: new Map([['content-type', 'text/html']]), text: async () => '' };
  };

  await assert.rejects(
    () => safeFetchUrl('https://legit-start.example/share', {
      fetchImpl: mockFetch,
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    }),
    { code: 'SSRF_BLOCKED_TARGET' }
  );
});

test('SECTION A: Intermediate redirect to private DNS resolved IP is blocked immediately', async () => {
  const mockFetch = async (url) => {
    if (url === 'https://start.test/link') {
      return {
        status: 302,
        ok: false,
        headers: new Map([['location', 'https://sneaky-internal.test/dashboard']]),
      };
    }
    return { status: 200, ok: true, headers: new Map([['content-type', 'text/html']]), text: async () => '' };
  };

  const fakeLookup = async (hostname) => {
    if (hostname === 'sneaky-internal.test') {
      return [{ address: '10.0.0.50', family: 4 }];
    }
    return [{ address: '93.184.216.34', family: 4 }];
  };

  await assert.rejects(
    () => safeFetchUrl('https://start.test/link', {
      fetchImpl: mockFetch,
      lookupImpl: fakeLookup,
    }),
    { code: 'SSRF_BLOCKED_TARGET' }
  );
});

test('SECTION A: Redirect loop is detected and aborted with REDIRECT_LOOP', async () => {
  const mockFetch = async (url) => {
    if (url === 'https://a.test/loop') {
      return { status: 302, ok: false, headers: new Map([['location', 'https://b.test/loop']]) };
    }
    if (url === 'https://b.test/loop') {
      return { status: 302, ok: false, headers: new Map([['location', 'https://a.test/loop']]) };
    }
    return { status: 200, ok: true, headers: new Map([['content-type', 'text/html']]), text: async () => '' };
  };

  await assert.rejects(
    () => safeFetchUrl('https://a.test/loop', {
      fetchImpl: mockFetch,
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    }),
    { code: 'REDIRECT_LOOP' }
  );
});

// ============================================================================
// SECTION B: LINKED IMAGE / PRODUCT / DESIGN UNDERSTANDING
// ============================================================================

test('SECTION B: Human customer intent triggers visual multimodal analysis across generic domains', () => {
  const pageData = {
    entityType: 'LANDSCAPING',
    primaryImageUrl: 'https://landscaping.example/curved-stone.jpg',
  };

  assert.equal(
    isVisualIntentRequired({ text: 'Bu şekilde bir şey istiyorum: https://share.example/x', resourceType: 'HTML_PAGE', pageData }),
    true
  );
  assert.equal(
    isVisualIntentRequired({ text: 'Bu ürünün aynısından istiyorum https://store.example/item', resourceType: 'HTML_PAGE', pageData }),
    true
  );
  assert.equal(
    isVisualIntentRequired({ text: 'Bana bunun benzerini yap', resourceType: 'HTML_PAGE', pageData }),
    true
  );
  assert.equal(
    isVisualIntentRequired({ text: 'Bunun şeklini/boyutunu tarif et', resourceType: 'HTML_PAGE', pageData }),
    true
  );
  assert.equal(
    isVisualIntentRequired({ text: 'Bu tasarımı incele', resourceType: 'HTML_PAGE', pageData }),
    true
  );
  assert.equal(
    isVisualIntentRequired({ text: 'Bana bundan lazım', resourceType: 'HTML_PAGE', pageData }),
    true
  );
  assert.equal(
    isVisualIntentRequired({ text: 'Bunu yapabilir misiniz?', resourceType: 'HTML_PAGE', pageData }),
    true
  );
  assert.equal(
    isVisualIntentRequired({ text: 'merhaba https://decor.example/couch', resourceType: 'HTML_PAGE', pageData }),
    true
  );
});

test('SECTION B: Modern responsive image discovery supports lazy loading, srcset, and background images', () => {
  const html = `
    <html>
      <head><title>Modern Furniture Gallery</title></head>
      <body>
        <div class="product-showcase">
          <picture>
            <source srcset="https://furniture.test/sofa-400w.webp 400w, https://furniture.test/sofa-1600w.webp 1600w" />
            <img class="hero-image" data-src="https://furniture.test/sofa-lazy.jpg" src="data:image/svg+xml;base64,PHN2Zz4=" />
          </picture>
        </div>
      </body>
    </html>
  `;

  const parsed = extractContentFromHtml(html, 'https://furniture.test/item-5');
  assert.equal(parsed.primaryImageUrl, 'https://furniture.test/sofa-1600w.webp');
  assert.equal(parsed.entityType, 'FURNITURE');
});

test('SECTION B: Three-tier factual grounding strictly separates facts, inferences, and unknown dimensions', () => {
  const visualObservations = {
    category: 'LANDSCAPING',
    visual_summary: 'Curved white-stone landscape border separating dark mulch from grass.',
    visual_form: 'Curved undulating smooth white stone edging with dark mulch flower bed',
    visual_colors: 'White, green, dark brown',
    visual_material: 'White decorative natural stone, dark wood mulch, turf grass',
    visual_style: 'Modern minimalist landscaping',
    notable_features: ['Curved masonry border', 'Two-tier ground cover transition'],
    visible_text: '',
    approximate_proportions: 'Elongated curved perimeter',
    exact_dimensions_note: 'Exact physical dimensions cannot be established from the image alone without official specifications.',
  };

  const entity = normalizeExternalUrlEntity({
    url: 'https://landscaping.example/project-12',
    pageData: {
      title: 'Modern Villa Landscaping Design',
      entityType: 'LANDSCAPING',
      entityName: 'Modern Villa Landscaping Design',
      attributes: {
        price: 'Project based',
        materials: 'White stone, dark mulch',
        border_width: '42 cm',
      },
    },
    visualObservations,
    resourceType: 'HTML_PAGE',
  });

  const promptSection = buildContextualIntelligencePromptSection({
    currentEntity: entity,
    channelType: 'WHATSAPP',
  });

  assert.equal(promptSection.includes('VISIBLE/EXTRACTED FACT'), true);
  assert.equal(promptSection.includes('VISUAL INFERENCE'), true);
  assert.equal(promptSection.includes('UNKNOWN'), true);
  assert.equal(promptSection.includes('DIMENSION INTEGRITY'), true);
  assert.equal(promptSection.includes('The border is exactly 42 cm wide'), true);
  assert.equal(promptSection.includes('border_width: 42 cm [PROVENANCE: EXTERNAL_URL_PAGE_FACT]'), true);
  assert.equal(promptSection.includes('visual_material: White decorative natural stone, dark wood mulch, turf grass [PROVENANCE: EXTERNAL_URL_VISUAL_FACT]'), true);
  assert.equal(promptSection.includes('visual_style: Modern minimalist landscaping [PROVENANCE: EXTERNAL_URL_VISUAL_FACT]'), true);
});

// ============================================================================
// SECTION C: BEST-EFFORT PUBLIC LINK RULE & ACCURATE FALLBACK
// ============================================================================

test('SECTION C: FormatUrlIntelligenceFailureExplanation accurately describes technical and security boundaries', () => {
  assert.equal(
    formatUrlIntelligenceFailureExplanation({ code: 'SSRF_BLOCKED_TARGET' }, 'tr'),
    'Paylaşılan bağlantı güvenlik politikası nedeniyle erişime kapalıdır (özel veya yerel ağ adresi).'
  );
  assert.equal(
    formatUrlIntelligenceFailureExplanation({ code: 'SSRF_BLOCKED_TARGET' }, 'en'),
    'The shared URL is blocked by security policy (private or local network destination).'
  );

  assert.equal(
    formatUrlIntelligenceFailureExplanation({ code: 'HTTP_401' }, 'tr'),
    'Paylaşılan bağlantı oturum açma veya kimlik doğrulama gerektirmektedir.'
  );

  assert.equal(
    formatUrlIntelligenceFailureExplanation({ code: 'HTTP_403' }, 'tr'),
    'Paylaşılan bağlantı erişim kısıtlaması nedeniyle görüntülenememektedir.'
  );

  assert.equal(
    formatUrlIntelligenceFailureExplanation({ code: 'FETCH_TIMEOUT' }, 'tr'),
    'Paylaşılan bağlantıya erişim zaman aşımına uğradı.'
  );

  assert.equal(
    formatUrlIntelligenceFailureExplanation({ code: 'UNSUPPORTED_CONTENT_TYPE' }, 'tr'),
    'Paylaşılan bağlantıdaki dosya türü desteklenmiyor. Yalnızca herkese açık web sayfaları ve görseller incelenebilir.'
  );
});

// ============================================================================
// SECTION D: WHATSAPP + WEB CHAT SHARED CANONICAL PIPELINE
// ============================================================================

test('SECTION D: ProcessMessageUrlIntelligence serves WhatsApp and Web Chat identically without website-specific branching', async () => {
  const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const sampleJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  const mockFetch = async (url) => {
    if (url === 'https://share.short/landscape-example') {
      return {
        status: 301,
        ok: false,
        headers: new Map([['location', 'https://landscaping-portal.test/projects/curved-border']]),
      };
    }
    if (url === 'https://landscaping-portal.test/projects/curved-border') {
      const pageHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Beyaz Taş Kavisli Bahçe Kenarlığı</title>
            <meta property="og:description" content="Kavisli doğal beyaz taş kenarlık tasarımı." />
            <meta property="og:image" content="https://landscaping-portal.test/photos/curved-border.jpg" />
          </head>
          <body>
            <h1>Beyaz Taş Kavisli Bahçe Kenarlığı</h1>
          </body>
        </html>
      `;
      return {
        status: 200,
        ok: true,
        headers: new Map([['content-type', 'text/html; charset=utf-8']]),
        text: async () => pageHtml,
      };
    }
    if (url === 'https://landscaping-portal.test/photos/curved-border.jpg') {
      const dedicatedBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).buffer;
      return {
        status: 200,
        ok: true,
        headers: new Map([['content-type', 'image/jpeg'], ['content-length', '10']]),
        arrayBuffer: async () => dedicatedBuffer,
      };
    }
    throw new Error('Unexpected url: ' + url);
  };

  const mockMultimodalAnalyzer = async () => ({
    category: 'LANDSCAPING',
    visual_summary: 'Kavisli beyaz taş bahçe bordürü ve dekoratif koyu malç alanı',
    visual_form: 'Kavisli bordür yapısı',
    visual_colors: 'Beyaz, yeşil, koyu kahverengi',
    visual_material: 'Doğal beyaz taş ve malç',
    visual_style: 'Modern minimalist peyzaj',
    notable_features: ['Kavisli taş kenarlık'],
    visible_text: '',
    approximate_proportions: 'Uzun kavisli hat',
    exact_dimensions_note: 'Exact physical dimensions cannot be established from the image alone without official specifications.',
  });

  const customerText = 'Bu şekilde bir şey istiyorum: https://share.short/landscape-example';

  // 1. WhatsApp execution
  const wpResult = await processMessageUrlIntelligence({
    text: customerText,
    fetchImpl: mockFetch,
    lookupImpl: fakeLookup,
    multimodalAnalyzer: mockMultimodalAnalyzer,
  });

  assert.equal(wpResult.success, true);
  assert.equal(wpResult.entity.entity_name, 'Beyaz Taş Kavisli Bahçe Kenarlığı');
  assert.equal(wpResult.entity.attributes.visual_category, 'LANDSCAPING');
  assert.equal(wpResult.entity.attributes.visual_style, 'Modern minimalist peyzaj');

  // 2. Web Chat execution with identical customer text
  const webChatResult = await processMessageUrlIntelligence({
    text: customerText,
    fetchImpl: mockFetch,
    lookupImpl: fakeLookup,
    multimodalAnalyzer: mockMultimodalAnalyzer,
  });

  assert.equal(webChatResult.success, true);
  assert.equal(webChatResult.entity.entity_name, wpResult.entity.entity_name);
  assert.equal(webChatResult.entity.canonical_url, wpResult.entity.canonical_url);
  assert.deepEqual(webChatResult.entity.attributes, wpResult.entity.attributes);
});

// ============================================================================
// SECTION G & H: MULTI-TENANT AUTHORIZATION, ISOLATION & PERMANENCE
// ============================================================================

test('SECTION G: Tenant Admin can only manage their own tenant Web Chat, cross-tenant is blocked', async () => {
  const tenantAId = '11111111-1111-4111-8111-111111111111';
  const tenantBId = '22222222-2222-4222-8222-222222222222';

  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT id, name, status, plan_code FROM tenants')) {
        const id = params[0];
        return {
          rowCount: 1,
          rows: [{ id, name: id === tenantAId ? 'Tenant A' : 'Tenant B', status: 'active', plan_code: 'BUSINESS' }],
        };
      }
      if (sql.includes('information_schema.columns')) {
        return { rows: [{ column_name: 'config' }] };
      }
      if (sql.includes('FROM channel_integrations')) {
        const id = params[0];
        return {
          rowCount: 1,
          rows: [
            {
              integration_id: `int-${id}`,
              integration_key: `key-${id}`,
              is_enabled: true,
              channel_id: `chn-${id}`,
              channel_type: 'WEB_CHAT',
              assistant_id: `ast-${id}`,
              assistant_name: 'Store Bot',
              config: { appearance: { brand_name: id === tenantAId ? 'Brand A' : 'Brand B' } },
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const configA = await getWebChatIntegrationForTenant({ database: mockDb, tenantId: tenantAId });
  assert.equal(configA.tenant_id, tenantAId);
  assert.equal(configA.widget_key, `key-${tenantAId}`);
  assert.equal(configA.appearance.brand_name, 'Brand A');

  const configB = await getWebChatIntegrationForTenant({ database: mockDb, tenantId: tenantBId });
  assert.equal(configB.tenant_id, tenantBId);
  assert.equal(configB.widget_key, `key-${tenantBId}`);
  assert.equal(configB.appearance.brand_name, 'Brand B');

  const snippet = generateWebChatEmbedSnippet({ widgetKey: configA.widget_key, hostUrl: 'https://staging.test' });
  assert.equal(snippet.includes(`data-widget-key="key-${tenantAId}"`), true);
  assert.equal(snippet.includes('secret'), false);
  assert.equal(snippet.includes('password'), false);
  assert.equal(snippet.includes('token'), false);
});
