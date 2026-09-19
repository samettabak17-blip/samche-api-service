import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGeminiMultimodalParts,
  resolveConversationMultimodalContext,
} from '../services/conversation-multimodal-context-service.js';
import { issuePublicConversationSession } from '../services/public-conversation-session.js';
import { app } from '../app.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const resourceId = '33333333-3333-4333-8333-333333333333';
const assistantId = '44444444-4444-4444-8444-444444444444';
const profileId = '55555555-5555-4555-8555-555555555555';
const configId = '66666666-6666-4666-8666-666666666666';
const domainId = '77777777-7777-4777-8777-777777777777';
const expVersionId = '88888888-8888-4888-8888-888888888888';

function createMockGuideDb({ resourceRow }) {
  const queryHandler = async (sql, params = []) => {
    // console.log('GUIDE_DB_QUERY:', sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SELECT pg_notify')) {
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('knowledge_authority_version') || (sql.includes('ai_assistants') && !sql.includes('guide_domains'))) {
      if (sql.includes('assistant_configuration_versions') || sql.includes('active_configuration_version_id') || sql.includes('configuration_data')) {
        return {
          rowCount: 1,
          rows: [{
            id: configId,
            configuration_data: { assistant_identity: 'SamChe AI Guide', supported_languages: ['en', 'tr'] },
            configuration_schema_version: 2,
            source_profile_version_id: profileId,
            assistant_metadata_name: 'SamChe AI Guide',
            active_business_profile_version_id: profileId,
            active_business_profile: { company_identity: 'SamChe LLC', company_display_name: 'SamChe LLC' },
            profile_schema_version: 2,
          }],
        };
      }
      return {
        rowCount: 1,
        rows: [{
          assistant_id: assistantId,
          knowledge_authority_version: '1',
        }],
      };
    }
    if (sql.includes('guide_domains') || sql.includes('tenant_domains')) {
      return {
        rowCount: 1,
        rows: [{
          domain_id: domainId,
          tenant_id: tenantId,
          assistant_id: assistantId,
          channel_id: 'channel-guide-1',
          channel_assistant_id: assistantId,
          channel_type: 'SAMCHEGUIDE',
          channel_status: 'active',
          assistant_status: 'active',
          integration_enabled: true,
          hostname: 'guide.example.com',
          status: 'ACTIVE',
        }],
      };
    }
    if (sql.includes('tenant_channels') || sql.includes('channel_integrations')) {
      return {
        rowCount: 1,
        rows: [{
          id: 'channel-guide-1',
          channel_id: 'channel-guide-1',
          tenant_id: tenantId,
          assistant_id: assistantId,
          channel_type: 'SAMCHEGUIDE',
          channel_status: 'active',
          assistant_status: 'active',
          integration_enabled: true,
          status: 'active',
          domain_id: domainId,
        }],
      };
    }
    if (sql.includes('guide_experience_versions')) {
      return {
        rowCount: 1,
        rows: [{
          id: expVersionId,
          tenant_id: tenantId,
          assistant_id: assistantId,
          version: 1,
          status: 'PUBLISHED',
          experience: {
            version: 1,
            title: 'AI Guide',
            roadmap: {
              enabled: true,
              title: 'Your roadmap',
              description: 'Share details',
              steps: [{ id: 'goal', label: 'Goal', description: '', input_type: 'TEXT', required: true, options: [], min: null, max: null, unit: '' }],
            },
          },
        }],
      };
    }
    if (sql.includes('guide_session_resumes') || sql.includes('guide_session') || sql.includes('guide_public_sessions')) {
      return {
        rowCount: 1,
        rows: [{
          session_id: conversationId,
          experience_version: 1,
          experience_version_id: expVersionId,
          preview_mode: false,
          expires_at: new Date(Date.now() + 86400000),
        }],
      };
    }
    if (sql.includes('knowledge_authority_version') || sql.includes('ai_assistants')) {
      if (sql.includes('assistant_configuration_versions') || sql.includes('active_configuration_version_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: configId,
            configuration_data: { assistant_identity: 'SamChe AI Guide', supported_languages: ['en', 'tr'] },
            configuration_schema_version: 2,
            source_profile_version_id: profileId,
            assistant_metadata_name: 'SamChe AI Guide',
            active_business_profile_version_id: profileId,
            active_business_profile: { company_identity: 'SamChe LLC', company_display_name: 'SamChe LLC' },
            profile_schema_version: 2,
          }],
        };
      }
      return {
        rowCount: 1,
        rows: [{
          assistant_id: assistantId,
          knowledge_authority_version: '1',
        }],
      };
    }
    if (sql.includes('conversation_resources')) {
      return {
        rowCount: resourceRow ? 1 : 0,
        rows: resourceRow ? [resourceRow] : [],
      };
    }
    if (sql.includes('INSERT INTO conversation_messages') || sql.includes('conversation_messages')) {
      const isAssistant = params?.[2] === 'ASSISTANT' || sql.includes("'ASSISTANT'");
      const isPdfSpec = Boolean(resourceRow?.extracted_text);
      const assistantText = isPdfSpec
        ? 'Extracted from PDF: 4 nodes required for high availability.'
        : 'Observed in uploaded image: Architecture diagram with 3 microservices.';
      const msgContent = params?.[3]
        || (isAssistant ? assistantText : 'What is this diagram?');
      return {
        rowCount: 1,
        rows: [{
          id: isAssistant ? 'msg-guide-ai-1' : 'msg-guide-1',
          tenant_id: tenantId,
          conversation_id: conversationId,
          sender_type: isAssistant ? 'ASSISTANT' : 'CUSTOMER',
          content: msgContent,
          authority_assistant_id: assistantId,
          knowledge_authority_version: '1',
        }],
      };
    }
    if (sql.includes('conversations')) {
      return {
        rowCount: 1,
        rows: [{
          id: conversationId,
          tenant_id: tenantId,
          channel_id: 'channel-guide-1',
          customer_external_id: 'cust-123',
          handling_mode: 'AI',
          status: 'open',
          handling_version: 1,
        }],
      };
    }
    if (sql.includes('crm_contacts') || sql.includes('crm_leads') || sql.includes('crm_activities')) {
      return { rowCount: 1, rows: [{ id: 'crm-1', tenant_id: tenantId }] };
    }
    return { rowCount: 0, rows: [] };
  };

  return {
    connect: async () => ({
      query: queryHandler,
      release: () => {},
    }),
    query: queryHandler,
  };
}

