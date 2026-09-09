import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateSessionBrowsingState,
  buildContextualIntelligencePromptSection,
  formatVisitorContextForHandoff,
} from '../services/contextual-intelligence-service.js';

test('E-Commerce scenario: Product A -> Product B -> specs and price comparison', () => {
  let sessionState = null;

  // Step 1: Visitor views Product A (e.g. Mechanical Keyboard Pro)
  sessionState = updateSessionBrowsingState({
    currentState: sessionState,
    rawPageContext: {
      url: 'https://store.example.com/products/keyboard-pro',
      path: '/products/keyboard-pro',
      title: 'MechPro Wireless Mechanical Keyboard',
      entity_type: 'PRODUCT',
      entity_id: 'sku_keyboard_pro',
      entity_name: 'MechPro Wireless Keyboard',
      summary: 'Hot-swappable wireless mechanical keyboard with RGB backlighting.',
      attributes: {
        price: 149.99,
        currency: 'USD',
        switch_type: 'Cherry MX Brown',
        connectivity: 'Bluetooth 5.2 / 2.4GHz / USB-C',
        battery_life: '80 hours',
        in_stock: true,
      },
    },
  });

  assert.equal(sessionState.currentEntity.entity_name, 'MechPro Wireless Keyboard');
  assert.equal(sessionState.previousEntities.length, 0);

  // Step 2: Visitor views Product B (e.g. MechUltra Ergonomic Keyboard)
  sessionState = updateSessionBrowsingState({
    currentState: sessionState,
    rawPageContext: {
      url: 'https://store.example.com/products/keyboard-ultra',
      path: '/products/keyboard-ultra',
      title: 'MechUltra Ergonomic Split Keyboard',
      entity_type: 'PRODUCT',
      entity_id: 'sku_keyboard_ultra',
      entity_name: 'MechUltra Ergonomic Split Keyboard',
      summary: 'Split ergonomic mechanical keyboard designed for maximum typing posture comfort.',
      attributes: {
        price: 219.99,
        currency: 'USD',
        switch_type: 'Gateron Red Low Profile',
        connectivity: 'USB-C Wired Only',
        wrist_rest: 'Included Memory Foam',
        in_stock: true,
      },
    },
  });

  assert.equal(sessionState.currentEntity.entity_name, 'MechUltra Ergonomic Split Keyboard');
  assert.equal(sessionState.previousEntities.length, 1);
  assert.equal(sessionState.previousEntities[0].entity_name, 'MechPro Wireless Keyboard');

  // Step 3: Visitor asks: "How does this compare to the previous keyboard?"
  const promptSection = buildContextualIntelligencePromptSection({
    currentEntity: sessionState.currentEntity,
    previousEntities: sessionState.previousEntities,
    locale: 'en',
    channelType: 'WEB_CHAT',
  });

  assert.match(promptSection, /MechUltra Ergonomic Split Keyboard/);
  assert.match(promptSection, /MechPro Wireless Keyboard/);
  assert.match(promptSection, /219.99/);
  assert.match(promptSection, /149.99/);
  assert.match(promptSection, /Gateron Red Low Profile/);
  assert.match(promptSection, /Cherry MX Brown/);
  assert.match(promptSection, /USB-C Wired Only/);
  assert.match(promptSection, /Bluetooth 5.2/);
  assert.match(promptSection, /FACT vs RECOMMENDATION/);
  assert.match(promptSection, /MULTI-ENTITY COMPARISON/);
  assert.match(promptSection, /NEVER invent or hallucinate missing facts/);

  // Step 4: Handoff preserves context
  const handoff = formatVisitorContextForHandoff(sessionState);
  assert.equal(handoff.current_entity.name, 'MechUltra Ergonomic Split Keyboard');
  assert.equal(handoff.previous_entities[0].name, 'MechPro Wireless Keyboard');
});
