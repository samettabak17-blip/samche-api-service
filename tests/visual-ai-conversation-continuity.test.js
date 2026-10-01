import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVisualIntent,
  resolveWhatsAppVisualRequestState,
  loadActiveVisualSessionContext,
  buildVisualSessionPromptSection,
} from '../services/visual-intelligence-intent-service.js';
import { planStandaloneWhatsAppMediaResponse } from '../services/whatsapp-standalone-media-ack.js';

const tenantAlpha = '11111111-1111-4111-8111-111111111111';
const tenantBeta = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const customerTargetImageId = '44444444-4444-4444-8444-444444444444';
const generatedOutputImageId = '55555555-5555-4555-8555-555555555555';
const catalogEntityId = '66666666-6666-4666-8666-666666666666';
const catalogMediaId = '77777777-7777-4777-8777-777777777777';

const mockCatalogProduct = {
  id: catalogEntityId,
  name: 'Nordic Oak Bed Frame',
  type: 'BED_FRAME',
  description: 'Solid oak modern minimalist bed frame',
  attributes: {
    price: '$799',
    material: 'Solid Oak Wood',
    dimensions: '160x200 cm (Queen)',
    available_colors: 'Natural Oak, Walnut, White',
  },
};

function createMockConversationDatabase({
  tenantId = tenantAlpha,
  hasPreviousJob = false,
  previousProduct = mockCatalogProduct,
} = {}) {
  const previousJob = hasPreviousJob ? {
    id: '99999999-9999-4999-8999-999999999999',
    tenant_id: tenantId,
    conversation_id: conversationId,
    target_resource_id: customerTargetImageId,
    generated_resource_id: generatedOutputImageId,
    prompt_instruction: 'Find the product from catalog that best suits my room and create a visual.',
    grounding_context: {
      catalogRequested: true,
      originalCustomerTargetResourceId: customerTargetImageId,
      catalog: { entityId: previousProduct.id, mediaIds: [catalogMediaId] },
      entity: previousProduct,
      language: 'en',
    },
    provider: 'MOCK',
    model: 'mock-visual-v1',
    status: 'COMPLETED',
    created_at: new Date().toISOString(),
  } : null;

  return {
    async query(sql, params) {
      if (sql.includes('visual_ai_generation_jobs') && sql.includes('SELECT')) {
        return { rows: previousJob ? [previousJob] : [] };
      }
      if (sql.includes('conversation_resources')) {
        return {
          rows: [
            { id: generatedOutputImageId, source_type: 'VISUAL_AI_GENERATED', media_category: 'IMAGE', processing_status: 'READY' },
            { id: customerTargetImageId, source_type: 'WHATSAPP_MEDIA', media_category: 'IMAGE', processing_status: 'READY' },
          ],
        };
      }
      if (sql.includes('knowledge_entities') || sql.includes('is_runtime_eligible')) {
        return {
          rows: [
            {
              id: previousProduct.id,
              tenant_id: tenantId,
              name: previousProduct.name,
              entity_type: previousProduct.type,
              description: previousProduct.description,
              attributes: previousProduct.attributes,
              confidence: 0.99,
              approved_media: [{ id: catalogMediaId, mime_type: 'image/png', storage_key: `knowledge/${tenantId}/item.png` }],
            },
          ],
        };
      }
test('TEST 1: Image + catalog selection + visual generation + "change color" maintains same product context', async () => {
  const db = createMockConversationDatabase({ tenantId: tenantAlpha, hasPreviousJob: true });

  const result = await resolveWhatsAppVisualRequestState({
    database: db,
    tenantId: tenantAlpha,
    conversationId,
    message: 'change color',
    language: 'en',
  });

  assert.equal(result.state, 'READY_FOR_GENERATION');
  assert.equal(result.intentClassification.isVisualGeneration, true);
  assert.equal(result.targetResourceId, customerTargetImageId, 'Must reuse the customer room target image');
  assert.equal(result.originalCustomerTargetResourceId, customerTargetImageId);
  assert.equal(result.catalogRequested, true, 'Catalog context must be preserved');
  assert.equal(result.previousEntityId, catalogEntityId, 'Must retain previous product ID');
  assert.equal(result.requireDifferentEntity, false, 'Must keep the same product context for color change');
});

test('TEST 1b: "try another color" preserves product context and room target', async () => {
  const db = createMockConversationDatabase({ tenantId: tenantAlpha, hasPreviousJob: true });

  const result = await resolveWhatsAppVisualRequestState({
    database: db,
    tenantId: tenantAlpha,
    conversationId,
    message: 'Try another color, maybe in blue.',
    language: 'en',
  });

  assert.equal(result.state, 'READY_FOR_GENERATION');
  assert.equal(result.targetResourceId, customerTargetImageId);
  assert.equal(result.catalogRequested, true);
  assert.equal(result.previousEntityId, catalogEntityId);
  assert.equal(result.requireDifferentEntity, false);
});

test('TEST 2: Visual generation + price question returns NOT_VISUAL_GENERATION and preserves active session', async () => {
  const db = createMockConversationDatabase({ tenantId: tenantAlpha, hasPreviousJob: true });

  // Turn 2: User asks "What is the price?"
  const visualRequest = await resolveWhatsAppVisualRequestState({
    database: db,
    tenantId: tenantAlpha,
    conversationId,
    message: 'What is the price?',
    language: 'en',
  });

  assert.equal(visualRequest.state, 'NOT_VISUAL_GENERATION', 'Price question must not trigger a visual generation pipeline');

  // Load the active visual session context
  const session = await loadActiveVisualSessionContext({
    database: db,
    tenantId: tenantAlpha,
    conversationId,
  });

  assert.ok(session, 'Visual session must exist and be loaded');
  assert.equal(session.active, true);
  assert.equal(session.productId, catalogEntityId);
  assert.equal(session.productName, 'Nordic Oak Bed Frame');
  assert.equal(session.productAttributes.price, '$799');

  // Verify prompt grounding contains product details and priority rules
  const promptSection = buildVisualSessionPromptSection(session);
  assert.match(promptSection, /Nordic Oak Bed Frame/);
  assert.match(promptSection, /\$799/);
  assert.match(promptSection, /CONTEXT PRIORITY ORDER/);
  assert.match(promptSection, /TEXT QUESTIONS DURING VISUAL SESSION/);
});

test('TEST 2b: Text questions ("Why did you choose this product?", "Does this come in another size?") preserve visual session', async () => {
  const db = createMockConversationDatabase({ tenantId: tenantAlpha, hasPreviousJob: true });

  for (const question of ['Why did you choose this product?', 'Does this come in another size?', 'What are the dimensions?']) {
    const visualRequest = await resolveWhatsAppVisualRequestState({
      database: db,
      tenantId: tenantAlpha,
      conversationId,
      message: question,
      language: 'en',
    });
    assert.equal(visualRequest.state, 'NOT_VISUAL_GENERATION', `Question "${question}" should be text answering, not visual generation`);
  }

  const session = await loadActiveVisualSessionContext({
    database: db,
    tenantId: tenantAlpha,
    conversationId,
  });
  assert.equal(session.active, true);
  assert.equal(session.productName, 'Nordic Oak Bed Frame');
});
test('TEST 3: Visual generation + "make it suitable for X" creates new visual using previous context', async () => {
  const db = createMockConversationDatabase({ tenantId: tenantAlpha, hasPreviousJob: true });

  const result = await resolveWhatsAppVisualRequestState({
    database: db,
    tenantId: tenantAlpha,
    conversationId,
    message: 'Make it suitable for my bed.',
    language: 'en',
  });

  assert.equal(result.state, 'READY_FOR_GENERATION', 'Must continue visual generation session');
  assert.equal(result.targetResourceId, customerTargetImageId, 'Must keep the customer uploaded room image');
  assert.equal(result.catalogRequested, true, 'Must preserve catalog grounding');
  assert.equal(result.previousEntityId, catalogEntityId, 'Must keep the same product');
  assert.equal(result.requireDifferentEntity, false);
});

test('TEST 3b: "Make it darker" modifies visual without asking for a new image upload', async () => {
  const db = createMockConversationDatabase({ tenantId: tenantAlpha, hasPreviousJob: true });

  const result = await resolveWhatsAppVisualRequestState({
    database: db,
    tenantId: tenantAlpha,
    conversationId,
    message: 'Make it darker.',
    language: 'en',
  });

  assert.equal(result.state, 'READY_FOR_GENERATION');
  assert.notEqual(result.state, 'WAITING_FOR_TARGET', 'Must not prompt user to re-upload image');
  assert.equal(result.targetResourceId, customerTargetImageId);
});

test('TEST 4: Image only requests clarification without hallucinating intent or services', () => {
  const planEn = planStandaloneWhatsAppMediaResponse({
    customerText: '',
    descriptor: { declaredMimeType: 'image/jpeg' },
    shouldInvokeAi: true,
    duplicate: false,
    language: 'en',
  });

  assert.equal(planEn.action, 'ACKNOWLEDGE');
  assert.equal(planEn.invokesModel, false);
  assert.match(planEn.message, /What would you like me to examine|help/i);

  const planTr = planStandaloneWhatsAppMediaResponse({
    customerText: '',
    descriptor: { declaredMimeType: 'image/jpeg' },
    shouldInvokeAi: true,
    duplicate: false,
    language: 'tr',
  });
  assert.equal(planTr.action, 'ACKNOWLEDGE');
  assert.match(planTr.message, /Görseliniz alındı/);
});

test('TEST 5: Image + unrelated text question prioritizes text intent', async () => {
  const standalonePlan = planStandaloneWhatsAppMediaResponse({
    customerText: 'How much is residency?',
    descriptor: { declaredMimeType: 'image/jpeg' },
    shouldInvokeAi: true,
    duplicate: false,
    language: 'en',
  });
  assert.equal(standalonePlan.action, 'CONTINUE', 'Text with media must continue to text/business processing');

  const classification = classifyVisualIntent({
    message: 'How much is residency?',
    hasTargetImage: true,
    hasReferenceImage: false,
  });

  assert.equal(classification.isVisualGeneration, false, 'Unrelated business text must not be classified as visual generation');
  assert.equal(classification.intent, 'GENERAL_CONVERSATION');
});

test('TEST 6: Behavior is strictly generic across different tenants and verticals', async () => {
  const verticals = [
    {
      tenantId: tenantAlpha,
      product: { id: 'prod-furniture-1', name: 'Velvet Sofa 3-Seater', type: 'FURNITURE', attributes: { price: '$1200' } },
    },
    {
      tenantId: tenantBeta,
      product: { id: 'prod-realestate-1', name: 'Marina Vista Penthouse', type: 'PROPERTY', attributes: { price: 'AED 3,500,000' } },
    },
    {
      tenantId: '33333333-4444-4333-8333-555555555555',
      product: { id: 'prod-fashion-1', name: 'Silk Evening Gown', type: 'APPAREL', attributes: { price: '€450' } },
    },
  ];

  for (const { tenantId, product } of verticals) {
    const db = createMockConversationDatabase({ tenantId, hasPreviousJob: true, previousProduct: product });

    // 1. Continuation edit
    const editResult = await resolveWhatsAppVisualRequestState({
      database: db,
      tenantId,
      conversationId,
      message: 'Make it fit my room better and change color',
      language: 'en',
    });
    assert.equal(editResult.state, 'READY_FOR_GENERATION');
    assert.equal(editResult.previousEntityId, product.id);

    // 2. Text inquiry during session
    const inquiryResult = await resolveWhatsAppVisualRequestState({
      database: db,
      tenantId,
      conversationId,
      message: 'What is the price?',
      language: 'en',
    });
    assert.equal(inquiryResult.state, 'NOT_VISUAL_GENERATION');

    // 3. Session loaded
    const session = await loadActiveVisualSessionContext({ database: db, tenantId, conversationId });
    assert.equal(session.productName, product.name);
    assert.equal(session.productId, product.id);
  }
});


      return { rows: [] };
    },
  };
}
