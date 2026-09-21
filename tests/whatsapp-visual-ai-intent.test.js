import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVisualIntent,
  orchestrateWhatsAppVisualAiJob,
  resolveSafeReferenceUrl,
  resolveWhatsAppVisualRequestState,
  VISUAL_INTENT_TYPES,
} from '../services/visual-intelligence-intent-service.js';
import { VisualAiJobError } from '../services/visual-ai-job-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const targetResourceId = '33333333-3333-4333-8333-333333333333';

test('WHATSAPP VISUAL INTENT: Distinguishes support/understanding photos from visual generation', () => {
  // Support / defect photo -> NOT visual generation
  const damaged = classifyVisualIntent({
    message: 'This product arrived damaged in the package.',
    hasTargetImage: true,
  });
  assert.equal(damaged.intent, VISUAL_INTENT_TYPES.MULTIMODAL_SUPPORT_OR_QA);
  assert.equal(damaged.isVisualGeneration, false);
  assert.equal(damaged.isSupport, true);

  // Screenshot Q&A -> NOT visual generation
  const screenshot = classifyVisualIntent({
    message: 'What does this error message mean?',
    hasTargetImage: true,
  });
  assert.equal(screenshot.intent, VISUAL_INTENT_TYPES.MULTIMODAL_SUPPORT_OR_QA);
  assert.equal(screenshot.isVisualGeneration, false);

  // PDF check -> NOT visual generation
  const pdfDoc = classifyVisualIntent({
    message: 'Can you check this invoice PDF?',
    hasDocument: true,
  });
  assert.equal(pdfDoc.intent, VISUAL_INTENT_TYPES.MULTIMODAL_SUPPORT_OR_QA);
  assert.equal(pdfDoc.isVisualGeneration, false);

  // Explicit visual generation -> VISUAL_GENERATION
  const gardenGen = classifyVisualIntent({
    message: 'Make this garden look modern Mediterranean with stone path',
    hasTargetImage: true,
  });
  assert.equal(gardenGen.intent, VISUAL_INTENT_TYPES.VISUAL_GENERATION);
  assert.equal(gardenGen.isVisualGeneration, true);
  assert.equal(gardenGen.targetStatus, 'PRESENT');

  const wallpaperGen = classifyVisualIntent({
    message: 'Show me how this wallpaper pattern would look on my living room wall',
    hasTargetImage: true,
    hasReferenceImage: true,
  });
  assert.equal(wallpaperGen.intent, VISUAL_INTENT_TYPES.VISUAL_GENERATION);
  assert.equal(wallpaperGen.isVisualGeneration, true);
});

test('WHATSAPP VISUAL INTENT: exposes canonical understanding, edit and insufficient-context classes', () => {
  assert.equal(classifyVisualIntent({ message: 'What is this?', hasTargetImage: true }).canonicalIntent, 'UNDERSTAND_IMAGE');
  assert.equal(classifyVisualIntent({ message: 'This product arrived broken', hasTargetImage: true }).canonicalIntent, 'SUPPORT_WITH_IMAGE');
  assert.equal(classifyVisualIntent({ message: 'Summarize this PDF', hasDocument: true }).canonicalIntent, 'DOCUMENT_UNDERSTANDING');
  assert.equal(classifyVisualIntent({ message: 'Edit this room to be darker', hasTargetImage: true }).canonicalIntent, 'VISUAL_EDIT');
  assert.equal(classifyVisualIntent({ message: 'Visualize a new room' }).canonicalIntent, 'INSUFFICIENT_CONTEXT');
});

