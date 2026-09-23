import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsAppVisualRequestState } from '../services/visual-intelligence-intent-service.js';
import * as visual from '../services/visual-intelligence-intent-service.js';
import { processVisualAiGenerationJob } from '../services/visual-ai-job-service.js';
import { processOneVisualAiGenerationJob } from '../services/visual-ai-generation-worker.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const customerTargetId = '33333333-3333-4333-8333-333333333333';
const generatedOutputId = '44444444-4444-4444-8444-444444444444';
const selectedEntityId = '55555555-5555-4555-8555-555555555555';
const alternativeEntityId = '66666666-6666-4666-8666-666666666666';
const selectedMediaId = '77777777-7777-4777-8777-777777777777';
const alternativeMediaId = '88888888-8888-4888-8888-888888888888';
const assistantId = '99999999-9999-4999-8999-999999999999';
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function catalogDatabase(entities) {
  return {
    async query(sql, params) {
      assert.match(sql, /e\.approval_status = 'APPROVED'/);
      assert.match(sql, /e\.is_runtime_eligible = TRUE/);
      assert.match(sql, /m\.approval_status = 'APPROVED'/);
      assert.match(sql, /m\.is_runtime_eligible = TRUE/);
      assert.equal(params[0], tenantId);
      return { rows: entities };
    },
  };
}

const catalogEntries = [
  { id: selectedEntityId, tenant_id: tenantId, name: 'Approved Item Alpha', description: 'Soft neutral finish', confidence: 0.98, approved_media: [{ id: selectedMediaId, mime_type: 'image/png', storage_key: `knowledge/${tenantId}/source/alpha.png` }] },
  { id: alternativeEntityId, tenant_id: tenantId, name: 'Approved Item Beta', description: 'Soft neutral finish', confidence: 0.96, approved_media: [{ id: alternativeMediaId, mime_type: 'image/png', storage_key: `knowledge/${tenantId}/source/beta.png` }] },
];

function conversationDatabase({ previousJob = null } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes("source_type = 'VISUAL_AI_GENERATED'")) {
        assert.equal(params[0], generatedOutputId);
        assert.equal(params[1], tenantId);
        assert.equal(params[2], conversationId);
        return { rows: [{ id: generatedOutputId }] };
      }
      assert.equal(params[0], tenantId);
      assert.equal(params[1], conversationId);
      if (sql.includes('visual_ai_generation_jobs')) {
        assert.match(sql, /status = 'COMPLETED'/);
        return { rows: previousJob ? [previousJob] : [] };
      }
      if (sql.includes('conversation_resources')) return {
        rows: [
          { id: generatedOutputId, source_type: 'VISUAL_AI_GENERATED', media_category: 'IMAGE', processing_status: 'READY' },
          { id: customerTargetId, source_type: 'WHATSAPP_MEDIA', media_category: 'IMAGE', processing_status: 'READY' },
        ],
      };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('catalog turn one retains the current customer target and requires approved catalog grounding', async () => {
  const result = await resolveWhatsAppVisualRequestState({
    database: conversationDatabase(), tenantId, conversationId,
    currentResourceIds: [customerTargetId],
    message: 'Redesign this using a suitable product from your catalog. Choose the product yourself and create a realistic visualization.',
  });
  assert.equal(result.state, 'READY_FOR_GENERATION');
  assert.equal(result.targetResourceId, customerTargetId);
  assert.equal(result.catalogRequested, true);
});

test('another catalog option continues from the durable prior job and excludes generated output as target', async () => {
  const result = await resolveWhatsAppVisualRequestState({
    database: conversationDatabase({ previousJob: {
      target_resource_id: customerTargetId,
      generated_resource_id: generatedOutputId,
      grounding_context: { catalog: { entityId: selectedEntityId } },
    } }),
    tenantId, conversationId,
    message: 'I like it. Now choose a different suitable product from your catalog and create another version.',
  });
  assert.equal(result.state, 'READY_FOR_GENERATION');
  assert.equal(result.targetResourceId, customerTargetId);
  assert.equal(result.catalogRequested, true);
  assert.equal(result.previousEntityId, selectedEntityId);
  assert.equal(result.requireDifferentEntity, true);
});

