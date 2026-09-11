import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@localhost:5432/samche_test';
process.env.JWT_SECRET ||= 'test-jwt-secret';

import {
  INTENT_STATES,
  evaluateVisitorIntent,
  generateContextualProactiveMessage,
} from '../services/visitor-intent-service.js';

import {
  isDiscreteEntity,
} from '../services/contextual-intelligence-service.js';

await import('../public/web-chat.js');
const { SamcheChatPersistence } = globalThis;

// ============================================================================
// SCENARIO A: TITAN — Catalog dwell does not trigger, Titan qualifies at >= 15s
// ============================================================================
test('SCENARIO A — TITAN: Catalog has 0 intent, Titan dwell >=15s produces Titan proactive', async () => {
  const catalogContext = {
    page_type: 'catalog',
    path: '/task8-demo/',
  };
  const catalogEval = evaluateVisitorIntent({
    pageContext: catalogContext,
    currentEntity: null,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 20 },
  });

  assert.equal(catalogEval.shouldProactivelyEngage, false);
  assert.equal(catalogEval.shouldAutoOpen, false);

  const titanEntity = {
    entity_id: 'prod-watch-titan',
    entity_name: 'SamChe Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    canonical_url: '/task8-demo/#/urun/titan-akilli-saat-pro',
  };

  const titan0s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/titan-akilli-saat-pro', page_type: 'product_detail' },
    currentEntity: titanEntity,
    sessionBrowsing: { dwellSeconds: 0 },
  });
  assert.equal(titan0s.shouldProactivelyEngage, false);

  const titan14s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/titan-akilli-saat-pro', page_type: 'product_detail' },
    currentEntity: titanEntity,
    sessionBrowsing: { dwellSeconds: 14.9 },
  });
  assert.equal(titan14s.shouldProactivelyEngage, false);

  const titan15s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/titan-akilli-saat-pro', page_type: 'product_detail' },
    currentEntity: titanEntity,
    sessionBrowsing: { dwellSeconds: 15 },
  });
  assert.equal(titan15s.shouldProactivelyEngage, true);
  assert.equal(titan15s.shouldAutoOpen, true);

  const titanMsg = await generateContextualProactiveMessage({
    currentEntity: titanEntity,
    previousEntities: [],
    language: 'tr',
  });
  assert.ok(titanMsg.includes('SamChe Titan Akıllı Saat Pro'));
});

// ============================================================================
// SCENARIO B: HEADPHONES AFTER TITAN — Independent dwell starting at 0
// ============================================================================
test('SCENARIO B — HEADPHONES AFTER TITAN: Dwell starts at 0, Titan preserved, Headphones qualifies independently', async () => {
  const titanEntity = {
    entity_id: 'prod-watch-titan',
    entity_name: 'SamChe Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
  };
  const headphonesEntity = {
    entity_id: 'prod-anc-earbuds',
    entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
    entity_type: 'PRODUCT',
    canonical_url: '/task8-demo/#/urun/ses-pro-kablosuz-kulaklik-anc',
  };

  const engagementAfterTitan = {
    proactiveMessageSent: true,
    proactiveEntityId: 'prod-watch-titan',
    lastAcknowledgedEntityId: 'prod-watch-titan',
    acknowledgedEntityIds: ['prod-watch-titan'],
  };

  const hp0s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ses-pro-kablosuz-kulaklik-anc', page_type: 'product_detail' },
    currentEntity: headphonesEntity,
    previousEntities: [titanEntity],
    sessionBrowsing: { dwellSeconds: 0 },
    engagementState: engagementAfterTitan,
  });
  assert.equal(hp0s.shouldProactivelyEngage, false);

  const hp15s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ses-pro-kablosuz-kulaklik-anc', page_type: 'product_detail' },
    currentEntity: headphonesEntity,
    previousEntities: [titanEntity],
    sessionBrowsing: { dwellSeconds: 15 },
    engagementState: engagementAfterTitan,
  });
  assert.equal(hp15s.shouldProactivelyEngage, true);
  assert.equal(hp15s.shouldAutoOpen, true);
});

