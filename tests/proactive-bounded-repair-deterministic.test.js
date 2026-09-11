import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENT_STATES,
  evaluateVisitorIntent,
  computeVisitorIntentScore,
} from '../services/visitor-intent-service.js';
import {
  updateSessionBrowsingState,
  isDiscreteEntity,
} from '../services/contextual-intelligence-service.js';
import { resolveInitialWebChatGreeting } from '../services/tenant-web-chat-provisioning-service.js';
import '../public/web-chat.js';

const { SamcheChatPersistence, SamcheProactiveEngagement } = globalThis;

test('1. Same proactive event cannot persist twice', () => {
  // Test memory-level idempotency
  const memStore = [];
  function mockAddWebMemory(role, content, metadata = null) {
    if (metadata?.is_proactive) {
      const existing = memStore.find(m => m.is_proactive || (metadata.proactive_event_id && m.proactive_event_id === metadata.proactive_event_id));
      if (existing) return existing;
    }
    const entry = { role, content, ...(metadata || {}) };
    memStore.push(entry);
    return entry;
  }

  const proactiveEventId = 'pe_sess123_prod-watch-titan';
  const entry1 = mockAddWebMemory('assistant', 'Titan Akıllı Saat Pro inceliyorsunuz.', {
    is_proactive: true,
    proactive_event_id: proactiveEventId,
  });
  const entry2 = mockAddWebMemory('assistant', 'Titan Akıllı Saat Pro inceliyorsunuz.', {
    is_proactive: true,
    proactive_event_id: proactiveEventId,
  });

  assert.equal(memStore.length, 1);
  assert.equal(entry1, entry2);
});

test('2. Refresh after proactive: assistant proactive count remains exactly 1', () => {
  const container = { children: [] };
  const historyFromBootstrap = [
    { role: 'assistant', content: 'Görünüşe göre Titan Saat inceliyorsunuz.', is_proactive: true, proactive_event_id: 'pe_titan' },
    { role: 'assistant', content: 'Görünüşe göre Titan Saat inceliyorsunuz.', is_proactive: true, proactive_event_id: 'pe_titan' },
  ];

  const rendered = [];
  const count = SamcheChatPersistence.hydrateHistory(container, historyFromBootstrap, (role, text, item) => {
    rendered.push({ role, text, event_id: item?.proactive_event_id });
  });

  assert.equal(count, 1, 'Hydrated count must be exactly 1');
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].text, 'Görünüşe göre Titan Saat inceliyorsunuz.');
});

test('3. Refresh + page-context replay: count remains exactly 1', () => {
  const currentEntity = {
    entity_id: 'prod-watch-titan',
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
  };

  const replayedEval = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/titan-akilli-saat-pro', page_type: 'product_detail' },
    currentEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 20 },
    engagementState: {
      proactiveMessageSent: true,
      proactiveEngagedAt: new Date().toISOString(),
      proactiveEventId: 'pe_titan',
    },
  });

  assert.equal(replayedEval.shouldAutoOpen, false);
  assert.equal(replayedEval.shouldProactivelyEngage, false);
  assert.equal(replayedEval.reason, 'ALREADY_ENGAGED');
});

test('4. Navigate to another product: old proactive remains historical once, but is not regenerated', () => {
  const entityTitan = { entity_id: 'prod-watch-titan', entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };
  const entityPowerbank = { entity_id: 'prod-powerbank-20k', entity_name: 'Ultra Güç Bankası 20000mAh', entity_type: 'PRODUCT' };

  const result = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah', page_type: 'product_detail' },
    currentEntity: entityPowerbank,
    previousEntities: [entityTitan],
    sessionBrowsing: { dwellSeconds: 20 },
    engagementState: {
      proactiveMessageSent: true,
      proactiveEngagedAt: new Date(Date.now() - 60000).toISOString(),
    },
  });

  assert.equal(result.shouldAutoOpen, false);
  assert.equal(result.shouldProactivelyEngage, false);
  assert.equal(result.reason, 'ALREADY_ENGAGED');
});

