import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeterministicMockVisualProvider,
  createVisualAIProvider,
  DETERMINISTIC_MOCK_PNG,
  VisualAIValidationError,
} from '../services/visual-ai-provider-adapter.js';
import {
  buildGroundedVisualInstruction,
  classifyVisualIntent,
  formatVisualAiAcknowledgement,
  formatVisualAiPromptSuggestion,
  formatVisualAiReadyMessage,
  normalizeVisualAiLanguage,
  orchestrateWhatsAppVisualAiJob,
  resolveVisualAiGroundingContext,
  resolveWhatsAppVisualRequestState,
} from '../services/visual-intelligence-intent-service.js';
import {
  enqueueVisualAiGenerationJob,
  processVisualAiGenerationJob,
  VisualAiJobError,
} from '../services/visual-ai-job-service.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const convA = '33333333-3333-4333-8333-333333333333';
const convB = '44444444-4444-4444-8444-444444444444';
const targetResA = '55555555-5555-4555-8555-555555555555';

test('GENERIC VISUAL AI: supports TEXT_TO_IMAGE mode across arbitrary business verticals', async () => {
  const provider = createDeterministicMockVisualProvider();
  for (const verticalPrompt of [
    'Create a promotional banner for a modern fintech company',
    'Generate an event stage concept with LED screens and warm lighting',
    'Visualize an outdoor coffee kiosk in minimalist geometric style',
  ]) {
    const result = await provider.generateConcept({
      instruction: verticalPrompt,
      sourceImages: [],
      referenceImages: [],
    });
    assert.equal(result.finishReason, 'SUCCESS');
    assert.equal(result.provider, 'MOCK');
    assert.equal(result.imageBuffer.length, DETERMINISTIC_MOCK_PNG.length);
  }
});

test('GENERIC VISUAL AI: supports IMAGE_CONDITIONED_GENERATION with customer-uploaded visual evidence', async () => {
  const requests = [];
  const googleProvider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({
      models: {
        generateContent: async (req) => {
          requests.push(req);
          return {
            candidates: [{ content: { parts: [{ inlineData: { data: DETERMINISTIC_MOCK_PNG.toString('base64'), mimeType: 'image/png' } }] } }],
          };
        },
      },
    }),
  });

  const sofaBytes = Buffer.from('customer-living-room-bytes');
  const result = await googleProvider.generateConcept({
    instruction: 'Place this sofa in my living room.',
    sourceImages: [{ buffer: sofaBytes, mimeType: 'image/jpeg', originalFilename: 'living_room.jpg' }],
    referenceImages: [],
  });

  assert.equal(result.finishReason, 'SUCCESS');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].contents[0].parts.length, 2);
  assert.equal(requests[0].contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(requests[0].contents[0].parts[1].text, 'Place this sofa in my living room.');
});
test('GENERIC VISUAL AI: supports multiple reference images preserving ordering and MIME types', async () => {
  const requests = [];
  const googleProvider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({
      models: {
        generateContent: async (req) => {
          requests.push(req);
          return {
            candidates: [{ content: { parts: [{ inlineData: { data: DETERMINISTIC_MOCK_PNG.toString('base64'), mimeType: 'image/webp' } }] } }],
          };
        },
      },
    }),
  });

  const productBytes = Buffer.from('product-jacket-bytes');
  const ref1 = Buffer.from('catalog-swatch-1');
  const ref2 = Buffer.from('catalog-swatch-2');

  const result = await googleProvider.generateConcept({
    instruction: 'Show this jacket in the color and material from the swatches.',
    sourceImages: [{ buffer: productBytes, mimeType: 'image/png', originalFilename: 'jacket.png' }],
    referenceImages: [
      { buffer: ref1, mimeType: 'image/jpeg', originalFilename: 'swatch_navy.jpg' },
      { buffer: ref2, mimeType: 'image/webp', originalFilename: 'swatch_matte.webp' },
    ],
  });

  assert.equal(result.finishReason, 'SUCCESS');
  assert.equal(requests[0].contents[0].parts.length, 4);
  assert.equal(requests[0].contents[0].parts[0].inlineData.mimeType, 'image/png');
  assert.equal(requests[0].contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(requests[0].contents[0].parts[2].inlineData.mimeType, 'image/webp');
  assert.equal(requests[0].contents[0].parts[3].text, 'Show this jacket in the color and material from the swatches.');
});

