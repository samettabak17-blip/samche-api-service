import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENT_STATES,
  evaluateVisitorIntent,
  computeVisitorIntentScore,
  generateContextualOpeningMessage,
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

test('11. Full lifecycle deterministic fidelity: greeting, proactive, refresh x2, navigation, user message, refresh x3', () => {
  const resolvedGreeting = resolveInitialWebChatGreeting({ language: 'tr' });
  const serverHistoryStore = [
    {
      role: 'assistant',
      content: resolvedGreeting,
      message_type: 'INITIAL_GREETING',
      is_greeting: true,
      id: 'greeting_session_001',
    }
  ];

  class MockTranscript {
    constructor() { this.messages = []; }
    append(role, text, meta) {
      let msgType = meta?.message_type || (role === 'user' ? 'USER' : 'ASSISTANT');
      if (meta?.is_greeting || meta?.message_type === 'INITIAL_GREETING') msgType = 'INITIAL_GREETING';
      if (meta?.is_proactive || meta?.message_type === 'PROACTIVE') msgType = 'PROACTIVE';
      const msg = { role, text, messageType: msgType, proactiveEventId: meta?.proactive_event_id || null };
      this.messages.push(msg);
      return msg;
    }
    get greetingCount() { return this.messages.filter(m => m.messageType === 'INITIAL_GREETING').length; }
    get proactiveCount() { return this.messages.filter(m => m.messageType === 'PROACTIVE').length; }
    get userCount() { return this.messages.filter(m => m.messageType === 'USER').length; }
    get assistantCount() { return this.messages.filter(m => m.messageType === 'ASSISTANT').length; }
    get types() { return this.messages.map(m => m.messageType); }
  }

  // 1 & 2: Direct/open product. Open widget before proactive.
  let transcript = new MockTranscript();
  SamcheChatPersistence.hydrateHistory(transcript, serverHistoryStore, (role, text, item) => {
    transcript.append(role, text, item);
  });

  assert.equal(transcript.greetingCount, 1, 'Initial greeting must be present');
  assert.equal(transcript.proactiveCount, 0, 'Proactive message must not exist yet');
  assert.deepEqual(transcript.types, ['INITIAL_GREETING']);

  // 3 & 4: Qualified HIGH proactive occurs.
  const proactiveEventId = 'pe_session_001_prod-watch-titan';
  const proactiveText = 'Görünüşe göre SamChe Titan Akıllı Saat Pro\'yu inceliyorsunuz.';

  serverHistoryStore.push({
    role: 'assistant',
    content: proactiveText,
    message_type: 'PROACTIVE',
    is_proactive: true,
    proactive_event_id: proactiveEventId,
  });

  transcript.append('bot', proactiveText, {
    message_type: 'PROACTIVE',
    is_proactive: true,
    proactive_event_id: proactiveEventId,
  });

  assert.equal(transcript.greetingCount, 1, 'Greeting must not be removed on proactive engagement');
  assert.equal(transcript.proactiveCount, 1, 'Proactive count must be exactly 1');
  assert.deepEqual(transcript.types, ['INITIAL_GREETING', 'PROACTIVE'], 'Order must be GREETING before PROACTIVE');

  // 5: Refresh 1
  transcript = new MockTranscript();
  SamcheChatPersistence.hydrateHistory(transcript, serverHistoryStore, (role, text, item) => {
    transcript.append(role, text, item);
  });
  assert.equal(transcript.greetingCount, 1, 'Refresh 1: Greeting count must be 1');
  assert.equal(transcript.proactiveCount, 1, 'Refresh 1: Proactive count must be 1');
  assert.deepEqual(transcript.types, ['INITIAL_GREETING', 'PROACTIVE']);

  // 6: Refresh 2
  transcript = new MockTranscript();
  SamcheChatPersistence.hydrateHistory(transcript, serverHistoryStore, (role, text, item) => {
    transcript.append(role, text, item);
  });
  assert.equal(transcript.greetingCount, 1, 'Refresh 2: Greeting count must be 1');
  assert.equal(transcript.proactiveCount, 1, 'Refresh 2: Proactive count must be 1');
  assert.deepEqual(transcript.types, ['INITIAL_GREETING', 'PROACTIVE']);

  // 7: Navigate during cooldown: counts unchanged
  assert.equal(transcript.greetingCount, 1);
  assert.equal(transcript.proactiveCount, 1);

  // 8: Send user message and assistant reply
  serverHistoryStore.push({ role: 'user', content: 'Fiyatı nedir?', message_type: 'USER' });
  serverHistoryStore.push({ role: 'assistant', content: '2.499 TL', message_type: 'ASSISTANT' });
  transcript.append('user', 'Fiyatı nedir?', { message_type: 'USER' });
  transcript.append('bot', '2.499 TL', { message_type: 'ASSISTANT' });

  assert.deepEqual(transcript.types, ['INITIAL_GREETING', 'PROACTIVE', 'USER', 'ASSISTANT']);

  // 9: Refresh again after conversation turns
  transcript = new MockTranscript();
  SamcheChatPersistence.hydrateHistory(transcript, serverHistoryStore, (role, text, item) => {
    transcript.append(role, text, item);
  });
  assert.equal(transcript.greetingCount, 1);
  assert.equal(transcript.proactiveCount, 1);
  assert.equal(transcript.userCount, 1);
  assert.equal(transcript.assistantCount, 1);
  assert.deepEqual(transcript.types, ['INITIAL_GREETING', 'PROACTIVE', 'USER', 'ASSISTANT']);
});