test('a non-catalog visual request keeps the ordinary generation path', async () => {
  const result = await resolveWhatsAppVisualRequestState({
    database: conversationDatabase(), tenantId, conversationId,
    currentResourceIds: [customerTargetId],
    message: 'Make this image brighter.',
  });
  assert.equal(result.state, 'READY_FOR_GENERATION');
  assert.equal(result.targetResourceId, customerTargetId);
  assert.equal(result.catalogRequested, false);
});

test('one approved runtime catalog item resolves with its approved media', async () => {
  const result = await visual.resolveVisualCatalogSelection({
    database: catalogDatabase([catalogEntries[0]]), tenantId,
    instruction: 'Choose a suitable product from your catalog and visualize it',
  });
  assert.equal(result.state, 'SELECTED');
  assert.equal(result.entity.id, selectedEntityId);
  assert.deepEqual(result.mediaIds, [selectedMediaId]);
});

test('another item excludes the previous approved entity and selects an alternative', async () => {
  const result = await visual.resolveVisualCatalogSelection({
    database: catalogDatabase(catalogEntries), tenantId,
    instruction: 'Choose a different product from your catalog',
    previousEntityId: selectedEntityId,
    requireDifferentEntity: true,
  });
  assert.equal(result.state, 'SELECTED');
  assert.equal(result.entity.id, alternativeEntityId);
  assert.deepEqual(result.mediaIds, [alternativeMediaId]);
});

test('style edit reuses the selected entity while an explicit catalog item can replace it', async () => {
  const database = catalogDatabase(catalogEntries);
  const edit = await visual.resolveVisualCatalogSelection({ database, tenantId,
    instruction: 'Make it darker', previousEntityId: selectedEntityId });
  assert.equal(edit.entity.id, selectedEntityId);
  const explicit = await visual.resolveVisualCatalogSelection({ database, tenantId,
    instruction: 'Use Approved Item Beta from your catalog', previousEntityId: selectedEntityId });
  assert.equal(explicit.entity.id, alternativeEntityId);
});

test('one approved item cannot be invented into a second item', async () => {
  const result = await visual.resolveVisualCatalogSelection({
    database: catalogDatabase([catalogEntries[0]]), tenantId,
    instruction: 'Choose another product from your catalog',
    previousEntityId: selectedEntityId,
    requireDifferentEntity: true,
  });
  assert.equal(result.state, 'NO_ALTERNATIVE');
});

test('no approved item fails closed before Visual AI enqueue', async () => {
  const result = await visual.resolveVisualCatalogSelection({
    database: catalogDatabase([]), tenantId,
    instruction: 'Choose a product from your catalog and visualize it',
  });
  assert.equal(result.state, 'NO_APPROVED_CATALOG');
});