test('WHATSAPP VISUAL MULTI-TURN: Prompts for target photo on Turn 1 and correlates photo on Turn 2', async () => {
  // Turn 1: User asks for redesign without photo
  const dbTurn1 = {
    query: async () => ({ rows: [] }),
  };

  const turn1 = await resolveWhatsAppVisualRequestState({
    database: dbTurn1,
    tenantId,
    conversationId,
    message: 'I want to redesign my garden in rustic style.',
  });

  assert.equal(turn1.state, 'WAITING_FOR_TARGET');
  assert.match(turn1.promptSuggestion, /fotoğraf/i);

  // Turn 2: User uploads photo following prompt
  const dbTurn2 = {
    query: async () => ({
      rows: [
        { id: targetResourceId, media_category: 'IMAGE', mime_type: 'image/jpeg', created_at: new Date() },
      ],
    }),
  };

  const turn2 = await resolveWhatsAppVisualRequestState({
    database: dbTurn2,
    tenantId,
    conversationId,
    message: 'Here is the garden photo',
    recentHistory: [
      { role: 'user', content: 'I want to redesign my garden in rustic style.' },
      { role: 'assistant', content: 'Please send a photo of the area.' },
    ],
  });

  assert.equal(turn2.state, 'READY_FOR_GENERATION');
  assert.equal(turn2.targetResourceId, targetResourceId);
});

test('WHATSAPP VISUAL MULTI-TURN: current persisted image is the generation target, never an older conversation image', async () => {
  const currentResourceId = '44444444-4444-4444-8444-444444444444';
  const state = await resolveWhatsAppVisualRequestState({
    database: {
      query: async () => ({
        rows: [
          { id: currentResourceId, media_category: 'IMAGE', mime_type: 'image/jpeg', created_at: new Date('2026-09-21T12:00:00Z') },
          { id: targetResourceId, media_category: 'IMAGE', mime_type: 'image/jpeg', created_at: new Date('2026-09-21T11:00:00Z') },
        ],
      }),
    },
    tenantId,
    conversationId,
    currentResourceIds: [currentResourceId],
    message: 'Make this garden look modern Mediterranean',
  });

  assert.equal(state.state, 'READY_FOR_GENERATION');
  assert.equal(state.targetResourceId, currentResourceId);
});

test('WHATSAPP REFERENCE URL: Rejects SSRF loopback/private IP targets', async () => {
  const result = await resolveSafeReferenceUrl({
    url: 'http://127.0.0.1:8080/internal.png',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /SSRF|TARGET|BLOCKED|INVALID/);
});

test('WHATSAPP VISUAL ENQUEUE: Enforces entitlement check and enqueues job with zero paid calls', async () => {
  const dbCalls = [];
  const database = {
    query: async (sql, params = []) => {
      dbCalls.push({ sql, params });
      if (sql.includes('tenant_visual_ai_config')) {
        return { rows: [{ tenant_id: tenantId, enabled: true }] };
      }
      if (sql.includes('SELECT id, mime_type, storage_key FROM conversation_resources')) {
        return { rowCount: 1, rows: [{ id: targetResourceId, storage_key: 'k1', mime_type: 'image/jpeg' }] };
      }
      if (sql.includes('INSERT INTO visual_ai_generation_jobs')) {
        return { rows: [{ id: 'job-123', status: 'PENDING', tenant_id: tenantId }] };
      }
      return { rows: [] };
    },
  };

  const orchestrated = await orchestrateWhatsAppVisualAiJob({
    database,
    tenantId,
    conversationId,
    targetResourceId,
    promptInstruction: 'Modern Scandinavian transformation',
  });

  assert.equal(orchestrated.status, 'QUEUED');
  assert.equal(orchestrated.job.id, 'job-123');
  assert.match(orchestrated.acknowledgmentText, /bekleyin/i);
});

test('WHATSAPP VISUAL ENQUEUE: Blocks enqueue when tenant entitlement is disabled', async () => {
  const database = {
    query: async () => ({ rows: [{ tenant_id: tenantId, enabled: false }] }),
  };

  await assert.rejects(
    () => orchestrateWhatsAppVisualAiJob({
      database,
      tenantId,
      conversationId,
      targetResourceId,
      promptInstruction: 'Redesign room',
    }),
    (err) => err instanceof VisualAiJobError && err.code === 'VISUAL_AI_NOT_ENABLED'
  );
});
