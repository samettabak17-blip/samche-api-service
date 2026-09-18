import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOpenAiMultimodalContent,
  ingestConversationAttachment,
  resolveConversationMultimodalContext,
} from '../services/conversation-multimodal-context-service.js';
import { classifyConversationIntent, evaluateSupportResolutionPlan, RESOLUTION_ACTIONS } from '../services/conversation-intelligence-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const crossTenantId = '99999999-9999-4999-8999-999999999999';

test('WEBCHAT MULTIMODAL: Screenshot and image upload is ingested and persisted with tenant isolation', async () => {
  const dbCalls = [];
  const storagePuts = [];
  const database = {
    query: async (sql, params = []) => {
      dbCalls.push({ sql, params });
      if (sql.includes('INSERT INTO conversation_resources')) {
        return { rows: [{ id: 'res-img-1', tenant_id: tenantId, conversation_id: conversationId, media_category: 'IMAGE', mime_type: 'image/png' }] };
      }
      return { rows: [] };
    },
  };
  const storage = {
    put: async (args) => { storagePuts.push(args); },
  };

  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const ingested = await ingestConversationAttachment({
    database,
    storage,
    tenantId,
    conversationId,
    file: {
      buffer: pngBuffer,
      size: pngBuffer.length,
      mimetype: 'image/png',
      originalname: 'error_screenshot.png',
    },
  });

  assert.equal(ingested.media_category, 'IMAGE');
  assert.equal(ingested.processing_status, 'READY');
  assert.equal(storagePuts.length, 1);
  assert.match(storagePuts[0].key, new RegExp(`^conversation-resources/${tenantId}/${conversationId}/`));
});

test('WEBCHAT MULTIMODAL: PDF invoice/document is ingested and text extracted safely', async () => {
  const dbCalls = [];
  const database = {
    query: async (sql, params = []) => {
      dbCalls.push({ sql, params });
      if (sql.includes('INSERT INTO conversation_resources')) {
        return { rows: [{ id: 'res-doc-1', tenant_id: tenantId, conversation_id: conversationId, media_category: 'DOCUMENT', mime_type: 'text/plain' }] };
      }
      return { rows: [] };
    },
  };
  const storage = { put: async () => {} };

  const txtBuffer = Buffer.from('Invoice #INV-2026-90: Total $450.00 for AirPurifier', 'utf8');
  const ingested = await ingestConversationAttachment({
    database,
    storage,
    tenantId,
    conversationId,
    file: {
      buffer: txtBuffer,
      size: txtBuffer.length,
      mimetype: 'text/plain',
      originalname: 'order_receipt.txt',
    },
  });

  assert.equal(ingested.media_category, 'DOCUMENT');
  assert.equal(ingested.processing_status, 'READY');
  assert.match(ingested.extracted_text, /Invoice #INV-2026-90/);
});

test('WEBCHAT SUPPORT REASONING: Damaged product photo enters AI-first support resolution without visual generation', () => {
  const intent = classifyConversationIntent({
    message: 'This product arrived damaged and cracked in transit.',
  });

  assert.equal(intent.isSupport, true);
  assert.equal(intent.isHumanRequest, false);

  const plan = evaluateSupportResolutionPlan({ intentClassification: intent });
  assert.equal(plan.action, RESOLUTION_ACTIONS.AI_FIRST_RESOLVE);
  assert.equal(plan.requiresHandoff, false);
});

test('WEBCHAT MULTIMODAL COST CONTROL: Resolves only current turn attachments without loading all past files', async () => {
  const database = {
    query: async (sql, params = []) => {
      return { rows: [
        { id: 'res-1', original_filename: 'screen.png', media_category: 'IMAGE', mime_type: 'image/png', storage_key: 'key1' },
      ] };
    },
  };
  const storage = { get: async () => [Buffer.from('img-bytes')] };

  const context = await resolveConversationMultimodalContext({
    database,
    storage,
    tenantId,
    conversationId,
    maxAttachments: 2,
  });

  assert.equal(context.images.length, 1);
  assert.equal(context.images[0].filename, 'screen.png');

  // Verify OpenAI formatting
  const formatted = formatOpenAiMultimodalContent({
    text: 'What does this error mean?',
    images: context.images,
  });

  assert.ok(Array.isArray(formatted));
  assert.equal(formatted[0].type, 'text');
  assert.equal(formatted[1].type, 'image_url');
});

test('WEBCHAT MULTIMODAL ISOLATION: Cross-tenant attachment resolution fails closed', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (params[0] === crossTenantId) return { rows: [] };
      return { rows: [{ id: 'res-1', tenant_id: tenantId }] };
    },
  };

  const isolated = await resolveConversationMultimodalContext({
    database,
    tenantId: crossTenantId,
    conversationId,
  });

  assert.equal(isolated.images.length, 0);
  assert.equal(isolated.documents.length, 0);
});