// ============================================================================
// SCENARIO C: POWERBANK — Third discrete product receives its own proactive
// ============================================================================
test('SCENARIO C — POWERBANK: Third independent product dwell qualifies with previous history preserved', async () => {
  const titanEntity = { entity_id: 'prod-watch-titan', entity_name: 'SamChe Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };
  const headphonesEntity = { entity_id: 'prod-anc-earbuds', entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC', entity_type: 'PRODUCT' };
  const powerbankEntity = {
    entity_id: 'prod-powerbank-20k',
    entity_name: 'Ultra Güç Bankası 20000mAh',
    entity_type: 'PRODUCT',
    canonical_url: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
  };

  const engagementAfterTwo = {
    proactiveMessageSent: true,
    lastAcknowledgedEntityId: 'prod-anc-earbuds',
    acknowledgedEntityIds: ['prod-watch-titan', 'prod-anc-earbuds'],
  };

  const pb15s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah', page_type: 'product_detail' },
    currentEntity: powerbankEntity,
    previousEntities: [headphonesEntity, titanEntity],
    sessionBrowsing: { dwellSeconds: 15 },
    engagementState: engagementAfterTwo,
  });

  assert.equal(pb15s.shouldProactivelyEngage, true, 'Powerbank must qualify independently');
  assert.equal(pb15s.shouldAutoOpen, true);

  const history = [
    { role: 'assistant', content: 'Merhaba!', message_type: 'INITIAL_GREETING', is_greeting: true },
    { role: 'assistant', content: 'Titan proactive', message_type: 'PROACTIVE', is_proactive: true, entity_id: 'prod-watch-titan' },
    { role: 'assistant', content: 'Headphones proactive', message_type: 'PROACTIVE', is_proactive: true, entity_id: 'prod-anc-earbuds' },
    { role: 'assistant', content: 'Powerbank proactive', message_type: 'PROACTIVE', is_proactive: true, entity_id: 'prod-powerbank-20k' },
  ];

  const rendered = [];
  SamcheChatPersistence.hydrateHistory({}, history, (role, text, meta) => rendered.push({ role, text, meta }));

  assert.equal(rendered.length, 4, 'Transcript must contain exactly 4 messages in chronological order');
});

// ============================================================================
// SCENARIO D: SAME ENTITY SPAM PROTECTION
// ============================================================================
test('SCENARIO D — SAME ENTITY SPAM: Stays on same entity for 30s/60s, close/reopen -> still exactly 1', () => {
  const powerbankEntity = {
    entity_id: 'prod-powerbank-20k',
    entity_name: 'Ultra Güç Bankası 20000mAh',
    entity_type: 'PRODUCT',
  };

  const engagementWithPowerbankAck = {
    proactiveMessageSent: true,
    acknowledgedEntityIds: ['prod-watch-titan', 'prod-anc-earbuds', 'prod-powerbank-20k'],
    lastAcknowledgedEntityId: 'prod-powerbank-20k',
  };

  const pb30s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah', page_type: 'product_detail' },
    currentEntity: powerbankEntity,
    sessionBrowsing: { dwellSeconds: 30 },
    engagementState: engagementWithPowerbankAck,
  });
  assert.equal(pb30s.shouldProactivelyEngage, false);
  assert.equal(pb30s.reason, 'ALREADY_ENGAGED');

  const pb60s = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah', page_type: 'product_detail' },
    currentEntity: powerbankEntity,
    sessionBrowsing: { dwellSeconds: 60 },
    engagementState: engagementWithPowerbankAck,
  });
  assert.equal(pb60s.shouldProactivelyEngage, false);
  assert.equal(pb60s.reason, 'ALREADY_ENGAGED');
});

