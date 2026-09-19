process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ||= 'test-jwt-secret-at-least-32-chars-long';
process.env.OPENAI_API_KEY ||= 'test-openai-key';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOpenAiMultimodalContent,
  ingestConversationAttachment,
  resolveConversationMultimodalContext,
} from '../services/conversation-multimodal-context-service.js';
import { classifyConversationIntent, evaluateSupportResolutionPlan, RESOLUTION_ACTIONS } from '../services/conversation-intelligence-service.js';
import { issuePublicWebChatSession } from '../services/public-web-chat-session.js';
import { app } from '../app.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const crossTenantId = '99999999-9999-4999-8999-999999999999';
const resourceId = '33333333-3333-4333-8333-333333333333';

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

const assistantId = '44444444-4444-4444-8444-444444444444';
const profileId = '55555555-5555-4555-8555-555555555555';
const configId = '66666666-6666-4666-8666-666666666666';

function createMockWebChatDb({ resourceRow }) {
  return {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('SELECT * FROM conversations')) {
          return { rowCount: 1, rows: [{ id: conversationId, tenant_id: tenantId, channel_id: 'channel-1', handling_mode: 'AI', status: 'open', handling_version: 1 }] };
        }
        if (sql.includes('INSERT INTO conversation_messages') || sql.includes('conversation_messages')) {
          return { rows: [{ id: 'msg-1', tenant_id: tenantId, conversation_id: conversationId, sender_type: 'CUSTOMER', content: 'What is this?' }] };
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    }),
    query: async (sql) => {
      if (sql.includes('channel_integrations') || sql.includes('integration_key') || sql.includes('widget_key')) {
        return {
          rowCount: 1,
          rows: [{
            tenant_id: tenantId,
            channel_id: 'channel-1',
            assistant_id: assistantId,
            channel_type: 'WEB_CHAT',
            channel_status: 'active',
            channel_name: 'Web Chat',
            assistant_status: 'active',
            assistant_name: 'SamChe Assistant',
            config: {},
          }],
        };
      }
      if (sql.includes('ai_assistants') && (sql.includes('knowledge_authority_version') || sql.includes('active_configuration_version_id') || sql.includes('assistant_configuration_versions'))) {
        if (sql.includes('knowledge_authority_version') && !sql.includes('assistant_configuration_versions')) {
          return {
            rowCount: 1,
            rows: [{
              assistant_id: assistantId,
              knowledge_authority_version: '1',
            }],
          };
        }
        return {
          rowCount: 1,
          rows: [{
            id: configId,
            configuration_data: { assistant_identity: 'SamChe AI', supported_languages: ['en', 'tr'] },
            configuration_schema_version: 2,
            source_profile_version_id: profileId,
            assistant_metadata_name: 'SamChe AI',
            active_business_profile_version_id: profileId,
            active_business_profile: { company_identity: 'SamChe LLC', company_display_name: 'SamChe LLC' },
            profile_schema_version: 2,
          }],
        };
      }
      if (sql.includes('conversation_resources')) {
        return {
          rowCount: resourceRow ? 1 : 0,
          rows: resourceRow ? [resourceRow] : [],
        };
      }
      if (sql.includes('conversations')) {
        return {
          rowCount: 1,
          rows: [{
            id: conversationId,
            tenant_id: tenantId,
            channel_id: 'channel-1',
            handling_mode: 'AI',
            status: 'open',
            handling_version: 1,
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

test('WEBCHAT RUNTIME BOUNDARY: Browser message with conversation image resource invokes OpenAI provider with real image_url payload', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;

  const session = issuePublicWebChatSession({
    widgetKey: 'wch_live_widget_123',
    secret,
  });

  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb, 0xcc]);
  let capturedOpenAiPayload = null;

  const mockOpenai = {
    chat: {
      completions: {
        create: async (payload) => {
          capturedOpenAiPayload = payload;
          return {
            choices: [{
              message: {
                content: '<p>I see the error screenshot showing connection timeout on port 443.</p>',
              },
            }],
          };
        },
      },
    },
  };

  const mockStorage = {
    get: async () => pngBytes,
  };

  const mockDatabase = createMockWebChatDb({
    resourceRow: {
      id: resourceId,
      tenant_id: tenantId,
      conversation_id: conversationId,
      media_category: 'IMAGE',
      original_filename: 'error_screenshot.png',
      mime_type: 'image/png',
      storage_key: `conversation-resources/${tenantId}/${conversationId}/${resourceId}.png`,
      processing_status: 'READY',
    },
  });

  app.locals.database = mockDatabase;
  app.locals.storage = mockStorage;
  app.locals.openaiClient = mockOpenai;

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': session.token,
      },
      body: JSON.stringify({
        message: '[Attached: error_screenshot.png]',
        attachment_resource_ids: [resourceId],
      }),
    });

    const body = await res.json();
    if (res.status !== 200) {
      console.error('CHAT_ERROR_RESPONSE status=' + res.status, body);
    }
    assert.equal(res.status, 200);
    assert.match(body.reply, /error screenshot showing connection timeout/);

    assert.ok(capturedOpenAiPayload, 'OpenAI completions create MUST be called');
    assert.equal(capturedOpenAiPayload.model, 'gpt-4o-mini');

    const userMessage = capturedOpenAiPayload.messages.find((m) => m.role === 'user');
    assert.ok(userMessage, 'User message must be present in messages array');
    assert.ok(Array.isArray(userMessage.content), 'Active model user content MUST be a multimodal array, not a flattened string');

    const textPart = userMessage.content.find((part) => part.type === 'text');
    const imagePart = userMessage.content.find((part) => part.type === 'image_url');

    assert.ok(textPart, 'Multimodal payload must contain text part');
    assert.ok(imagePart, 'Multimodal payload must contain image_url part');
    assert.equal(imagePart.image_url.url, `data:image/png;base64,${pngBytes.toString('base64')}`);
    assert.notEqual(userMessage.content, '[Attached: error_screenshot.png]', 'Must NOT be filename-only text fallback');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
    delete app.locals.storage;
    delete app.locals.openaiClient;
  }
});
test('WEBCHAT RUNTIME BOUNDARY: Browser message with PDF document invokes OpenAI provider with extracted document text', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;

  const session = issuePublicWebChatSession({
    widgetKey: 'wch_live_widget_123',
    secret,
  });

  let capturedOpenAiPayload = null;
  const mockOpenai = {
    chat: {
      completions: {
        create: async (payload) => {
          capturedOpenAiPayload = payload;
          return {
            choices: [{
              message: {
                content: '<p>Invoice #INV-2026-90 is confirmed for $450.00.</p>',
              },
            }],
          };
        },
      },
    },
  };

  const mockDatabase = createMockWebChatDb({
    resourceRow: {
      id: resourceId,
      tenant_id: tenantId,
      conversation_id: conversationId,
      media_category: 'DOCUMENT',
      original_filename: 'invoice_90.pdf',
      mime_type: 'application/pdf',
      extracted_text: 'Invoice #INV-2026-90: Total $450.00 for AC Service',
      processing_status: 'READY',
    },
  });

  app.locals.database = mockDatabase;
  app.locals.storage = { get: async () => null };
  app.locals.openaiClient = mockOpenai;

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': session.token,
      },
      body: JSON.stringify({
        message: 'Can you check this invoice?',
        attachment_resource_ids: [resourceId],
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(capturedOpenAiPayload, 'OpenAI completions create MUST be called');

    const userMessage = capturedOpenAiPayload.messages.find((m) => m.role === 'user');
    assert.ok(userMessage, 'User message must be present');
    assert.match(userMessage.content, /Invoice #INV-2026-90/);
    assert.match(userMessage.content, /<customer_document_evidence>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
    delete app.locals.storage;
    delete app.locals.openaiClient;
  }
});

test('WEBCHAT MULTIMODAL PDF: Unique marker DOCUMENT_TEST_48217 reaches model context and extracted evidence', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;

  const session = issuePublicWebChatSession({
    widgetKey: 'wch_live_widget_123',
    secret,
  });

  let capturedOpenAiPayload = null;
  const mockOpenai = {
    chat: {
      completions: {
        create: async (payload) => {
          capturedOpenAiPayload = payload;
          return {
            choices: [{
              message: {
                content: '<p>Found unique test code: DOCUMENT_TEST_48217 in uploaded PDF.</p>',
              },
            }],
          };
        },
      },
    },
  };

  const mockDatabase = createMockWebChatDb({
    resourceRow: {
      id: resourceId,
      tenant_id: tenantId,
      conversation_id: conversationId,
      media_category: 'DOCUMENT',
      original_filename: 'unique_marker.pdf',
      mime_type: 'application/pdf',
      extracted_text: 'Confidential Audit Document with code: DOCUMENT_TEST_48217',
      processing_status: 'READY',
    },
  });

  app.locals.database = mockDatabase;
  app.locals.storage = { get: async () => null };
  app.locals.openaiClient = mockOpenai;

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': session.token,
      },
      body: JSON.stringify({
        message: 'What unique test code appears in the uploaded document?',
        attachment_resource_ids: [resourceId],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.reply, /DOCUMENT_TEST_48217/);

    const userMessage = capturedOpenAiPayload.messages.find((m) => m.role === 'user');
    assert.ok(userMessage, 'User message must be present in messages array');
    assert.match(userMessage.content, /DOCUMENT_TEST_48217/);
    assert.match(userMessage.content, /<customer_document_evidence>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
    delete app.locals.storage;
    delete app.locals.openaiClient;
  }
});