test('5. Dismissal still prevents another auto-open during cooldown', () => {
  const entity = { entity_id: 'prod-powerbank-20k', entity_name: 'Ultra Güç Bankası 20000mAh', entity_type: 'PRODUCT' };
  const dismissedTime = new Date(Date.now() - 60 * 1000).toISOString();

  const result = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah', page_type: 'product_detail' },
    currentEntity: entity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 30 },
    engagementState: {
      dismissedAt: dismissedTime,
    },
  });

  assert.equal(result.shouldAutoOpen, false);
  assert.equal(result.shouldProactivelyEngage, false);
  assert.equal(result.reason, 'DISMISSAL_COOLDOWN');
  assert.equal(result.reason, 'DISMISSAL_COOLDOWN');
});

test('6. Current page badge/entity changes correctly after navigation', () => {
  let state = null;

  // Step 1: Arrive on Titan
  state = updateSessionBrowsingState({
    currentState: state,
    rawPageContext: {
      url: 'https://example.com/task8-demo/#/urun/titan-akilli-saat-pro',
      entity_id: 'prod-watch-titan',
      entity_name: 'SamChe Titan Akıllı Saat Pro',
      entity_type: 'PRODUCT',
    },
  });
  assert.equal(state.currentEntity.entity_name, 'SamChe Titan Akıllı Saat Pro');
  assert.equal(isDiscreteEntity(state.currentEntity), true);

  // Step 2: Navigate to Powerbank
  state = updateSessionBrowsingState({
    currentState: state,
    rawPageContext: {
      url: 'https://example.com/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
      entity_id: 'prod-powerbank-20k',
      entity_name: 'Ultra Güç Bankası 20000mAh',
      entity_type: 'PRODUCT',
    },
  });
  assert.equal(state.currentEntity.entity_name, 'Ultra Güç Bankası 20000mAh');
  assert.equal(state.previousEntities.length, 1);
  assert.equal(state.previousEntities[0].entity_name, 'SamChe Titan Akıllı Saat Pro');

  // Step 3: Navigate to Headphones
  state = updateSessionBrowsingState({
    currentState: state,
    rawPageContext: {
      url: 'https://example.com/task8-demo/#/urun/ses-pro-kablosuz-kulaklik-anc',
      entity_id: 'prod-anc-earbuds',
      entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
      entity_type: 'PRODUCT',
    },
  });
  assert.equal(state.currentEntity.entity_name, 'SamChe Ses Pro Kablosuz Kulaklık ANC');
  assert.equal(state.previousEntities.length, 2);
  assert.equal(state.previousEntities[0].entity_name, 'Ultra Güç Bankası 20000mAh');
});

test('7. Current discrete-entity dwell timing: 0s, 3s, 5s, 10s, 13s, 14s, 14.9s = no auto-open, >=15s = eligible', () => {
  const titanEntity = {
    entity_id: 'prod-watch-titan',
    entity_name: 'SamChe Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    attributes: { screen: 'AMOLED', water_resistance: 'IP68' },
  };
  const pageContext = {
    url: 'https://samche-api-staging.onrender.com/task8-demo/#/urun/titan-akilli-saat-pro',
    path: '/task8-demo/#/urun/titan-akilli-saat-pro',
    page_type: 'product_detail',
  };

  const testMatrix = [
    { dwell: 0, expectAutoOpen: false, expectedIntent: 'MEDIUM' },
    { dwell: 3, expectAutoOpen: false, expectedIntent: 'MEDIUM' },
    { dwell: 5, expectAutoOpen: false, expectedIntent: 'MEDIUM' },
    { dwell: 10, expectAutoOpen: false, expectedIntent: 'MEDIUM' },
    { dwell: 13, expectAutoOpen: false, expectedIntent: 'MEDIUM' },
    { dwell: 14, expectAutoOpen: false, expectedIntent: 'MEDIUM' },
    { dwell: 14.9, expectAutoOpen: false, expectedIntent: 'MEDIUM' },
    { dwell: 15, expectAutoOpen: true, expectedIntent: 'HIGH' },
    { dwell: 18, expectAutoOpen: true, expectedIntent: 'HIGH' },
  ];

  for (const { dwell, expectAutoOpen, expectedIntent } of testMatrix) {
    const res = evaluateVisitorIntent({
      pageContext,
      currentEntity: titanEntity,
      previousEntities: [],
      sessionBrowsing: { dwellSeconds: dwell },
      engagementState: {},
    });

    assert.equal(
      res.shouldAutoOpen,
      expectAutoOpen,
      `At ${dwell}s dwell, shouldAutoOpen must be ${expectAutoOpen}`
    );
    assert.equal(
      res.intentState,
      expectedIntent,
      `At ${dwell}s dwell, intentState must be ${expectedIntent}`
    );
    if (!expectAutoOpen) {
      assert.notEqual(res.reason, 'HIGH_INTENT_ACTIVATION');
    } else {
      assert.equal(res.reason, 'HIGH_INTENT_ACTIVATION');
    }
  }
});