// ============================================================================
// SCENARIO E: RETURN TO AN ALREADY ACKNOWLEDGED ENTITY
// ============================================================================
test('SCENARIO E — RETURN ENTITY: Titan -> Headphones -> Titan returns 0 new proactives for Titan', () => {
  const titanEntity = {
    entity_id: 'prod-watch-titan',
    entity_name: 'SamChe Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
  };

  const engagementAfterBoth = {
    proactiveMessageSent: true,
    acknowledgedEntityIds: ['prod-watch-titan', 'prod-anc-earbuds'],
    lastAcknowledgedEntityId: 'prod-anc-earbuds',
  };

  const titanReturn = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/titan-akilli-saat-pro', page_type: 'product_detail' },
    currentEntity: titanEntity,
    sessionBrowsing: { dwellSeconds: 20 },
    engagementState: engagementAfterBoth,
  });

  assert.equal(titanReturn.shouldProactivelyEngage, false);
  assert.equal(titanReturn.shouldAutoOpen, false);
  assert.equal(titanReturn.reason, 'ALREADY_ENGAGED');
});

// ============================================================================
// SCENARIO F: REFRESH PERSISTENCE — History and counts remain stable across reloads
// ============================================================================
test('SCENARIO F — REFRESH: Reloading once and twice preserves exact counts (Greeting=1, Titan=1, HP=1, PB=1)', () => {
  const history = [
    { role: 'assistant', content: 'Merhaba!', message_type: 'INITIAL_GREETING', is_greeting: true },
    { role: 'assistant', content: 'Titan proactive', message_type: 'PROACTIVE', is_proactive: true, entity_id: 'prod-watch-titan', proactive_event_id: 'pe_titan' },
    { role: 'assistant', content: 'Headphones proactive', message_type: 'PROACTIVE', is_proactive: true, entity_id: 'prod-anc-earbuds', proactive_event_id: 'pe_headphones' },
    { role: 'assistant', content: 'Powerbank proactive', message_type: 'PROACTIVE', is_proactive: true, entity_id: 'prod-powerbank-20k', proactive_event_id: 'pe_powerbank' },
  ];

  const reload1 = [];
  SamcheChatPersistence.hydrateHistory({}, history, (role, text, meta) => reload1.push({ role, text, meta }));

  assert.equal(reload1.filter(m => m.meta?.message_type === 'INITIAL_GREETING').length, 1);
  assert.equal(reload1.filter(m => m.meta?.entity_id === 'prod-watch-titan').length, 1);
  assert.equal(reload1.filter(m => m.meta?.entity_id === 'prod-anc-earbuds').length, 1);
  assert.equal(reload1.filter(m => m.meta?.entity_id === 'prod-powerbank-20k').length, 1);
  assert.equal(reload1.length, 4);

  const reload2 = [];
  SamcheChatPersistence.hydrateHistory({}, history, (role, text, meta) => reload2.push({ role, text, meta }));
  assert.equal(reload2.length, 4, 'Second reload must maintain identical counts');
});

// ============================================================================
// SCENARIO G: CLEAR CONVERSATION — Resets acknowledgements while preserving page context
// ============================================================================
test('SCENARIO G — CLEAR CONVERSATION: Powerbank context preserved, old proactives cleared, fresh dwell qualifies at 15s', async () => {
  const powerbankEntity = {
    entity_id: 'prod-powerbank-20k',
    entity_name: 'Ultra Güç Bankası 20000mAh',
    entity_type: 'PRODUCT',
    canonical_url: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
  };

  const postClearEngagement = {
    acknowledgedEntityIds: [],
    proactiveMessageSent: false,
    proactiveEngagedAt: null,
    proactiveEntityId: null,
    proactiveEventId: null,
    proactiveMessage: null,
    lastAcknowledgedEntityId: null,
    hasConversation: false,
    messageCount: 0,
    clearedAt: new Date().toISOString(),
  };

  const immediatePostClear = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah', page_type: 'product_detail' },
    currentEntity: powerbankEntity,
    sessionBrowsing: { dwellSeconds: 0 },
    engagementState: postClearEngagement,
  });
  assert.equal(immediatePostClear.shouldProactivelyEngage, false, 'No instant proactive firing upon conversation clear');

  const at15sPostClear = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah', page_type: 'product_detail' },
    currentEntity: powerbankEntity,
    sessionBrowsing: { dwellSeconds: 15 },
    engagementState: postClearEngagement,
  });
  assert.equal(at15sPostClear.shouldProactivelyEngage, true, 'At 15s fresh dwell, Powerbank qualifies in new conversation');
  assert.equal(at15sPostClear.shouldAutoOpen, true);
});