test('AI GUIDE MULTIMODAL: Formats Gemini parts for image and document grounded answering', async () => {
  const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const parts = formatGeminiMultimodalParts({
    text: 'Explain this design diagram in terms of the tenant roadmap.',
    images: [{ mimeType: 'image/png', buffer: fakePng }],
    documentContext: '<customer_document_evidence>Requirements for Project Alpha</customer_document_evidence>',
  });

  assert.equal(parts.length, 2);
  assert.match(parts[0].text, /Requirements for Project Alpha/);
  assert.match(parts[0].text, /Explain this design diagram/);
  assert.ok(parts[1].inline_data);
  assert.equal(parts[1].inline_data.mime_type, 'image/png');
  assert.equal(parts[1].inline_data.data, fakePng.toString('base64'));
});

test('AI GUIDE MULTIMODAL: Does NOT expose or trigger visual AI generation', async () => {
  const database = {
    query: async () => ({
      rows: [
        { id: 'doc-1', original_filename: 'spec.txt', media_category: 'DOCUMENT', extracted_text: 'Specs' },
      ],
    }),
  };

  const context = await resolveConversationMultimodalContext({
    database,
    tenantId,
    conversationId,
  });

  assert.equal(context.documents.length, 1);
  // Assert no generation job or generation path is triggered
  assert.equal(context.promptSection.includes('VISUAL_AI_GENERATED'), false);
});
test('GUIDE RUNTIME BOUNDARY: Guide message with conversation image resource invokes Gemini provider with real image part', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.SAMCHEGUIDE_PUBLIC_SESSION_SECRET = secret;

  const session = issuePublicConversationSession({
    secret,
    scope: {
      domainId,
      tenantId,
      assistantId,
      channelId: 'channel-guide-1',
    },
  });

  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22, 0x33]);
  let capturedGeminiPayload = null;

  const mockGemini = {
    mode: 'developer',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'developer', model: 'gemini-3-flash-preview' }),
    generateContent: async (payload) => {
      capturedGeminiPayload = payload;
      const userMsg = payload.contents?.find((m) => m.role === 'user');
      const hasImage = userMsg?.parts?.some((p) => p.inlineData?.data === pngBytes.toString('base64') || p.inline_data?.data === pngBytes.toString('base64'));
      if (hasImage) {
        return {
          candidates: [{
            content: {
              parts: [{
                text: '<p>Observed in uploaded image: Architecture diagram with 3 microservices.</p>',
              }],
            },
          }],
        };
      }
      return {
        candidates: [{
          content: {
            parts: [{
              text: '<p>Blue Dune Event Management LLC corporate profile overview.</p>',
            }],
          },
        }],
      };
    },
  };

  const mockStorage = {
    get: async () => pngBytes,
  };

  const mockDatabase = createMockGuideDb({
    resourceRow: {
      id: resourceId,
      tenant_id: tenantId,
      conversation_id: conversationId,
      media_category: 'IMAGE',
      original_filename: 'arch_diagram.png',
      mime_type: 'image/png',
      storage_key: `conversation-resources/${tenantId}/${conversationId}/${resourceId}.png`,
      processing_status: 'READY',
    },
  });

  app.locals.database = mockDatabase;
  app.locals.storage = mockStorage;
  app.locals.googleGeminiProvider = mockGemini;

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: 'POST',
      headers: {
        'Host': 'guide.example.com',
        'Content-Type': 'application/json',
        'X-Samcheguide-Session': session.token,
      },
      body: JSON.stringify({
        text: '[Attached: arch_diagram.png]',
        guide_module: 'AI_ASSISTANT',
        attachment_resource_ids: [resourceId],
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.candidates), 'Guide response must contain candidates array');
    assert.match(body.candidates[0].content.parts[0].text, /Architecture diagram with 3 microservices/);
    assert.doesNotMatch(body.candidates[0].content.parts[0].text, /Blue Dune Event Management/);

    assert.ok(capturedGeminiPayload, 'Gemini provider generateContent MUST be called');

    const userMessage = capturedGeminiPayload.contents.find((m) => m.role === 'user');
    assert.ok(userMessage, 'User message must be present in Gemini contents');
    assert.ok(Array.isArray(userMessage.parts), 'User message parts must be an array');

    const imagePart = userMessage.parts.find((p) => p.inlineData || p.inline_data);
    assert.ok(imagePart, 'Gemini contents MUST receive multimodal image part, not text-only');
    const inline = imagePart.inlineData || imagePart.inline_data;
    assert.equal(inline.mimeType || inline.mime_type, 'image/png');
    assert.equal(inline.data, pngBytes.toString('base64'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
    delete app.locals.storage;
    delete app.locals.googleGeminiProvider;
  }
});

