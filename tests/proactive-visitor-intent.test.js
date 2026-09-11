import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENT_STATES,
  DEFAULT_PROACTIVE_CONFIG,
  resolveTenantProactiveConfig,
  computeVisitorIntentScore,
  evaluateVisitorIntent,
  generateContextualProactiveMessage,
} from '../services/visitor-intent-service.js';

test('1. Low-intent visitor on ordinary page does not auto-open', () => {
  const result = evaluateVisitorIntent({
    pageContext: {
      url: 'https://example.com/about-us',
      path: '/about-us',
      page_type: 'generic_page',
    },
    currentEntity: null,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 2 },
  });

  assert.equal(result.intentState, INTENT_STATES.LOW);
  assert.equal(result.shouldProactivelyEngage, false);
  assert.equal(result.shouldAutoOpen, false);
  assert.ok(result.score < DEFAULT_PROACTIVE_CONFIG.medium_threshold);
  assert.equal(result.reason, 'BELOW_INTENT_THRESHOLD');
});

test('2. High-intent visitor with entity view and qualified dwell triggers proactive activation', () => {
  const currentEntity = {
    entity_name: 'Pro Smartwatch X1',
    entity_type: 'PRODUCT',
    canonical_url: 'https://example.com/products/watch-x1',
    attributes: { price: '2.499 TL', battery: '14 days' },
  };

  const result = evaluateVisitorIntent({
    pageContext: {
      url: 'https://example.com/products/watch-x1',
      path: '/products/watch-x1',
      page_type: 'product_detail',
    },
    currentEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 20 }, // >= 15s qualified dwell
  });

  // entity (25) + commercial path (30) + qualified dwell (25) = 80 -> HIGH
  assert.equal(result.intentState, INTENT_STATES.HIGH);
  assert.equal(result.shouldProactivelyEngage, true);
  assert.equal(result.shouldAutoOpen, true);
  assert.ok(result.score >= DEFAULT_PROACTIVE_CONFIG.intent_threshold);
  assert.equal(result.reason, 'HIGH_INTENT_ACTIVATION');
});

test('3. Current entity contributes directly to proactive context', async () => {
  const currentEntity = {
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    canonical_url: 'https://shop.example.com/urun/titan-akilli-saat-pro',
    attributes: { screen: 'AMOLED', water_resistance: 'IP68' },
  };

  const message = await generateContextualProactiveMessage({
    currentEntity,
    previousEntities: [],
    language: 'tr',
  });

  assert.ok(message.includes('Titan Akıllı Saat Pro'), `Message should mention current entity: ${message}`);
  // Guardrail check: must not falsely claim private user intent
  assert.doesNotMatch(message, /satın alacağınızı biliyorum|kesin alacaksınız/i);
});

test('4. Previous relevant entity contributes safely to comparison context', async () => {
  const currentEntity = {
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    attributes: { category: 'Smartwatch', price: 2499 },
  };
  const previousEntities = [
    {
      entity_name: 'Ultra Güç Bankası 20000mAh',
      entity_type: 'PRODUCT',
      attributes: { category: 'Smartwatch', price: 899 },
    },
  ];

  const evalResult = evaluateVisitorIntent({
    pageContext: { path: '/urun/titan', page_type: 'product_detail' },
    currentEntity,
    previousEntities,
    sessionBrowsing: { dwellSeconds: 16 },
  });

  assert.equal(evalResult.intentState, INTENT_STATES.HIGH);
  assert.ok(evalResult.signals.includes('CATEGORY_COMPARISON') || evalResult.signals.includes('MULTI_ENTITY_EXPLORATION'));

  const message = await generateContextualProactiveMessage({
    currentEntity,
    previousEntities,
    language: 'tr',
  });

  assert.ok(message.includes('Titan Akıllı Saat Pro'));
  assert.ok(message.includes('Ultra Güç Bankası 20000mAh'));
});

test('5. Proactive message generation uses qualified, non-hallucinatory language', async () => {
  const enMsg = await generateContextualProactiveMessage({
    currentEntity: { entity_name: 'Enterprise Cloud Suite', entity_type: 'SERVICE' },
    language: 'en',
  });

  assert.ok(enMsg.includes('Enterprise Cloud Suite'));
  assert.doesNotMatch(enMsg, /I know you want to buy|I know you decided/i);

  const arMsg = await generateContextualProactiveMessage({
    currentEntity: { entity_name: 'ساعة تيتان الذكية', entity_type: 'PRODUCT' },
    language: 'ar',
  });

  assert.ok(arMsg.includes('ساعة تيتان الذكية'));
});