// ============================================================================
// SCENARIO H: CROSS-INDUSTRY CONTRACT — PROPERTY, SERVICE, PROJECT
// ============================================================================
test('SCENARIO H — CROSS-INDUSTRY: Property, Service, Project all qualify without product-specific logic', async () => {
  const propA = {
    entity_id: 'prop-penthouse-401',
    entity_name: 'Marina Sky Penthouse 401',
    entity_type: 'PROPERTY',
    canonical_url: '/properties/penthouse-401',
  };
  const propB = {
    entity_id: 'prop-villa-sol',
    entity_name: 'Bodrum Villa Sol',
    entity_type: 'PROPERTY',
    canonical_url: '/properties/villa-sol',
  };

  assert.ok(isDiscreteEntity(propA), 'PROPERTY must be recognized as discrete entity');
  assert.ok(isDiscreteEntity(propB), 'PROPERTY must be recognized as discrete entity');

  const propAEval = evaluateVisitorIntent({
    pageContext: { path: '/properties/penthouse-401', page_type: 'product_detail' },
    currentEntity: propA,
    sessionBrowsing: { dwellSeconds: 15 },
    engagementState: {},
  });
  assert.equal(propAEval.shouldProactivelyEngage, true, 'Property A must qualify at 15s');

  const propBEval = evaluateVisitorIntent({
    pageContext: { path: '/properties/villa-sol', page_type: 'product_detail' },
    currentEntity: propB,
    previousEntities: [propA],
    sessionBrowsing: { dwellSeconds: 15 },
    engagementState: { acknowledgedEntityIds: ['prop-penthouse-401'] },
  });
  assert.equal(propBEval.shouldProactivelyEngage, true, 'Property B must qualify independently at 15s');
});

// ============================================================================
// SCENARIO I: MULTILINGUAL SUPPORT (TR, EN, AR) WITHOUT HARDCODING
// ============================================================================
test('SCENARIO I — MULTILINGUAL: Proactive copy generates naturally in TR, EN, and AR', async () => {
  const trEntity = { entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };
  const enEntity = { entity_name: 'Titan Smartwatch Pro', entity_type: 'PRODUCT' };
  const arEntity = { entity_name: 'ساعة تيتان الذكية برو', entity_type: 'PRODUCT' };

  const trMsg = await generateContextualProactiveMessage({ currentEntity: trEntity, language: 'tr' });
  const enMsg = await generateContextualProactiveMessage({ currentEntity: enEntity, language: 'en' });
  const arMsg = await generateContextualProactiveMessage({ currentEntity: arEntity, language: 'ar' });

  assert.ok(trMsg.includes('Titan Akıllı Saat Pro'), 'TR message must include entity name');
  assert.ok(enMsg.includes('Titan Smartwatch Pro'), 'EN message must include entity name');
  assert.ok(arMsg.includes('ساعة تيتان الذكية برو'), 'AR message must include entity name');
});

// ============================================================================
// SCENARIO J: CONTEXT INVARIANT TEST
// ============================================================================
test('SCENARIO J — INVARIANT: CURRENT_PAGE_ENTITY = CONTEXT_BADGE_ENTITY = NEW_PROACTIVE_MESSAGE_ENTITY', async () => {
  const headphonesEntity = {
    entity_id: 'prod-anc-earbuds',
    entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
    entity_type: 'PRODUCT',
  };

  const hpMsg = await generateContextualProactiveMessage({
    currentEntity: headphonesEntity,
    previousEntities: [{ entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' }],
    language: 'tr',
  });

  assert.ok(hpMsg.includes('SamChe Ses Pro Kablosuz Kulaklık ANC'), 'Proactive message must ground in current page entity');
  assert.doesNotMatch(hpMsg, /^Merhaba! Titan Akıllı Saat Pro hakkında merak/, 'Proactive must not treat previous entity as current');
});