import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWebChatThemeTokens,
  contrastRatio,
  accessibleForegroundFor,
} from '../services/web-chat-theme-service.js';
import {
  normalizeWebChatAppearance,
  normalizeWebChatBehavior,
  DEFAULT_WEB_CHAT_BEHAVIOR,
  DEFAULT_WEB_CHAT_APPEARANCE,
} from '../services/tenant-web-chat-provisioning-service.js';
import {
  validateAndNormalizePageContext,
  resolvePageEntity,
  updateSessionBrowsingState,
  isDiscreteEntity,
} from '../services/contextual-intelligence-service.js';
import {
  evaluateVisitorIntent,
  INTENT_STATES,
} from '../services/visitor-intent-service.js';

test('LAUNCHER: Follow Panel Theme sets dark launcher on dark mode and light launcher on light mode', () => {
  const darkTokens = deriveWebChatThemeTokens({
    mode: 'dark',
    primaryColor: '#2563EB',
    launcherThemeMode: 'follow_theme',
  });
  assert.equal(darkTokens.launcher_theme_mode, 'follow_theme');
  assert.equal(darkTokens.launcher_bg, '#0F172A');
  assert.equal(darkTokens.launcher_text, '#FFFFFF');
  assert.ok(darkTokens.contrast.launcher >= 4.5);

  const lightTokens = deriveWebChatThemeTokens({
    mode: 'light',
    primaryColor: '#2563EB',
    launcherThemeMode: 'follow_theme',
  });
  assert.equal(lightTokens.launcher_theme_mode, 'follow_theme');
  assert.equal(lightTokens.launcher_bg, '#FFFFFF');
  assert.equal(lightTokens.launcher_text, '#0F172A');
  assert.ok(lightTokens.contrast.launcher >= 4.5);
});

test('LAUNCHER: Auto from Brand derives launcher background and text from primary brand color', () => {
  const brandTokens = deriveWebChatThemeTokens({
    mode: 'dark',
    primaryColor: '#10B981',
    launcherThemeMode: 'auto_brand',
  });
  assert.equal(brandTokens.launcher_theme_mode, 'auto_brand');
  assert.equal(brandTokens.launcher_bg, '#10B981');
  assert.ok(brandTokens.contrast.launcher >= 4.5);
  assert.equal(brandTokens.launcher_text, accessibleForegroundFor('#10B981', 4.5));
});

test('LAUNCHER: Custom background, foreground, border, and glow persist when contrast is compliant', () => {
  const customTokens = deriveWebChatThemeTokens({
    mode: 'dark',
    launcherThemeMode: 'custom',
    launcherBg: '#4F46E5',
    launcherText: '#FFFFFF',
    launcherBorder: '#818CF8',
    launcherGlow: '#6366F1',
  });
  assert.equal(customTokens.launcher_theme_mode, 'custom');
  assert.equal(customTokens.launcher_bg, '#4F46E5');
  assert.equal(customTokens.launcher_text, '#FFFFFF');
  assert.equal(customTokens.launcher_border, '#818CF8');
  assert.equal(customTokens.launcher_glow, '#6366F1');
  assert.ok(customTokens.contrast.launcher >= 4.5);
});

test('LAUNCHER: Contrast Guard prevents invisible text by falling back to accessible foreground', () => {
  const lowContrastTokens = deriveWebChatThemeTokens({
    mode: 'dark',
    launcherThemeMode: 'custom',
    launcherBg: '#FFFFFF',
    launcherText: '#F8FAFC',
  });
  assert.equal(lowContrastTokens.launcher_bg, '#FFFFFF');
  assert.equal(lowContrastTokens.launcher_text, '#0F172A');
  assert.ok(lowContrastTokens.contrast.launcher >= 4.5);
});

test('LAUNCHER: Normalization preserves launcher customization attributes safely', () => {
  const norm = normalizeWebChatAppearance({
    launcher_theme_mode: 'custom',
    launcher_bg: '#123456',
    launcher_text: '#ffffff',
    launcher_border: '#345678',
    launcher_glow: '#567890',
  });

  assert.equal(norm.launcher_theme_mode, 'custom');
  assert.equal(norm.launcher_bg, '#123456');
  assert.equal(norm.theme.launcher_bg, '#123456');
  assert.equal(norm.theme.launcher_border, '#345678');
  assert.equal(norm.theme.launcher_glow, '#567890');
});

test('PROACTIVE: DEFAULT_WEB_CHAT_BEHAVIOR has proactive_enabled set to true by default', () => {
  assert.equal(DEFAULT_WEB_CHAT_BEHAVIOR.proactive_enabled, true);
  const norm = normalizeWebChatBehavior({});
  assert.equal(norm.proactive_enabled, true);
});