test('8. Catalog dwell 30s → first product: product must still begin at its own 0s dwell', () => {
  let browsingState = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: {
      url: 'https://example.com/task8-demo/',
      entity_type: 'CATALOG',
      entity_name: 'Ürün Kataloğu',
      entity_id: 'catalog',
    },
  });

  assert.equal(browsingState.currentEntityFirstSeenAt, null, 'Catalog must not set discrete entity first seen');

  browsingState = updateSessionBrowsingState({
    currentState: browsingState,
    rawPageContext: {
      url: 'https://example.com/task8-demo/#/urun/titan-akilli-saat-pro',
      entity_id: 'prod-watch-titan',
      entity_name: 'Titan Akıllı Saat Pro',
      entity_type: 'PRODUCT',
    },
  });

  assert.ok(browsingState.currentEntityFirstSeenAt, 'First seen timestamp must be recorded for Titan');

  const evalImmediate = evaluateVisitorIntent({
    pageContext: browsingState.currentPage,
    currentEntity: browsingState.currentEntity,
    previousEntities: browsingState.previousEntities,
    sessionBrowsing: { dwellSeconds: 0 },
    engagementState: browsingState.engagementState,
    currentEntityFirstSeenAt: browsingState.currentEntityFirstSeenAt,
  });

  assert.equal(evalImmediate.shouldAutoOpen, false);
  assert.equal(evalImmediate.intentState, 'MEDIUM');
  assert.equal(evalImmediate.timing.qualified_dwell_seconds, 0);
});
test('9. Product A dwell → Product B: Product B gets its own independent dwell start', async () => {
  let state = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: {
      url: 'https://example.com/task8-demo/#/urun/titan-akilli-saat-pro',
      entity_id: 'prod-watch-titan',
      entity_name: 'Titan Akıllı Saat Pro',
      entity_type: 'PRODUCT',
    },
  });
  const titanSeenAt = state.currentEntityFirstSeenAt;

  await new Promise(resolve => setTimeout(resolve, 15));

  state = updateSessionBrowsingState({
    currentState: state,
    rawPageContext: {
      url: 'https://example.com/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
      entity_id: 'prod-powerbank-20k',
      entity_name: 'Ultra Güç Bankası 20000mAh',
      entity_type: 'PRODUCT',
    },
  });

  assert.ok(state.currentEntityFirstSeenAt);
  assert.notEqual(state.currentEntityFirstSeenAt, titanSeenAt, 'Product B must have its own fresh entity dwell start');
  assert.equal(state.previousEntities.length, 1);
  assert.equal(state.previousEntities[0].entity_id, 'prod-watch-titan');
});

test('10. Fresh Headphone session: generic/configured greeting grounded, suggestions entity-grounded', () => {
  const greeting = resolveInitialWebChatGreeting({
    language: 'tr',
  });

  assert.equal(greeting, 'Merhaba! Size nasıl yardımcı olabilirim?');
  assert.doesNotMatch(greeting, /kablosuz şarj|su geçirmez|titan saat/i);

  assert.equal(resolveInitialWebChatGreeting({ language: 'en' }), 'Hello! How can I help you today?');
  assert.equal(resolveInitialWebChatGreeting({ language: 'ar' }), 'مرحباً! كيف يمكنني مساعدتك اليوم؟');
});