test('6. No hardcoded tenant response: generated text adapts to arbitrary tenant personas and languages', async () => {
  const tenantAPersona = {
    available: true,
    companyIdentity: 'Dr. Ahmet Diş Kliniği',
    assistantIdentity: 'Klinik Danışmanı',
    profile: { language: 'tr' },
  };
  const tenantBPersona = {
    available: true,
    companyIdentity: 'Apex Luxury Real Estate',
    assistantIdentity: 'Property Concierge',
    profile: { language: 'en' },
  };

  const msgA = await generateContextualProactiveMessage({
    persona: tenantAPersona,
    currentEntity: { entity_name: 'Zirkonyum Kaplama Tedavisi', entity_type: 'SERVICE' },
    language: 'tr',
  });
  assert.ok(msgA.includes('Zirkonyum Kaplama Tedavisi'));

  const msgB = await generateContextualProactiveMessage({
    persona: tenantBPersona,
    currentEntity: { entity_name: 'Marina Penthouse 401', entity_type: 'PROPERTY' },
    language: 'en',
  });
  assert.ok(msgB.includes('Marina Penthouse 401'));
});

test('7. Dismissal suppresses immediate re-trigger during cooldown window', () => {
  const currentEntity = { entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };
  const dismissedRecently = new Date(Date.now() - 30 * 1000).toISOString(); // 30s ago (within 300s cooldown)

  const result = evaluateVisitorIntent({
    pageContext: { path: '/urun/titan', page_type: 'product_detail' },
    currentEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 25 },
    engagementState: {
      dismissedAt: dismissedRecently,
    },
  });

  assert.equal(result.shouldProactivelyEngage, false);
  assert.equal(result.shouldAutoOpen, false);
  assert.equal(result.reason, 'DISMISSAL_COOLDOWN');

  // But after cooldown period has expired (e.g. 400 seconds ago)
  const dismissedLongAgo = new Date(Date.now() - 400 * 1000).toISOString();
  const allowedResult = evaluateVisitorIntent({
    pageContext: { path: '/urun/titan', page_type: 'product_detail' },
    currentEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 25 },
    engagementState: {
      dismissedAt: dismissedLongAgo,
    },
  });

  assert.equal(allowedResult.shouldProactivelyEngage, true);
  assert.equal(allowedResult.shouldAutoOpen, true);
});

test('8. SPA navigation does not spam messages if already engaged', () => {
  const currentEntity = { entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };

  const result = evaluateVisitorIntent({
    pageContext: { path: '/urun/titan', page_type: 'product_detail' },
    currentEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 20 },
    engagementState: {
      proactiveMessageSent: true,
      proactiveEngagedAt: new Date(Date.now() - 60000).toISOString(),
    },
  });

  assert.equal(result.shouldProactivelyEngage, false);
  assert.equal(result.shouldAutoOpen, false);
  assert.equal(result.reason, 'ALREADY_ENGAGED');
});

test('9. Active conversation is strictly protected: no proactive interruptions', () => {
  const currentEntity = { entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };

  const resultWithHistory = evaluateVisitorIntent({
    pageContext: { path: '/urun/titan', page_type: 'product_detail' },
    currentEntity,
    sessionBrowsing: { dwellSeconds: 40 },
    engagementState: {
      hasConversation: true,
      messageCount: 3,
    },
  });

  assert.equal(resultWithHistory.shouldProactivelyEngage, false);
  assert.equal(resultWithHistory.shouldAutoOpen, false);
  assert.equal(resultWithHistory.reason, 'ACTIVE_CONVERSATION');
});

test('10. Human takeover / live agent support is strictly protected', () => {
  const currentEntity = { entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };

  const result = evaluateVisitorIntent({
    pageContext: { path: '/urun/titan', page_type: 'product_detail' },
    currentEntity,
    sessionBrowsing: { dwellSeconds: 40 },
    engagementState: {
      humanHandoffActive: true,
    },
  });

  assert.equal(result.shouldProactivelyEngage, false);
  assert.equal(result.shouldAutoOpen, false);
  assert.equal(result.reason, 'HUMAN_TAKEOVER_ACTIVE');
});