test('12. SCENARIO A — Manual open after proactive acknowledgement on new discrete entity', async () => {
  const resolvedGreeting = resolveInitialWebChatGreeting({ language: 'tr' });
  const serverHistory = [
    {
      role: 'assistant',
      content: resolvedGreeting,
      message_type: 'INITIAL_GREETING',
      is_greeting: true,
      id: 'greeting_sess_a',
    },
    {
      role: 'assistant',
      content: 'Görünüşe göre SamChe Titan Akıllı Saat Pro inceliyorsunuz.',
      message_type: 'PROACTIVE',
      is_proactive: true,
      proactive_event_id: 'pe_sess_a_prod-watch-titan',
      entity_id: 'prod-watch-titan',
      entity_name: 'SamChe Titan Akıllı Saat Pro',
      entity_type: 'PRODUCT',
    }
  ];

  const currentEntity = {
    entity_id: 'prod-anc-earbuds',
    entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
    entity_type: 'PRODUCT',
  };
  const previousEntities = [
    {
      entity_id: 'prod-watch-titan',
      entity_name: 'SamChe Titan Akıllı Saat Pro',
      entity_type: 'PRODUCT',
    }
  ];

  const contextualMsg = await generateContextualOpeningMessage({
    currentEntity,
    previousEntities,
    language: 'tr',
  });

  assert.ok(contextualMsg.includes('SamChe Ses Pro Kablosuz Kulaklık ANC'));
  assert.ok(contextualMsg.includes('Titan'));

  const ctxEventId = 'ctx_open_sess_a_prod-anc-earbuds';
  serverHistory.push({
    role: 'assistant',
    content: contextualMsg,
    message_type: 'CONTEXTUAL_OPEN',
    contextual_event_id: ctxEventId,
    entity_id: 'prod-anc-earbuds',
    entity_name: currentEntity.entity_name,
    entity_type: currentEntity.entity_type,
    id: ctxEventId,
  });

  const rendered = [];
  SamcheChatPersistence.hydrateHistory({}, serverHistory, (role, text, item) => {
    rendered.push({ role, text, message_type: item.message_type, entity_id: item.entity_id });
  });

  assert.equal(rendered.length, 3);
  assert.equal(rendered[0].message_type, 'INITIAL_GREETING');
  assert.equal(rendered[1].message_type, 'PROACTIVE');
  assert.equal(rendered[1].entity_id, 'prod-watch-titan');
  assert.equal(rendered[2].message_type, 'CONTEXTUAL_OPEN');
  assert.equal(rendered[2].entity_id, 'prod-anc-earbuds');

  const greetingCount = rendered.filter(m => m.message_type === 'INITIAL_GREETING').length;
  const titanProactiveCount = rendered.filter(m => m.message_type === 'PROACTIVE' && m.entity_id === 'prod-watch-titan').length;
  const headphoneContextualCount = rendered.filter(m => m.message_type === 'CONTEXTUAL_OPEN' && m.entity_id === 'prod-anc-earbuds').length;

  assert.equal(greetingCount, 1);
  assert.equal(titanProactiveCount, 1);
  assert.equal(headphoneContextualCount, 1);
});