function generationDatabase(entries) {
  const state = { job: null, inserted: 0 };
  return {
    state,
    async query(sql, params = []) {
      if (sql.includes('tenant_visual_ai_config')) return { rows: [{ enabled: true }] };
      if (sql.includes('FROM knowledge_entities e')) {
        assert.equal(params[0], tenantId);
        assert.equal(params[1], assistantId);
        return { rows: entries.filter((entry) => !params[3] || entry.id === params[3]) };
      }
      if (sql.includes('FROM conversation_resources') && params[0] === customerTargetId) {
        return { rowCount: 1, rows: [{ id: customerTargetId, source_type: 'WHATSAPP_MEDIA', media_category: 'IMAGE', processing_status: 'READY', storage_key: 'target', mime_type: 'image/jpeg' }] };
      }
      if (sql.includes('FROM conversation_resources') && params[0] === generatedOutputId) {
        return { rowCount: 1, rows: [{ id: generatedOutputId, source_type: 'VISUAL_AI_GENERATED', media_category: 'IMAGE', processing_status: 'READY', storage_key: 'generated', mime_type: 'image/png' }] };
      }
      if (sql.includes('FROM visual_ai_generation_jobs') && sql.includes('generated_resource_id')) {
        assert.equal(params[0], tenantId);
        assert.equal(params[1], conversationId);
        assert.equal(params[2], generatedOutputId);
        return { rows: [{ id: jobId, target_resource_id: customerTargetId, grounding_context: { originalCustomerTargetResourceId: customerTargetId } }] };
      }
      if (sql.includes('INSERT INTO visual_ai_generation_jobs')) {
        state.inserted++;
        state.job = { id: jobId, tenant_id: tenantId, conversation_id: conversationId, target_resource_id: params[3],
          reference_resource_id: null, prompt_instruction: params[6], grounding_context: JSON.parse(params[7]), status: 'PROCESSING' };
        return { rows: [state.job] };
      }
      if (sql.includes('INSERT INTO conversation_resources')) return { rows: [{ id: jobId, storage_key: 'output', mime_type: 'image/png' }] };
      if (sql.includes('UPDATE visual_ai_generation_jobs')) return { rows: [state.job] };
      throw new Error(`Unexpected SQL ${sql}`);
    },
  };
}