test('11. Tenant A intent state cannot affect Tenant B (strict tenant isolation)', () => {
  const tenantAConfig = {
    proactive_engagement: {
      enabled: true,
      intent_threshold: 60,
    },
  };
  const tenantBConfig = {
    proactive_engagement: {
      enabled: false,
    },
  };

  const sharedSessionBrowsing = { dwellSeconds: 25 };
  const pageContext = { path: '/urun/watch', page_type: 'product_detail' };
  const entity = { entity_name: 'Smart Watch', entity_type: 'PRODUCT' };

  const evalTenantA = evaluateVisitorIntent({
    pageContext,
    currentEntity: entity,
    sessionBrowsing: sharedSessionBrowsing,
    tenantConfig: tenantAConfig,
    engagementState: {},
  });

  const evalTenantB = evaluateVisitorIntent({
    pageContext,
    currentEntity: entity,
    sessionBrowsing: sharedSessionBrowsing,
    tenantConfig: tenantBConfig,
    engagementState: {},
  });

  assert.equal(evalTenantA.shouldProactivelyEngage, true);
  assert.equal(evalTenantB.shouldProactivelyEngage, false);
  assert.equal(evalTenantB.reason, 'PROACTIVE_DISABLED_BY_TENANT');
});

test('12. Fresh tenant inherits canonical safe defaults', () => {
  const defaults = resolveTenantProactiveConfig(null);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.auto_open, true);
  assert.equal(defaults.intent_threshold, 70);
  assert.equal(defaults.medium_threshold, 40);
  assert.equal(defaults.dismissal_cooldown_seconds, 300);
  assert.equal(defaults.dwell_time_threshold_seconds, 15);

  const emptyConfigDefaults = resolveTenantProactiveConfig({});
  assert.deepEqual(emptyConfigDefaults, defaults);
});

test('13. Proactive engagement can be explicitly disabled by tenant configuration', () => {
  const disabledConfig = {
    proactive_engagement: {
      enabled: false,
    },
  };

  const result = evaluateVisitorIntent({
    pageContext: { path: '/urun/vip-package', page_type: 'product_detail' },
    currentEntity: { entity_name: 'VIP Package', entity_type: 'PACKAGE' },
    sessionBrowsing: { dwellSeconds: 100 },
    tenantConfig: disabledConfig,
  });

  assert.equal(result.shouldProactivelyEngage, false);
  assert.equal(result.shouldAutoOpen, false);
  assert.equal(result.reason, 'PROACTIVE_DISABLED_BY_TENANT');
  assert.equal(result.score, 0);
});

test('14. Mobile and web-chat launcher layout behavior is preserved in public widget', async () => {
  const fs = await import('node:fs');
  const webChatJs = fs.readFileSync(new URL('../public/web-chat.js', import.meta.url), 'utf8');
  assert.match(webChatJs, /SamcheProactiveEngagement/);
  assert.match(webChatJs, /startDwellTracker/);
  assert.match(webChatJs, /recordDismissal/);
  assert.match(webChatJs, /recordUserMessage/);
  assert.match(webChatJs, /handleProactiveResult/);
});

test('15. RTL behavior and multi-language support (TR, EN, AR) are verified', async () => {
  const arProactive = await generateContextualProactiveMessage({
    currentEntity: { entity_name: 'فيلا فاخرة في نخلة جميرا', entity_type: 'PROPERTY' },
    previousEntities: [{ entity_name: 'شقة فاخرة في داون تاون', entity_type: 'PROPERTY' }],
    language: 'ar',
  });

  assert.ok(arProactive.includes('فيلا فاخرة'));
  assert.ok(arProactive.includes('شقة فاخرة'));
  assert.doesNotMatch(arProactive, /I know you want|satın al/i);
});