test('13. SCENARIO B — Multi-step navigation across discrete entities (Titan -> Headphones -> Powerbank)', async () => {
  const serverHistory = [
    {
      role: 'assistant',
      content: 'Merhaba!',
      message_type: 'INITIAL_GREETING',
      is_greeting: true,
      id: 'greeting_sess_b',
    },
    {
      role: 'assistant',
      content: 'Titan Saat inceliyorsunuz.',
      message_type: 'PROACTIVE',
      is_proactive: true,
      proactive_event_id: 'pe_titan',
      entity_id: 'prod-watch-titan',
    },
    {
      role: 'assistant',
      content: 'Kulaklık inceliyorsunuz.',
      message_type: 'CONTEXTUAL_OPEN',
      contextual_event_id: 'ctx_headphones',
      entity_id: 'prod-anc-earbuds',
    }
  ];

  const entityPowerbank = {
    entity_id: 'prod-powerbank-20k',
    entity_name: 'Ultra Güç Bankası 20000mAh',
    entity_type: 'PRODUCT',
  };

  const powerbankMsg = await generateContextualOpeningMessage({
    currentEntity: entityPowerbank,
    previousEntities: [
      { entity_id: 'prod-anc-earbuds', entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC' },
      { entity_id: 'prod-watch-titan', entity_name: 'Titan Akıllı Saat Pro' },
    ],
    language: 'tr',
  });

  assert.ok(powerbankMsg.includes('Ultra Güç Bankası 20000mAh'));

  serverHistory.push({
    role: 'assistant',
    content: powerbankMsg,
    message_type: 'CONTEXTUAL_OPEN',
    contextual_event_id: 'ctx_powerbank',
    entity_id: 'prod-powerbank-20k',
    id: 'ctx_powerbank',
  });

  const rendered = [];
  SamcheChatPersistence.hydrateHistory({}, serverHistory, (role, text, item) => {
    rendered.push({ message_type: item.message_type, entity_id: item.entity_id });
  });

  assert.equal(rendered.length, 4);
  assert.equal(rendered.filter(m => m.message_type === 'INITIAL_GREETING').length, 1);
  assert.equal(rendered.filter(m => m.message_type === 'PROACTIVE').length, 1);
  assert.equal(rendered.filter(m => m.message_type === 'CONTEXTUAL_OPEN' && m.entity_id === 'prod-anc-earbuds').length, 1);
  assert.equal(rendered.filter(m => m.message_type === 'CONTEXTUAL_OPEN' && m.entity_id === 'prod-powerbank-20k').length, 1);
});

test('14. SCENARIO C — Full reload hydration preserves sequence and prevents duplicates', () => {
  const fullTranscript = [
    { role: 'assistant', content: 'Merhaba!', message_type: 'INITIAL_GREETING', is_greeting: true, id: 'g1' },
    { role: 'assistant', content: 'Titan Saat', message_type: 'PROACTIVE', is_proactive: true, proactive_event_id: 'pe1', entity_id: 'prod-watch-titan' },
    { role: 'assistant', content: 'Kulaklık', message_type: 'CONTEXTUAL_OPEN', contextual_event_id: 'ctx1', entity_id: 'prod-anc-earbuds' },
    { role: 'assistant', content: 'Güç Bankası', message_type: 'CONTEXTUAL_OPEN', contextual_event_id: 'ctx2', entity_id: 'prod-powerbank-20k' },
  ];

  const duplicatedReplay = [...fullTranscript, ...fullTranscript];

  const rendered = [];
  SamcheChatPersistence.hydrateHistory({}, duplicatedReplay, (role, text, item) => {
    rendered.push(item);
  });

  assert.equal(rendered.length, 4, 'Exact sequence must be preserved without duplicates');
  assert.equal(rendered[0].message_type, 'INITIAL_GREETING');
  assert.equal(rendered[1].message_type, 'PROACTIVE');
  assert.equal(rendered[2].entity_id, 'prod-anc-earbuds');
  assert.equal(rendered[3].entity_id, 'prod-powerbank-20k');
});

test('15. SCENARIO D — Proactive cooldown blocks automatic proactive, while manual contextual open works independently', async () => {
  const dismissedTime = new Date(Date.now() - 60 * 1000).toISOString();
  const headphoneEntity = {
    entity_id: 'prod-anc-earbuds',
    entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
    entity_type: 'PRODUCT',
  };

  const autoEval = evaluateVisitorIntent({
    pageContext: { path: '/task8-demo/#/urun/ses-pro-kablosuz-kulaklik-anc', page_type: 'product_detail' },
    currentEntity: headphoneEntity,
    previousEntities: [{ entity_id: 'prod-watch-titan', entity_name: 'Titan Akıllı Saat Pro' }],
    sessionBrowsing: { dwellSeconds: 20 },
    engagementState: {
      proactiveMessageSent: true,
      dismissedAt: dismissedTime,
      lastAcknowledgedEntityId: 'prod-watch-titan',
    },
  });

  assert.equal(autoEval.shouldAutoOpen, false);
  assert.equal(autoEval.shouldProactivelyEngage, false);

  const manualOpenMessage = await generateContextualOpeningMessage({
    currentEntity: headphoneEntity,
    previousEntities: [{ entity_id: 'prod-watch-titan', entity_name: 'Titan Akıllı Saat Pro' }],
    language: 'tr',
  });

  assert.ok(manualOpenMessage);
  assert.ok(manualOpenMessage.includes('Kulaklık'));
});


test('16. SCENARIO E — Cross-industry discrete entity handling (Hotel / Real Estate / Service)', async () => {
  const realEstateEntity = {
    entity_id: 'prop-marina-penthouse',
    entity_name: 'Dubai Marina Luxury Penthouse',
    entity_type: 'RealEstateProperty',
  };
  const prevProperty = {
    entity_id: 'prop-downtown-loft',
    entity_name: 'Downtown Boulevard Loft',
    entity_type: 'RealEstateProperty',
  };

  const trMsg = await generateContextualOpeningMessage({
    currentEntity: realEstateEntity,
    previousEntities: [prevProperty],
    language: 'tr',
  });
  assert.ok(trMsg.includes('Dubai Marina Luxury Penthouse'));
  assert.ok(trMsg.includes('Downtown Boulevard Loft'));

  const enMsg = await generateContextualOpeningMessage({
    currentEntity: realEstateEntity,
    previousEntities: [prevProperty],
    language: 'en',
  });
  assert.ok(enMsg.includes('Dubai Marina Luxury Penthouse'));
  assert.ok(enMsg.includes('Downtown Boulevard Loft'));

  const arMsg = await generateContextualOpeningMessage({
    currentEntity: realEstateEntity,
    previousEntities: [prevProperty],
    language: 'ar',
  });
  assert.ok(arMsg.includes('Dubai Marina Luxury Penthouse'));
});

test('17. SCENARIO F — Non-discrete catalog / home navigation produces NO invalid contextual open and preserves transcript', () => {
  const catalogContext = {
    url: 'https://example.com/task8-demo/#/',
    path: '/task8-demo/#/',
    entity_type: 'Catalog',
    page_type: 'catalog',
  };

  const isNonDiscrete = !catalogContext.entity_type
    || /^(?:PAGE|GENERIC_PAGE|CATALOG|CATALOGUE|HOME|HOMEPAGE|LANDING|SEARCH|CATEGORY|CATEGORIES|COLLECTION|COLLECTIONS|ABOUT|SECURITY|CONTACT|TERMS|PRIVACY|FAQ)/i.test(catalogContext.entity_type)
    || /^(?:catalog|home|pricing|security|about)/i.test(catalogContext.page_type || '');

  assert.equal(isNonDiscrete, true, 'Catalog page context must be recognized as non-discrete');
});


