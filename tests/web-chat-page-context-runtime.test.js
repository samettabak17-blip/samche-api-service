import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('app.js exposes POST /api/chat/page-context with signed session verification', () => {
  assert.match(appSource, /app\.post\("\/api\/chat\/page-context"/);
  assert.match(appSource, /verifyPublicWebChatSession\(suppliedWebChatSession/);
  assert.match(appSource, /resolvePublicWebChatIntegration\(\{/);
  assert.match(appSource, /updateSessionBrowsingState\(\{/);
  assert.match(appSource, /saveWebChatSessionBrowsingState\(\{/);
  assert.match(appSource, /logContextualObservability\('PAGE_CONTEXT_RECEIVED'/);
  assert.match(appSource, /logContextualObservability\('PAGE_CONTEXT_VALIDATED'/);
  assert.match(appSource, /logContextualObservability\('CURRENT_ENTITY_RESOLVED'/);
  assert.match(appSource, /logContextualObservability\('PREVIOUS_ENTITY_COUNT'/);
});

test('app.js integrates page context into POST /api/chat system instruction', () => {
  assert.match(appSource, /loadWebChatSessionBrowsingState\(\{/);
  assert.match(appSource, /buildContextualIntelligencePromptSection\(\{/);
  assert.match(appSource, /logContextualObservability\('PAGE_CONTEXT_USED'/);
  assert.match(appSource, /contextualIntelligence:\s*webChatContextualSection/);
  assert.doesNotMatch(appSource, /req\.body\.tenant_id|req\.body\.assistant_id/);
});

test('app.js shares canonical page context with AI Guide runtime', () => {
  assert.match(appSource, /buildGuidePageContextSummary\(/);
  assert.match(appSource, /contextualIntelligence:\s*guidePageContextSummary/);
});

test('public/web-chat.js static asset is served', () => {
  assert.match(appSource, /app\.get\('\/web-chat\.js'/);
  assert.ok(fs.existsSync(new URL('../public/web-chat.js', import.meta.url)));
});

test('app.js exposes canonical proactive visitor intent endpoints', () => {
  assert.match(appSource, /app\.post\("\/api\/chat\/evaluate-intent"/);
  assert.match(appSource, /app\.post\("\/api\/chat\/dismiss-proactive"/);
  assert.match(appSource, /evaluateVisitorIntent\(\{/);
  assert.match(appSource, /proactive_engagement:\s*\{/);
  assert.match(appSource, /updateWebChatSessionEngagementState\(\{/);
  assert.match(appSource, /extractWebChatSessionToken\(req\)/);
});
import {
  validateAndNormalizePageContext,
  resolvePageEntity,
  buildContextualIntelligencePromptSection,
  updateSessionBrowsingState,
  isDiscreteEntity,
} from '../services/contextual-intelligence-service.js';

test('validateAndNormalizePageContext normalizes visible products and infers PRODUCT_LIST page_type', () => {
  const rawContext = {
    url: 'https://demoteknoloji.samchecompany.com/',
    title: 'Ana Sayfa',
    attributes: {
      visible_products: [
        { name: 'Vektor Horizon Akıllı Bileklik', price: '$1199.00', url: '/vektor-horizon-akll-bileklik' },
        { name: 'Vektor VoltFast 100W GaN Şarj Cihazı', price: '$999.00', url: '/vektor-voltfast-100w-gan-arj-cihaz' },
        { name: 'Vektor NovaBuds Pro Kulak Üstü Kulaklık', price: '$2799.00', url: '/vektor-novabuds-pro-kulak-st-kulaklk' },
        { name: 'Vektor CyberShield Telefon Kılıfı', price: '$449.00', url: '/vektor-cybershield-telefon-klf' },
        { name: 'Vektor Flux MagSafe Şarj Standı', price: '$899.00', url: '/vektor-flux-magsafe-arj-stand' },
      ],
    },
  };

  const normalized = validateAndNormalizePageContext(rawContext);
  assert.equal(normalized.page_type, 'PRODUCT_LIST');
  assert.equal(normalized.entity_type, 'PRODUCT_LIST');
  assert.ok(normalized.attributes.visible_products);
  assert.equal(normalized.attributes.visible_products.length, 5);
  assert.equal(normalized.attributes.visible_products[0].name, 'Vektor Horizon Akıllı Bileklik');
  assert.equal(normalized.attributes.visible_products[0].price, '$1199.00');
  assert.match(normalized.summary, /Bu sayfada görüntülenen ürünler \(5 adet\):/);
  assert.match(normalized.summary, /Vektor Horizon Akıllı Bileklik \(\$1199\.00\)/);
  assert.match(normalized.summary, /Vektor CyberShield Telefon Kılıfı \(\$449\.00\)/);
});

test('buildContextualIntelligencePromptSection generates visible products section with grounding directives', () => {
  const entity = {
    entity_type: 'PRODUCT_LIST',
    entity_id: '/',
    entity_name: 'Ana Sayfa',
    canonical_url: 'https://demoteknoloji.samchecompany.com/',
    visible_products: [
      { name: 'Vektor Horizon Akıllı Bileklik', price: '$1199.00', url: '/vektor-horizon-akll-bileklik' },
      { name: 'Vektor VoltFast 100W GaN Şarj Cihazı', price: '$999.00', url: '/vektor-voltfast-100w-gan-arj-cihaz' },
      { name: 'Vektor NovaBuds Pro Kulak Üstü Kulaklık', price: '$2799.00', url: '/vektor-novabuds-pro-kulak-st-kulaklk' },
      { name: 'Vektor CyberShield Telefon Kılıfı', price: '$449.00', url: '/vektor-cybershield-telefon-klf' },
      { name: 'Vektor Flux MagSafe Şarj Standı', price: '$899.00', url: '/vektor-flux-magsafe-arj-stand' },
    ],
  };

  const promptSection = buildContextualIntelligencePromptSection({
    currentEntity: entity,
    channelType: 'WEB_CHAT',
  });

  // Verify visible products section
  assert.match(promptSection, /\[VISIBLE PRODUCTS ON CURRENT PAGE \(PAGE_VISIBLE_FACT\)\]/);
  assert.match(promptSection, /1\. Vektor Horizon Akıllı Bileklik — Price: \$1199\.00/);
  assert.match(promptSection, /4\. Vektor CyberShield Telefon Kılıfı — Price: \$449\.00/);

  // Verify explicit grounding directives
  assert.match(promptSection, /GROUNDING DIRECTIVE FOR CURRENT PAGE PRODUCTS:/);
  assert.match(promptSection, /bu sayfada hangi ürünler var/);
  assert.match(promptSection, /en uygun olan hangisi/);
  assert.match(promptSection, /NEVER state that you cannot see the products on this page/);

  // Verify support intent coexistence
  assert.match(promptSection, /SUPPORT INTENT COEXISTENCE:/);
  assert.match(promptSection, /iade etmek istiyorum/);
});

test('Product list page is non-discrete (suppresses proactive) while product detail page qualifies for proactive', () => {
  const listEntity = { entity_type: 'PRODUCT_LIST', entity_name: 'Ürünler' };
  assert.equal(isDiscreteEntity(listEntity), false);

  const detailEntity = { entity_type: 'PRODUCT', entity_name: 'Vektor Horizon Akıllı Bileklik', attributes: { price: '$1199.00' } };
  assert.equal(isDiscreteEntity(detailEntity), true);
});