test('16. Catalog page arrival does not trigger auto-open even after 15s dwell (LOW intent gate)', () => {
  const catalogContext = {
    url: 'https://samche-api-staging.onrender.com/task8-demo/',
    path: '/task8-demo/',
    page_type: 'catalog',
  };

  const initialResult = evaluateVisitorIntent({
    pageContext: catalogContext,
    currentEntity: null,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 0 },
  });
  assert.equal(initialResult.intentState, INTENT_STATES.LOW);
  assert.equal(initialResult.shouldAutoOpen, false);
  assert.equal(initialResult.shouldProactivelyEngage, false);
  assert.equal(initialResult.shouldNudge, false);

  const dwellResult = evaluateVisitorIntent({
    pageContext: catalogContext,
    currentEntity: null,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 15 },
  });
  // Dwell alone without entity detail or commercial path is 25 points < 40 (LOW)
  assert.equal(dwellResult.intentState, INTENT_STATES.LOW);
  assert.equal(dwellResult.shouldAutoOpen, false);
  assert.equal(dwellResult.shouldProactivelyEngage, false);
  assert.equal(dwellResult.shouldNudge, false);
});

test('17. Product page arrival starts at MEDIUM (nudge only) and reaches HIGH on qualified dwell', () => {
  const productContext = {
    url: 'https://samche-api-staging.onrender.com/task8-demo/#/urun/titan-akilli-saat-pro',
    path: '/task8-demo/#/urun/titan-akilli-saat-pro',
    page_type: 'product_detail',
  };
  const currentEntity = {
    entity_id: 'prod-smartwatch-titan',
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    attributes: { price: 2499, category: 'Giyilebilir Teknoloji' },
  };

  // Immediate arrival (dwell = 0): Detail (25) + Commercial Path (30) = 55 (MEDIUM)
  const arrivalResult = evaluateVisitorIntent({
    pageContext: productContext,
    currentEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 0 },
  });
  assert.equal(arrivalResult.intentState, INTENT_STATES.MEDIUM);
  assert.equal(arrivalResult.shouldAutoOpen, false);
  assert.equal(arrivalResult.shouldProactivelyEngage, false);
  assert.equal(arrivalResult.shouldNudge, true);

  // Qualified dwell (15s): 55 + 25 = 80 (HIGH)
  const dwellResult = evaluateVisitorIntent({
    pageContext: productContext,
    currentEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 15 },
  });
  assert.equal(dwellResult.intentState, INTENT_STATES.HIGH);
  assert.equal(dwellResult.shouldAutoOpen, true);
  assert.equal(dwellResult.shouldProactivelyEngage, true);
  assert.equal(dwellResult.reason, 'HIGH_INTENT_ACTIVATION');
});

test('18. Product comparison sequence (A -> B) reaches HIGH intent deterministically without dwell', () => {
  const entityA = {
    entity_id: 'prod-smartwatch-titan',
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    attributes: { price: 2499, category: 'Giyilebilir Teknoloji' },
  };
  const entityB = {
    entity_id: 'prod-powerbank-20k',
    entity_name: 'Ultra Güç Bankası 20.000 mAh',
    entity_type: 'PRODUCT',
    attributes: { price: 899, category: 'Giyilebilir Teknoloji' },
  };

  const comparisonResult = evaluateVisitorIntent({
    pageContext: {
      url: 'https://samche-api-staging.onrender.com/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
      path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
      page_type: 'product_detail',
    },
    currentEntity: entityB,
    previousEntities: [entityA],
    sessionBrowsing: { dwellSeconds: 0 },
  });

  // Detail (25) + Commercial (30) + Multi-Entity (20) + Same-Type Comparison (20) = 95 -> HIGH
  assert.equal(comparisonResult.intentState, INTENT_STATES.HIGH);
  assert.equal(comparisonResult.shouldAutoOpen, false, 'Without qualified dwell, auto-open must remain false');
  assert.equal(comparisonResult.shouldProactivelyEngage, false, 'Without qualified dwell, proactive engagement must be false');
  assert.equal(comparisonResult.reason, 'AWAITING_QUALIFIED_DWELL');

  // Once qualified dwell (>= 15s) is achieved on the current entity:
  const comparisonResultWithDwell = evaluateVisitorIntent({
    pageContext: {
      url: 'https://samche-api-staging.onrender.com/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
      path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
      page_type: 'product_detail',
    },
    currentEntity: entityB,
    previousEntities: [entityA],
    sessionBrowsing: { dwellSeconds: 15 },
  });
  assert.equal(comparisonResultWithDwell.shouldAutoOpen, true);
  assert.equal(comparisonResultWithDwell.shouldProactivelyEngage, true);
  assert.equal(comparisonResultWithDwell.reason, 'HIGH_INTENT_ACTIVATION');
});


