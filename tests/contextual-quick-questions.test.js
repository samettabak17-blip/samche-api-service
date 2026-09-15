import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateContextualQuickQuestions,
  buildDeterministicQuickQuestions,
} from '../services/contextual-quick-questions-service.js';
import {
  updateSessionBrowsingState,
  isDiscreteEntity,
} from '../services/contextual-intelligence-service.js';

// ============================================================================
// 1. DISCRETE ENTITY RECOGNITION & NON-DISCRETE PREVENTION
// ============================================================================
test('CHIP GENERATION: Discrete entities generate 3-4 bounded contextual chips, non-discrete pages generate 0 chips', async () => {
  const discreteProduct = {
    entity_type: 'PRODUCT',
    entity_id: 'prod-hydroclean',
    entity_name: 'HydroClean Robot Vacuum Cleaner',
    canonical_url: '/products/hydroclean',
    attributes: { price: '$499', suction: '4000Pa' },
  };

  const chips = await generateContextualQuickQuestions({
    currentEntity: discreteProduct,
    language: 'en',
    hasPolicies: true,
  });

  assert.ok(Array.isArray(chips));
  assert.ok(chips.length >= 3 && chips.length <= 4, `Expected 3-4 chips, got ${chips.length}`);
  assert.ok(chips.some((c) => c.includes('features')));
  assert.ok(chips.some((c) => c.includes('delivery') || c.includes('warranty')));

  // Non-discrete home page
  const homeContext = {
    entity_type: 'PAGE',
    entity_id: '/',
    entity_name: 'Home',
    canonical_url: '/',
  };
  const homeChips = await generateContextualQuickQuestions({
    currentEntity: homeContext,
    language: 'en',
  });
  assert.deepEqual(homeChips, [], 'Home page must yield zero chips');

  // Non-discrete catalog page
  const catalogContext = {
    entity_type: 'PRODUCT_LIST',
    entity_id: 'cat-shop',
    entity_name: 'Shop All Categories',
    canonical_url: '/shop',
  };
  const catalogChips = await generateContextualQuickQuestions({
    currentEntity: catalogContext,
    language: 'en',
  });
  assert.deepEqual(catalogChips, [], 'Catalog page must yield zero chips');
});

// ============================================================================
// 2. ENTITY TRANSITION TEST (ENTITY A -> ENTITY B -> ENTITY C)
// ============================================================================
test('ENTITY CHANGE TEST: Navigating A -> B -> C updates chips, removes stale chips, and includes comparison', async () => {
  // Step 1: User visits Entity A (Earbuds)
  const entityA = {
    entity_type: 'PRODUCT',
    entity_id: 'prod-earbuds-anc',
    entity_name: 'SoundCore Pro ANC Earbuds',
    canonical_url: '/products/earbuds',
    attributes: { price: '$149' },
  };

  let browsingState = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: {
      url: 'https://example.com/products/earbuds',
      path: '/products/earbuds',
      entity_type: 'PRODUCT',
      entity_id: 'prod-earbuds-anc',
      entity_name: 'SoundCore Pro ANC Earbuds',
    },
  });

  const chipsA = await generateContextualQuickQuestions({
    currentEntity: browsingState.currentEntity,
    previousEntities: browsingState.previousEntities,
    language: 'en',
    hasPolicies: true,
  });

  assert.ok(chipsA.length >= 3);
  assert.ok(chipsA.some((c) => c.includes('alternatives') || c.includes('compare')));

  // Step 2: User navigates to Entity B (Vacuum Cleaner)
  browsingState = updateSessionBrowsingState({
    currentState: browsingState,
    rawPageContext: {
      url: 'https://example.com/products/hydroclean',
      path: '/products/hydroclean',
      entity_type: 'PRODUCT',
      entity_id: 'prod-hydroclean',
      entity_name: 'HydroClean Robot Vacuum Cleaner',
    },
  });

  assert.equal(browsingState.currentEntity.entity_id, 'prod-hydroclean');
  assert.equal(browsingState.previousEntities.length, 1);
  assert.equal(browsingState.previousEntities[0].entity_id, 'prod-earbuds-anc');

  const chipsB = await generateContextualQuickQuestions({
    currentEntity: browsingState.currentEntity,
    previousEntities: browsingState.previousEntities,
    language: 'en',
    hasPolicies: true,
  });

  // Stale A chips must not be present
  assert.ok(!chipsB.some((c) => c.includes('SoundCore Pro ANC Earbuds features')));
  // Comparison chip must reference previous entity A!
  assert.ok(chipsB.some((c) => c.includes('SoundCore Pro ANC Earbuds')), 'Chips on Entity B must contextualize previous Entity A');
});