test('PROACTIVE: Mutation recapture preserves dwell timer for same discrete entity', () => {
  const initialPayload = {
    url: 'https://demo.samchecompany.com/samche-airpure-hepa-desktop-purifier',
    path: '/samche-airpure-hepa-desktop-purifier',
    title: 'SAMCHE AirPure HEPA Desktop Purifier',
    entity_type: 'PRODUCT',
    entity_id: '/samche-airpure-hepa-desktop-purifier',
    entity_name: 'SAMCHE AirPure HEPA Desktop Purifier',
    attributes: { price: '219.00' },
  };

  const state1 = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: initialPayload,
  });

  const firstSeen = state1.currentEntityFirstSeenAt;
  assert.ok(firstSeen, 'First seen timestamp should be set');

  const mutatedPayload = {
    ...initialPayload,
    headings: ['SAMCHE AirPure HEPA Desktop Purifier', 'Trending Deals You May Like'],
    attributes: {
      price: '219.00',
      page_headings: ['SAMCHE AirPure HEPA Desktop Purifier', 'Trending Deals You May Like'],
    },
  };

  const state2 = updateSessionBrowsingState({
    currentState: state1,
    rawPageContext: mutatedPayload,
  });

  assert.equal(state2.currentEntityFirstSeenAt, firstSeen, 'Dwell timer first seen timestamp MUST be preserved on same entity mutation');
  assert.equal(state2.currentEntity.entity_id, '/samche-airpure-hepa-desktop-purifier');
  assert.equal(isDiscreteEntity(state2.currentEntity), true);
});

test('PROACTIVE: Navigating to a new discrete entity strictly resets dwell to zero', async () => {
  const productA = {
    url: 'https://demo.samchecompany.com/product-a',
    path: '/product-a',
    title: 'Product A',
    entity_type: 'PRODUCT',
    entity_id: '/product-a',
    entity_name: 'Product A',
    attributes: { price: '100.00' },
  };

  const stateA = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: productA,
  });

  const firstSeenA = stateA.currentEntityFirstSeenAt;

  await new Promise((r) => setTimeout(r, 15));

  const productB = {
    url: 'https://demo.samchecompany.com/product-b',
    path: '/product-b',
    title: 'Product B',
    entity_type: 'PRODUCT',
    entity_id: '/product-b',
    entity_name: 'Product B',
    attributes: { price: '200.00' },
  };

  const stateB = updateSessionBrowsingState({
    currentState: stateA,
    rawPageContext: productB,
  });

  assert.notEqual(stateB.currentEntityFirstSeenAt, firstSeenA, 'Navigation to Product B must reset first seen timestamp');
  assert.equal(stateB.currentEntity.entity_id, '/product-b');
  assert.equal(stateB.previousEntities.length, 1);
  assert.equal(stateB.previousEntities[0].entity_id, '/product-a');
});

test('PROACTIVE: Collection page does not trigger proactive engagement even with dwell', () => {
  const collectionPayload = {
    url: 'https://demo.samchecompany.com/shop',
    path: '/shop',
    title: 'Shop All Categories',
    entity_type: 'COLLECTION',
    entity_id: '/shop',
    entity_name: 'Shop',
    attributes: {},
  };

  const state = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: collectionPayload,
  });

  assert.equal(state.currentEntityFirstSeenAt, null, 'Non-discrete collection page must have null entity dwell');
  assert.equal(isDiscreteEntity(state.currentEntity), false);

  const evaluation = evaluateVisitorIntent({
    pageContext: state.currentPage,
    currentEntity: state.currentEntity,
    sessionBrowsing: { dwellSeconds: 30 },
  });

  assert.equal(evaluation.shouldProactivelyEngage, false, 'Collection page must never trigger proactive engagement');
});

test('PROACTIVE: Discrete product triggers proactive engagement at >=15s and enforces deduplication', () => {
  const productPayload = {
    url: 'https://demo.samchecompany.com/samche-airpure-hepa-desktop-purifier',
    path: '/samche-airpure-hepa-desktop-purifier',
    title: 'SAMCHE AirPure HEPA Desktop Purifier',
    entity_type: 'PRODUCT',
    entity_id: '/samche-airpure-hepa-desktop-purifier',
    entity_name: 'SAMCHE AirPure HEPA Desktop Purifier',
    attributes: { price: '219.00' },
  };

  const state = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: productPayload,
  });

  // At 10s: not qualified
  const eval10s = evaluateVisitorIntent({
    pageContext: state.currentPage,
    currentEntity: state.currentEntity,
    sessionBrowsing: { dwellSeconds: 10 },
  });
  assert.equal(eval10s.shouldProactivelyEngage, false);

  // At 15s: qualified!
  const eval15s = evaluateVisitorIntent({
    pageContext: state.currentPage,
    currentEntity: state.currentEntity,
    sessionBrowsing: { dwellSeconds: 15 },
  });
  assert.equal(eval15s.shouldProactivelyEngage, true);
  assert.equal(eval15s.intentState, INTENT_STATES.HIGH);

  // Dedupe: when acknowledged, same entity must NOT fire again
  const evalDedupe = evaluateVisitorIntent({
    pageContext: state.currentPage,
    currentEntity: state.currentEntity,
    sessionBrowsing: { dwellSeconds: 25 },
    engagementState: {
      proactiveMessageSent: true,
      acknowledgedEntityIds: ['/samche-airpure-hepa-desktop-purifier'],
    },
  });
  assert.equal(evalDedupe.shouldProactivelyEngage, false, 'Already acknowledged entity must not re-trigger');
});