test('GUIDE RUNTIME BOUNDARY: Guide message with PDF document invokes Gemini provider with extracted document text', async () => {
  const secret = 'test-secret-at-least-32-chars-long-12345';
  process.env.SAMCHEGUIDE_PUBLIC_SESSION_SECRET = secret;

  const session = issuePublicConversationSession({
    secret,
    scope: {
      domainId,
      tenantId,
      assistantId,
      channelId: 'channel-guide-1',
    },
  });

  let capturedGeminiPayload = null;
  const mockGemini = {
    mode: 'developer',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'developer', model: 'gemini-3-flash-preview' }),
    generateContent: async (payload) => {
      capturedGeminiPayload = payload;
      const userMsg = payload.contents?.find((m) => m.role === 'user');
      const hasPdfText = userMsg?.parts?.some((p) => typeof p.text === 'string' && p.text.includes('Project Alpha Spec: 4 nodes'));
      if (hasPdfText) {
        return {
          candidates: [{
            content: {
              parts: [{
                text: '<p>Extracted from PDF: 4 nodes required for high availability.</p>',
              }],
            },
          }],
        };
      }
      return {
        candidates: [{
          content: {
            parts: [{
              text: '<p>Generic Blue Dune Event Management overview.</p>',
            }],
          },
        }],
      };
    },
  };

  const mockDatabase = createMockGuideDb({
    resourceRow: {
      id: resourceId,
      tenant_id: tenantId,
      conversation_id: conversationId,
      media_category: 'DOCUMENT',
      original_filename: 'specs.pdf',
      mime_type: 'application/pdf',
      extracted_text: 'Project Alpha Spec: 4 nodes required for high availability',
      processing_status: 'READY',
    },
  });

  app.locals.database = mockDatabase;
  app.locals.storage = { get: async () => null };
  app.locals.googleGeminiProvider = mockGemini;

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: 'POST',
      headers: {
        'Host': 'guide.example.com',
        'Content-Type': 'application/json',
        'X-Samcheguide-Session': session.token,
      },
      body: JSON.stringify({
        text: 'What are the specs?',
        guide_module: 'AI_ASSISTANT',
        attachment_resource_ids: [resourceId],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.candidates), 'Guide response must contain candidates array');
    assert.match(body.candidates[0].content.parts[0].text, /Extracted from PDF: 4 nodes/);
    assert.doesNotMatch(body.candidates[0].content.parts[0].text, /Generic Blue Dune/);

    assert.ok(capturedGeminiPayload, 'Gemini provider generateContent MUST be called');

    const userMessage = capturedGeminiPayload.contents.find((m) => m.role === 'user');
    assert.ok(userMessage, 'User message must be present in Gemini contents');
    const textPart = userMessage.parts.find((p) => typeof p.text === 'string');
    assert.ok(textPart, 'User message must have text part with extracted document context');
    assert.match(textPart.text, /Project Alpha Spec/);
    assert.match(textPart.text, /<customer_document_evidence>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete app.locals.database;
    delete app.locals.storage;
    delete app.locals.googleGeminiProvider;
  }
});