test('ENTITY CHANGE TEST (CONTINUED): Entity C navigation and back to non-discrete', async () => {
  let browsingState = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: {
      url: 'https://example.com/products/earbuds',
      path: '/products/earbuds',
      entity_type: 'PRODUCT',
      entity_id: 'prod-earbuds-anc',
      entity_name: 'SoundCore Pro ANC Earbuds',
    },
  });
  browsingState = updateSessionBrowsingState({
    currentState: browsingState,
    rawPageContext: {
      url: 'https://example.com/products/hydroclean',
      path: '/products/hydroclean',
      entity_type: 'PRODUCT',
      entity_id: 'prod-hydroclean',
      entity_name: 'HydroClean Robot Vacuum Cleaner',
    },
  });

  // Step 3: User navigates to Entity C (Fast Charger)
  browsingState = updateSessionBrowsingState({
    currentState: browsingState,
    rawPageContext: {
      url: 'https://example.com/products/apexcharge',
      path: '/products/apexcharge',
      entity_type: 'PRODUCT',
      entity_id: 'prod-apexcharge',
      entity_name: 'ApexCharge 65W GaN Fast Charger',
    },
  });

  assert.equal(browsingState.currentEntity.entity_id, 'prod-apexcharge');
  assert.equal(browsingState.previousEntities.length, 2);
  assert.equal(browsingState.previousEntities[0].entity_id, 'prod-hydroclean');

  const chipsC = await generateContextualQuickQuestions({
    currentEntity: browsingState.currentEntity,
    previousEntities: browsingState.previousEntities,
    language: 'en',
    hasPolicies: true,
  });

  assert.ok(chipsC.some((c) => c.includes('HydroClean Robot Vacuum')), 'Chips on Entity C must contextualize previous Entity B');

  // Step 4: User navigates back to Non-Discrete Catalog
  browsingState = updateSessionBrowsingState({
    currentState: browsingState,
    rawPageContext: {
      url: 'https://example.com/shop',
      path: '/shop',
      page_type: 'PRODUCT_LIST',
      entity_id: 'catalog-root',
    },
  });

  const chipsCatalog = await generateContextualQuickQuestions({
    currentEntity: browsingState.currentEntity,
    previousEntities: browsingState.previousEntities,
    language: 'en',
  });
  assert.deepEqual(chipsCatalog, [], 'Non-discrete catalog navigation must not render entity chips');
});

// ============================================================================
// 3. MULTILINGUAL SUPPORT (EN, TR, AR) & RTL CONTRACT
// ============================================================================
test('MULTILINGUAL: Generates fluent chips in EN, TR, and AR', () => {
  const entity = {
    entity_type: 'PRODUCT',
    entity_id: 'p-1',
    entity_name: 'Robot Süpürge',
  };

  const chipsEn = buildDeterministicQuickQuestions({ currentEntity: entity, language: 'en', hasPolicies: true });
  const chipsTr = buildDeterministicQuickQuestions({ currentEntity: entity, language: 'tr', hasPolicies: true });
  const chipsAr = buildDeterministicQuickQuestions({ currentEntity: entity, language: 'ar', hasPolicies: true });

  assert.ok(chipsEn.some((c) => c.includes('key features')));
  assert.ok(chipsTr.some((c) => c.includes('özellikleri')));
  assert.ok(chipsAr.some((c) => c.includes('الميزات')));

  assert.ok(chipsEn.some((c) => c.includes('delivery')));
  assert.ok(chipsTr.some((c) => c.includes('Teslimat')));
  assert.ok(chipsAr.some((c) => c.includes('التوصيل')));
});

// ============================================================================
// 4. MULTI-INDUSTRY GENERIC ENTITY TYPES
// ============================================================================
test('MULTI-INDUSTRY: Generates appropriate question families across Service, Property, Software, Course', () => {
  const serviceChips = buildDeterministicQuickQuestions({
    currentEntity: { entity_type: 'SERVICE', entity_id: 's-1', entity_name: 'Cloud Consulting' },
    language: 'en',
  });
  assert.ok(serviceChips.some((c) => c.includes('service include')));
  assert.ok(serviceChips.some((c) => c.includes('get started')));

  const propertyChips = buildDeterministicQuickQuestions({
    currentEntity: { entity_type: 'PROPERTY', entity_id: 'pr-1', entity_name: 'Marina Sky Tower' },
    language: 'en',
  });
  assert.ok(propertyChips.some((c) => c.includes('amenities')));
  assert.ok(propertyChips.some((c) => c.includes('floor plans')));

  const saasChips = buildDeterministicQuickQuestions({
    currentEntity: { entity_type: 'SOFTWARE', entity_id: 'sw-1', entity_name: 'CRM Workflow Pro' },
    language: 'en',
  });
  assert.ok(saasChips.some((c) => c.includes('integrations')));
  assert.ok(saasChips.some((c) => c.includes('free trial')));

  const courseChips = buildDeterministicQuickQuestions({
    currentEntity: { entity_type: 'COURSE', entity_id: 'co-1', entity_name: 'AI Engineering Bootcamp' },
    language: 'en',
  });
  assert.ok(courseChips.some((c) => c.includes('curriculum')));
  assert.ok(courseChips.some((c) => c.includes('schedule')));
});

// ============================================================================
// 5. CACHING & DEDUPLICATION (ZERO LLM COST CONTRACT)
// ============================================================================
test('COST CONTRACT: Cache returns identical references for repeated calls without re-computation', async () => {
  const entity = { entity_type: 'PRODUCT', entity_id: 'repeat-test', entity_name: 'Test Gadget' };

  const firstCall = await generateContextualQuickQuestions({
    tenantId: '11111111-1111-4111-8111-111111111111',
    currentEntity: entity,
    language: 'en',
  });

  const secondCall = await generateContextualQuickQuestions({
    tenantId: '11111111-1111-4111-8111-111111111111',
    currentEntity: entity,
    language: 'en',
  });

  assert.equal(firstCall, secondCall, 'Repeated calls must return cached reference with zero duplicate cost');
});