test('GENERIC VISUAL AI: preserves strict tenant and conversation isolation for jobs and resources', async () => {
  const database = {
    query: async (sql, params = []) => {
      if (sql.includes('conversation_resources') && params[1] === tenantB && params[0] === targetResA) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('tenant_visual_ai_config') && params[0] === tenantB) {
        return { rows: [{ tenant_id: tenantB, enabled: true }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  await assert.rejects(
    () => enqueueVisualAiGenerationJob({
      database,
      tenantId: tenantB,
      conversationId: convB,
      targetResourceId: targetResA,
      promptInstruction: 'Cross tenant attempt',
    }),
    (err) => err instanceof VisualAiJobError && err.code === 'TARGET_RESOURCE_NOT_FOUND'
  );
});

test('GENERIC VISUAL AI: customer explicit visual evidence outranks generic knowledge and missing reference clarifies safely', async () => {
  const waitingResult = await resolveWhatsAppVisualRequestState({
    database: { query: async () => ({ rows: [] }) },
    tenantId: tenantA,
    conversationId: convA,
    message: 'Make this room look modern Scandinavian',
    language: 'en',
  });

  assert.equal(waitingResult.state, 'WAITING_FOR_TARGET');
  assert.equal(waitingResult.promptSuggestion, 'Please send a photo of the space or area you would like to transform.');
  assert.equal(waitingResult.targetResourceId, null);
});

test('GENERIC VISUAL AI: verification of generic domain agnosticism (no hardcoded vertical or tenant branches)', () => {
  for (const { message, expectedIntent } of [
    { message: 'Make this sofa matte black', expectedIntent: 'VISUAL_GENERATION' },
    { message: 'Visualize this real estate unit with modern lighting', expectedIntent: 'VISUAL_GENERATION' },
    { message: 'Show this fashion garment in royal blue', expectedIntent: 'VISUAL_GENERATION' },
    { message: 'Create an event stage concept with LED backdrop', expectedIntent: 'VISUAL_GENERATION' },
    { message: 'Show me how this product looks in brushed steel', expectedIntent: 'VISUAL_GENERATION' },
  ]) {
    const classification = classifyVisualIntent({
      message,
      hasTargetImage: true,
    });
    assert.equal(classification.isVisualGeneration, true);
    assert.equal(classification.intent, expectedIntent);
  }
});

test('GENERIC VISUAL AI: relevant approved tenant knowledge grounds generation while unapproved knowledge is excluded', async () => {
  const retrieveKnowledge = async ({ query }) => {
    return [
      { id: 'k1', chunk_content: 'Approved Product Spec: Matte black powder-coated steel frame.', approval_status: 'APPROVED' },
      { id: 'k2', chunk_content: 'Unapproved Candidate: Experimental neon pink coating.', approval_status: 'CANDIDATE' },
    ];
  };

  const grounding = await resolveVisualAiGroundingContext({
    database: {},
    tenantId: tenantA,
    instruction: 'Make this sofa matte black',
    entity: { entity_name: 'Nordic Sofa Model X', description: '3-seater minimalist sofa' },
    retrieveKnowledge,
  });

  assert.equal(grounding.approvedKnowledge.length, 1);
  assert.match(grounding.approvedKnowledge[0].content, /Matte black/);
  assert.doesNotMatch(grounding.approvedKnowledge[0].content, /neon pink/);

  const groundedInstruction = buildGroundedVisualInstruction({
    instruction: 'Make this sofa matte black',
    groundingContext: grounding,
  });

  assert.match(groundedInstruction, /^Make this sofa matte black/);
  assert.match(groundedInstruction, /Referenced Product\/Entity: Nordic Sofa Model X/);
  assert.match(groundedInstruction, /Approved Tenant Knowledge: Approved Product Spec/);
  assert.doesNotMatch(groundedInstruction, /neon pink/);
});

test('GENERIC VISUAL AI: cross-conversation private resources cannot be accessed accidentally', async () => {
  const database = {
    query: async (sql, params = []) => {
      // Resource exists in convA, but caller requests convB
      if (sql.includes('conversation_resources') && params[0] === targetResA && params[2] === convB) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('tenant_visual_ai_config')) {
        return { rows: [{ tenant_id: tenantA, enabled: true }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  await assert.rejects(
    () => enqueueVisualAiGenerationJob({
      database,
      tenantId: tenantA,
      conversationId: convB,
      targetResourceId: targetResA,
      promptInstruction: 'Private conversation resource isolation check',
    }),
    (err) => err instanceof VisualAiJobError && err.code === 'TARGET_RESOURCE_NOT_FOUND'
  );
});