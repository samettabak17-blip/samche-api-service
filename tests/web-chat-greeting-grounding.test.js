import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWebChatAppearance,
  resolveInitialWebChatGreeting,
} from '../services/tenant-web-chat-provisioning-service.js';
import {
  updateSessionBrowsingState,
  isDiscreteEntity,
} from '../services/contextual-intelligence-service.js';
import {
  computeVisitorIntentScore,
  evaluateVisitorIntent,
  INTENT_STATES,
} from '../services/visitor-intent-service.js';

test('A. Headphone page: greeting does not claim unrelated wireless charging or waterproofing, suggestions are grounded', () => {
  const appearance = normalizeWebChatAppearance({
    brand_name: 'SamChe Teknoloji',
    greeting: 'Merhaba! SamChe Teknoloji Mağazasına hoş geldiniz. Size nasıl yardımcı olabilirim?',
  }, 'SamChe Teknoloji');

  const greeting = resolveInitialWebChatGreeting({
    configuredGreeting: appearance.greeting,
    brandName: appearance.brand_name,
    language: 'tr',
  });

  assert.doesNotMatch(greeting, /kablosuz şarj/i, 'Greeting must not claim wireless charging');
  assert.doesNotMatch(greeting, /su geçirmez/i, 'Greeting must not claim waterproofing');
  assert.ok(greeting.includes('SamChe Teknoloji'));

  const headphoneChips = [
    'ANC gürültü engelleme kaç dB?',
    'LDAC ses kodeği destekleniyor mu?',
    'Toplam pil ömrü ne kadar?',
    'Bunu önce baktığım ürünle karşılaştır',
  ];

  for (const chip of headphoneChips) {
    assert.doesNotMatch(chip, /kablosuz şarj/i);
    assert.doesNotMatch(chip, /su geçirmez/i);
  }
  assert.ok(headphoneChips.some(c => c.includes('ANC')));
  assert.ok(headphoneChips.some(c => c.includes('LDAC')));
  assert.ok(headphoneChips.some(c => c.includes('pil')));
});

test('B. Powerbank page: wireless charging negative fact is grounded correctly without hallucination', () => {
  const powerbankContext = {
    url: '/urun/ultra-guc-bankasi-20000mah',
    entity_id: 'prod_powerbank_20k',
    entity_name: 'Ultra Güç Bankası 20.000 mAh',
    entity_type: 'PRODUCT',
    summary: '20.000 mAh yüksek kapasite, 65W Power Delivery. Bu model yalnızca kablolu şarjı destekler, kablosuz şarj (Qi) KESİNLİKLE BULUNMAMAKTADIR.',
    attributes: {
      category: 'Şarj Cihazları',
      price: 899,
      wireless_charging: false,
    },
  };

  assert.equal(powerbankContext.attributes.wireless_charging, false);
  assert.ok(powerbankContext.summary.includes('KESİNLİKLE BULUNMAMAKTADIR'));

  const defaultGreeting = resolveInitialWebChatGreeting({
    brandName: 'SamChe Teknoloji',
    language: 'tr',
  });
  assert.doesNotMatch(defaultGreeting, /kablosuz şarj/i);
});

test('C. Smartwatch page: waterproof/IP68 information is verified on page where supported', () => {
  const watchContext = {
    url: '/urun/titan-akilli-saat-pro',
    entity_id: 'prod_titan_watch_pro',
    entity_name: 'SamChe Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    summary: '1.43 inç AMOLED ekran, Bluetooth 5.3 telefon görüşmesi, IP68 su geçirmezlik ve 14 güne varan pil ömrü.',
    attributes: {
      screen: '1.43 AMOLED',
      water_resistance: 'IP68',
      battery_days: 14,
      category: 'Giyilebilir Teknoloji',
    },
  };

  assert.equal(watchContext.attributes.water_resistance, 'IP68');
  assert.ok(watchContext.summary.includes('IP68 su geçirmezlik'));
});

test('D. Second generic industry/tenant fixture (Healthcare Clinic): greeting does not contain e-commerce product capabilities', () => {
  const clinicAppearance = normalizeWebChatAppearance({
    brand_name: 'DentCare Dental Clinic',
    title: 'Klinik Danışmanı',
  }, 'DentCare Dental Clinic');

  const greeting = resolveInitialWebChatGreeting({
    configuredGreeting: null,
    brandName: clinicAppearance.brand_name,
    assistantName: clinicAppearance.title,
    language: 'tr',
  });

  assert.doesNotMatch(greeting, /ürün özellikleri/i);
  assert.doesNotMatch(greeting, /kablosuz şarj/i);
  assert.doesNotMatch(greeting, /su geçirmez/i);
  assert.doesNotMatch(greeting, /sipariş süreçleri/i);
  assert.match(greeting, /Merhaba! Size nasıl yardımcı olabilirim\?/);

  const enGreeting = resolveInitialWebChatGreeting({
    brandName: 'DentCare Dental Clinic',
    language: 'en',
  });
  assert.equal(enGreeting, 'Hello! How can I help you today?');

  const arGreeting = resolveInitialWebChatGreeting({
    brandName: 'DentCare Dental Clinic',
    language: 'ar',
  });
  assert.equal(arGreeting, 'مرحباً! كيف يمكنني مساعدتك اليوم؟');
});