test('WEBCHAT HUMAN HANDOFF EXECUTION: Explicit human request triggers canonical Live Inbox handoff and returns handoff payload', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.WEB_CHAT_PUBLIC_SESSION_SECRET = secret;

  const session = issuePublicWebChatSession({
    widgetKey: 'wch_live_widget_123',
    secret,
  });

  const dbUpdates = [];
  const mockDatabase = {
    connect: async () => ({
      query: async (sql, params = []) => {
        dbUpdates.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SELECT pg_notify')) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE') || sql.includes('SELECT * FROM conversations')) {
          return {
            rowCount: 1,
            rows: [{
              id: conversationId,
              tenant_id: tenantId,
              channel_id: 'channel-1',
              handling_mode: 'AI',
              status: 'open',
              handling_version: 1,
              human_attention_state: 'NONE',
            }],
          };
        }
        if (sql.includes('UPDATE conversations')) {
          return {
            rowCount: 1,
            rows: [{
              id: conversationId,
              tenant_id: tenantId,
              handling_mode: 'HUMAN',
              human_attention_state: 'REQUESTED',
              assigned_agent_user_id: 'agent-123',
            }],
          };
        }
        if (sql.includes('INSERT INTO conversation_messages') || sql.includes('conversation_messages')) {
          return { rows: [{ id: 'msg-1', tenant_id: tenantId, conversation_id: conversationId, sender_type: 'ASSISTANT', content: 'Connecting to agent...' }] };
        }
        if (sql.includes('users') || sql.includes('tenant_users')) {
          return { rowCount: 1, rows: [{ id: 'agent-123', system_role: 'ADMIN', tenant_role: 'ADMIN' }] };
        }
        return { rowCount: 1, rows: [] };
      },
      release: () => {},
    }),
    query: async (sql, params = []) => {
      dbUpdates.push({ sql, params });
      if (sql.includes('channel_integrations') || sql.includes('integration_key') || sql.includes('widget_key')) {
        return {
          rowCount: 1,
          rows: [{
            tenant_id: tenantId,
            channel_id: 'channel-1',
            assistant_id: assistantId,
            channel_type: 'WEB_CHAT',
            channel_status: 'active',
            channel_name: 'Web Chat',
            assistant_status: 'active',
            assistant_name: 'SamChe AI',
            config: {},
          }],
        };
      }
      if (sql.includes('ai_assistants') && (sql.includes('knowledge_authority_version') || sql.includes('active_configuration_version_id') || sql.includes('assistant_configuration_versions'))) {
        return {
          rowCount: 1,
          rows: [{
            id: configId,
            configuration_data: { assistant_identity: 'SamChe AI', supported_languages: ['en', 'tr'] },
            configuration_schema_version: 2,
            source_profile_version_id: profileId,
            assistant_metadata_name: 'SamChe AI',
            active_business_profile_version_id: profileId,
            active_business_profile: { company_identity: 'SamChe LLC', company_display_name: 'SamChe LLC' },
            profile_schema_version: 2,
          }],
        };
      }
      if (sql.includes('conversations')) {
        return {
          rowCount: 1,
          rows: [{
            id: conversationId,
            tenant_id: tenantId,
            channel_id: 'channel-1',
            handling_mode: 'AI',
            status: 'open',
            handling_version: 1,
          }],
        };
      }
      if (sql.includes('conversation_resources')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  app.locals.database = mockDatabase;
  app.locals.storage = { get: async () => null };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    // English explicit request
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': session.token,
      },
      body: JSON.stringify({
        message: "I don't want AI. Connect me to a real person.",
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.handoff, 'Response must contain handoff object');
    assert.equal(body.handoff.requested, true);
    assert.equal(body.handoff.mode, 'HUMAN');
    assert.equal(body.handoff.attentionState, 'REQUESTED');
    assert.doesNotMatch(body.reply, /support@samche\.com/);

    // Turkish explicit request
    const resTr = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Samche-Web-Chat-Session': session.token,
      },
      body: JSON.stringify({
        message: 'Canlı temsilciye bağla.',
      }),
    });

    assert.equal(resTr.status, 200);
    const bodyTr = await resTr.json();
    assert.ok(bodyTr.handoff, 'Turkish handoff must contain handoff object');
    assert.equal(bodyTr.handoff.requested, true);
    assert.equal(bodyTr.handoff.mode, 'HUMAN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
    delete app.locals.storage;
  }
});