test('catalog Turn 1 persists selection and passes the actual target, entity, and approved media to the provider', async () => {
  const database = generationDatabase([catalogEntries[0]]);
  const queued = await visual.orchestrateWhatsAppVisualAiJob({
    database, tenantId, conversationId, targetResourceId: customerTargetId,
    promptInstruction: 'Visualize this using a suitable item from your catalog',
    catalogRequested: true, assistantId,
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(database.state.job.grounding_context.catalog.entityId, selectedEntityId);
  assert.deepEqual(database.state.job.grounding_context.catalog.mediaIds, [selectedMediaId]);
  assert.equal(database.state.job.grounding_context.resourceRoles.target, 'CUSTOMER_TARGET');
  let providerInput;
  const storage = {
    async get({ key }) { return Buffer.from(key === 'target' ? 'customer-target' : 'approved-reference'); },
    async put() {},
  };
  await processVisualAiGenerationJob({ database, storage, job: database.state.job,
    visualProvider: { async generateConcept(input) {
      providerInput = input;
      return { imageBuffer: Buffer.from('generated'), mimeType: 'image/png', provider: 'MOCK', model: 'mock' };
    } },
  });
  assert.equal(providerInput.targetImage.buffer.toString(), 'customer-target');
  assert.equal(providerInput.referenceImages[0].buffer.toString(), 'approved-reference');
  assert.equal(providerInput.referenceImages[0].entityId, selectedEntityId);
  assert.equal(providerInput.referenceImages[0].mediaId, selectedMediaId);
  assert.equal(providerInput.groundingContext.entity.id, selectedEntityId);
});

test('explicit catalog request with no approved item cannot enqueue or invoke generation', async () => {
  const database = generationDatabase([]);
  const result = await visual.orchestrateWhatsAppVisualAiJob({ database, tenantId, conversationId,
    targetResourceId: customerTargetId, promptInstruction: 'Visualize using your catalog',
    catalogRequested: true, assistantId,
  });
  assert.equal(result.status, 'CATALOG_UNRESOLVED');
  assert.equal(result.reason, 'NO_APPROVED_CATALOG');
  assert.equal(database.state.inserted, 0);
  assert.doesNotMatch(result.acknowledgmentText, /no catalog/i);
});

test('Business Profile cannot erase the approved catalog selection', async () => {
  const database = generationDatabase([catalogEntries[0]]);
  await visual.orchestrateWhatsAppVisualAiJob({ database, tenantId, conversationId,
    targetResourceId: customerTargetId, promptInstruction: 'Visualize using your catalog',
    catalogRequested: true, assistantId,
    groundingContext: { businessProfile: { description: 'We provide consulting services only.' } },
  });
  assert.equal(database.state.job.grounding_context.catalog.entityId, selectedEntityId);
  assert.equal(database.state.job.grounding_context.entity.id, selectedEntityId);
});

test('cross-tenant catalog rows cannot become a resolved selection', async () => {
  const database = catalogDatabase([{ ...catalogEntries[0], tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]);
  const result = await visual.resolveVisualCatalogSelection({ database, tenantId,
    instruction: 'Visualize using your catalog' });
  assert.equal(result.state, 'NO_APPROVED_CATALOG');
  const alienKey = { ...catalogEntries[0], approved_media: [{ ...catalogEntries[0].approved_media[0], storage_key: 'knowledge/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source/alien.png' }] };
  const isolated = await visual.resolveVisualCatalogSelection({ database: catalogDatabase([alienKey]), tenantId,
    instruction: 'Visualize using your catalog' });
  assert.equal(isolated.state, 'NO_APPROVED_CATALOG');
});

test('catalog fallback stays truthful in English, Turkish, and Arabic', () => {
  for (const language of ['en', 'tr', 'ar']) {
    const noAlternative = visual.formatVisualCatalogFallback(language, 'NO_ALTERNATIVE');
    const noCatalog = visual.formatVisualCatalogFallback(language, 'NO_APPROVED_CATALOG');
    assert.ok(noAlternative.length > 30);
    assert.ok(noCatalog.length > 30);
    assert.notEqual(noAlternative, noCatalog);
  }
});

test('HUMAN ownership cancels a pending visual continuation before the provider runs', async () => {
  let providerCalls = 0;
  let cancelled = false;
  const database = { async query(sql) {
    if (sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [{ id: jobId, tenant_id: tenantId, conversation_id: conversationId, status: 'PROCESSING' }] };
    if (sql.includes('SELECT status, handling_mode FROM conversations')) return { rowCount: 1, rows: [{ status: 'open', handling_mode: 'HUMAN' }] };
    if (sql.includes("SET status = 'CANCELLED'")) { cancelled = true; return { rows: [] }; }
    return { rows: [] };
  } };
  const result = await processOneVisualAiGenerationJob({ database, storage: null,
    visualProvider: { getCapabilities: () => ({ imageConditionedGeneration: true }), generateConcept: async () => { providerCalls++; } },
  });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(cancelled, true);
  assert.equal(providerCalls, 0);
});

test('Return AI uses the last completed catalog selection, never a cancelled autonomous job', async () => {
  const completed = { target_resource_id: customerTargetId, grounding_context: { catalog: { entityId: selectedEntityId } } };
  const resolved = await resolveWhatsAppVisualRequestState({
    database: conversationDatabase({ previousJob: completed }), tenantId, conversationId,
    message: 'Try another option',
  });
  assert.equal(resolved.state, 'READY_FOR_GENERATION');
  assert.equal(resolved.previousEntityId, selectedEntityId);
  assert.equal(resolved.targetResourceId, customerTargetId);
});

test('worker refuses generation if catalog approval is revoked after enqueue', async () => {
  const entries = [catalogEntries[0]];
  const database = generationDatabase(entries);
  const queued = await visual.orchestrateWhatsAppVisualAiJob({ database, tenantId, conversationId,
    targetResourceId: customerTargetId, promptInstruction: 'Visualize using your catalog',
    catalogRequested: true, assistantId,
  });
  assert.equal(queued.status, 'QUEUED');
  entries.length = 0;
  let calls = 0;
  await assert.rejects(() => processVisualAiGenerationJob({ database,
    storage: { get: async () => Buffer.from('image') }, job: database.state.job,
    visualProvider: { generateConcept: async () => { calls++; } },
  }), /Approved catalog reference is unavailable/);
  assert.equal(calls, 0);
});

test('same-conversation Turn 1 to Turn 2 selects an approved alternative while reusing the original target', async () => {
  const entries = [catalogEntries[0]];
  const database = generationDatabase(entries);
  const firstRequest = await resolveWhatsAppVisualRequestState({
    database: conversationDatabase(), tenantId, conversationId,
    currentResourceIds: [customerTargetId],
    message: 'Visualize this using a suitable product from your catalog',
  });
  const first = await visual.orchestrateWhatsAppVisualAiJob({ database, tenantId, conversationId,
    targetResourceId: firstRequest.targetResourceId, promptInstruction: firstRequest.promptInstruction,
    catalogRequested: firstRequest.catalogRequested, assistantId,
  });
  assert.equal(first.status, 'QUEUED');
  assert.equal(database.state.job.grounding_context.catalog.entityId, selectedEntityId);
  const completed = { target_resource_id: customerTargetId, generated_resource_id: generatedOutputId,
    grounding_context: database.state.job.grounding_context };
  entries.push(catalogEntries[1]);
  const secondRequest = await resolveWhatsAppVisualRequestState({
    database: conversationDatabase({ previousJob: completed }), tenantId, conversationId,
    message: 'Choose a different suitable product from your catalog and create another version',
  });
  const second = await visual.orchestrateWhatsAppVisualAiJob({ database, tenantId, conversationId,
    targetResourceId: secondRequest.targetResourceId, promptInstruction: secondRequest.promptInstruction,
    catalogRequested: secondRequest.catalogRequested, previousEntityId: secondRequest.previousEntityId,
    requireDifferentEntity: secondRequest.requireDifferentEntity, assistantId,
  });
  assert.equal(second.status, 'QUEUED');
  assert.equal(database.state.job.target_resource_id, customerTargetId);
  assert.equal(database.state.job.grounding_context.catalog.entityId, alternativeEntityId);
  assert.deepEqual(database.state.job.grounding_context.catalog.mediaIds, [alternativeMediaId]);
});

test('add another item intentionally edits the prior generated result with explicit provenance', async () => {
  const request = await resolveWhatsAppVisualRequestState({
    database: conversationDatabase({ previousJob: { target_resource_id: customerTargetId,
      generated_resource_id: generatedOutputId,
      grounding_context: { catalog: { entityId: selectedEntityId }, originalCustomerTargetResourceId: customerTargetId } } }),
    tenantId, conversationId, message: 'Add another matching item from your catalog',
  });
  assert.equal(request.targetResourceId, generatedOutputId);
  assert.equal(request.targetResourceRole, 'GENERATED_OUTPUT');
  assert.equal(request.originalCustomerTargetResourceId, customerTargetId);
  const database = generationDatabase(catalogEntries);
  const queued = await visual.orchestrateWhatsAppVisualAiJob({ database, tenantId, conversationId,
    targetResourceId: request.targetResourceId, promptInstruction: request.promptInstruction,
    catalogRequested: request.catalogRequested, previousEntityId: request.previousEntityId,
    requireDifferentEntity: request.requireDifferentEntity, assistantId,
    targetResourceRole: request.targetResourceRole,
    originalCustomerTargetResourceId: request.originalCustomerTargetResourceId,
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(database.state.job.target_resource_id, generatedOutputId);
  assert.equal(database.state.job.grounding_context.resourceRoles.target, 'GENERATED_OUTPUT');
  assert.equal(database.state.job.grounding_context.catalog.entityId, alternativeEntityId);
});

test('a recent generated image cannot silently become a new catalog target', async () => {
  const database = generationDatabase([catalogEntries[0]]);
  await assert.rejects(() => visual.orchestrateWhatsAppVisualAiJob({ database, tenantId, conversationId,
    targetResourceId: generatedOutputId, promptInstruction: 'Visualize using your catalog',
    catalogRequested: true, assistantId,
  }), (error) => error.code === 'CUSTOMER_TARGET_REQUIRED');
  assert.equal(database.state.inserted, 0);
});