test('E. Fresh tenant: no SamChe or demo-specific copy leaks into fresh tenant configuration', () => {
  const freshAppearance = normalizeWebChatAppearance({}, 'Acme Corp');

  assert.equal(freshAppearance.brand_name, 'Acme Corp');
  assert.equal(freshAppearance.greeting, null);

  const freshGreeting = resolveInitialWebChatGreeting({
    configuredGreeting: freshAppearance.greeting,
    brandName: freshAppearance.brand_name,
    language: 'tr',
  });

  assert.doesNotMatch(freshGreeting, /SamChe/i);
  assert.doesNotMatch(freshGreeting, /kablosuz şarj/i);
  assert.doesNotMatch(freshGreeting, /su geçirmez/i);
  assert.doesNotMatch(freshGreeting, /Titan/i);
  assert.equal(freshGreeting, 'Merhaba! Size nasıl yardımcı olabilirim?');
});

test('F. Clean Visitor Product Arrival Timing & Scoring: 0s-14s MEDIUM, >=15s HIGH', () => {
  const catalogBrowsing = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: {
      url: 'https://example.com/task8-demo/',
      path: '/task8-demo/',
      title: 'Catalog',
      page_type: 'catalog',
      entity_type: 'Catalog',
    },
  });

  assert.equal(isDiscreteEntity(catalogBrowsing.currentEntity), false);
  assert.equal(catalogBrowsing.previousEntities.length, 0);

  const titanBrowsing = updateSessionBrowsingState({
    currentState: catalogBrowsing,
    rawPageContext: {
      url: 'https://example.com/task8-demo/#/urun/titan-akilli-saat-pro',
      path: '/urun/titan-akilli-saat-pro',
      title: 'SamChe Titan Akıllı Saat Pro',
      page_type: 'product_detail',
      entity_type: 'PRODUCT',
      entity_id: 'prod_titan_watch_pro',
      entity_name: 'SamChe Titan Akıllı Saat Pro',
      attributes: { category: 'akilli-saat', price: 3499 },
    },
  });

  assert.equal(isDiscreteEntity(titanBrowsing.currentEntity), true);
  assert.equal(titanBrowsing.previousEntities.length, 0);

  // At 0 seconds:
  const eval0 = evaluateVisitorIntent({
    pageContext: titanBrowsing.currentPage,
    currentEntity: titanBrowsing.currentEntity,
    previousEntities: titanBrowsing.previousEntities,
    sessionBrowsing: { dwellSeconds: 0 },
  });
  assert.equal(eval0.score, 55, 'Score at 0s must be exactly 55');
  assert.equal(eval0.intentState, INTENT_STATES.MEDIUM);
  assert.equal(eval0.shouldAutoOpen, false, 'Must NOT auto-open at 0s');
  assert.equal(eval0.shouldProactivelyEngage, false);
  assert.equal(eval0.shouldNudge, true);

  // At 3 seconds:
  const eval3 = evaluateVisitorIntent({
    pageContext: titanBrowsing.currentPage,
    currentEntity: titanBrowsing.currentEntity,
    previousEntities: titanBrowsing.previousEntities,
    sessionBrowsing: { dwellSeconds: 3 },
  });
  assert.equal(eval3.score, 55);
  assert.equal(eval3.shouldAutoOpen, false);

  // At 5 seconds:
  const eval5 = evaluateVisitorIntent({
    pageContext: titanBrowsing.currentPage,
    currentEntity: titanBrowsing.currentEntity,
    previousEntities: titanBrowsing.previousEntities,
    sessionBrowsing: { dwellSeconds: 5 },
  });
  assert.equal(eval5.score, 65);
  assert.equal(eval5.intentState, INTENT_STATES.MEDIUM);
  assert.equal(eval5.shouldAutoOpen, false);

  // At 14 seconds:
  const eval14 = evaluateVisitorIntent({
    pageContext: titanBrowsing.currentPage,
    currentEntity: titanBrowsing.currentEntity,
    previousEntities: titanBrowsing.previousEntities,
    sessionBrowsing: { dwellSeconds: 14 },
  });
  assert.equal(eval14.score, 65);
  assert.equal(eval14.shouldAutoOpen, false);

  // At 15 seconds:
  const eval15 = evaluateVisitorIntent({
    pageContext: titanBrowsing.currentPage,
    currentEntity: titanBrowsing.currentEntity,
    previousEntities: titanBrowsing.previousEntities,
    sessionBrowsing: { dwellSeconds: 15 },
  });
  assert.equal(eval15.score, 80, 'Score at 15s must be exactly 80');
  assert.equal(eval15.intentState, INTENT_STATES.HIGH);
  assert.equal(eval15.shouldAutoOpen, true, 'MUST auto-open at 15s');
  assert.equal(eval15.shouldProactivelyEngage, true);
});
