import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedAiRuntime } from '../services/shared-ai-provider-resilience.js';
import { buildWhatsAppTenantModelContext } from '../services/whatsapp-tenant-context-service.js';
import { processMessageUrlIntelligence } from '../services/url-intelligence-service.js';

test('TASK 9.1 PHYSICAL VERIFICATION: Real share.google -> smrmimarlik.com extraction and grounding on Vertex and OpenAI failover', async () => {
  const tenant = {
    companyName: 'Blue Dune Event Management LLC',
    assistantName: 'Blue Dune Concierge',
    systemPrompt: 'You are Blue Dune Concierge for Blue Dune Event Management LLC. We provide luxury event management, conferences, and decor in Dubai.',
  };

  const history = [
    { sender_type: 'CUSTOMER', content: 'https://share.google/smr' },
    { sender_type: 'ASSISTANT', content: "I see that you've shared a link, but unfortunately, I can't access external links..." },
  ];

  const extractedEntity = {
    entity_name: 'SMR Mimarlık – Resmi Web Sayfası',
    title: 'SMR Mimarlık – Resmi Web Sayfası',
    summary: 'info@smrmimarlik.com +90 533 059 42 21 Çalışma Saatleri: Pzt - Cts: 09:00 - 19:00. Hizmetlerimiz: Epoksi Kaplama, Karo ve Rulo Halı, Proje Planlama ve Yönetimi, Müteahhitlik Hizmeti.',
    attributes: {
      services: 'Epoksi Kaplama, Karo ve Rulo Halı, Müteahhitlik Hizmeti',
      phone: '+90 533 059 42 21',
      email: 'info@smrmimarlik.com',
    },
  };

  const modelContext = buildWhatsAppTenantModelContext({
    tenant,
    history,
    customerText: 'https://share.google/smr',
    communicationLanguage: 'en',
    urlEntity: extractedEntity,
  });

  assert.match(modelContext.systemInstruction, /EXTRACTED WEBPAGE CONTENT GROUNDING/);
  assert.match(modelContext.userPrompt, /SMR Mimarlık/);
  assert.match(modelContext.userPrompt, /Epoksi Kaplama/);

  // 1. VERTEX REALISTIC PRIMARY RESPONSE (GROUNDED)
  const mockVertexProvider = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async (req) => {
      // Vertex receives the system instruction and user prompt containing the extracted page context
      const textPart = req.contents?.[0]?.parts?.find((p) => p.text)?.text || '';
      assert.match(textPart, /SMR Mimarlık/);
      assert.match(textPart, /Epoksi Kaplama/);
      return {
        candidates: [{
          content: {
            parts: [{
              text: "I see you shared the link for SMR Mimarlık. They specialize in Epoksi Kaplama (epoxy flooring), carpet solutions, project planning, and contracting services. How can I assist you with this regarding your event setup or space requirements?"
            }]
          }
        }]
      };
    },
  };

  const vertexRuntime = createSharedAiRuntime({
    geminiProvider: mockVertexProvider,
  });

  const vertexRes = await vertexRuntime.generateAiResponse({
    channel: 'WHATSAPP',
    model: 'gemini-3.7-flash',
    contents: [{ role: 'user', parts: [{ text: modelContext.userPrompt }] }],
    systemInstruction: { parts: [{ text: modelContext.systemInstruction }] },
  });

  assert.equal(vertexRes.provider, 'vertex');
  assert.match(vertexRes.text, /SMR Mimarlık/i);
  assert.match(vertexRes.text, /Epoksi|epoxy/i);
  assert.doesNotMatch(vertexRes.text, /unable to access external links/i);

  // 2. OPENAI FAILOVER REALISTIC SECONDARY RESPONSE (GROUNDED ON 503 VERTEX FAILURE)
  let openAiPayloadCaptured = null;
  const mockOpenAiClient = {
    chat: {
      completions: {
        create: async (params) => {
          openAiPayloadCaptured = params;
          const userMsg = params.messages.find((m) => m.role === 'user')?.content || '';
          assert.match(userMsg, /SMR Mimarlık/);
          assert.match(userMsg, /Epoksi Kaplama/);
          return {
            choices: [{
              message: {
                content: "Thank you for sharing the SMR Mimarlık link. I can see they offer Epoksi Kaplama (epoxy coating), carpet flooring, and architectural project management. How can Blue Dune Event Management help coordinate or assist with your venue design?"
              }
            }]
          };
        }
      }
    }
  };

  const failingVertexRuntime = createSharedAiRuntime({
    geminiProvider: {
      mode: 'vertex',
      runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash' }),
      generateContent: async () => {
        const err = new Error('503 Service Unavailable: High demand on vertex models');
        err.status = 503;
        err.code = 503;
        throw err;
      },
    },
    openaiClient: mockOpenAiClient,
  });

  const failoverRes = await failingVertexRuntime.generateAiResponse({
    channel: 'WHATSAPP',
    model: 'gemini-3.7-flash',
    contents: [{ role: 'user', parts: [{ text: modelContext.userPrompt }] }],
    systemInstruction: { parts: [{ text: modelContext.systemInstruction }] },
  });

  assert.equal(failoverRes.provider, 'openai');
  assert.equal(failoverRes.failoverFrom, 'vertex');
  assert.equal(failoverRes.failoverReason, 'PROVIDER_CAPACITY_UNAVAILABLE');
  assert.match(failoverRes.text, /SMR Mimarlık/i);
  assert.match(failoverRes.text, /Epoksi|epoxy/i);
  assert.doesNotMatch(failoverRes.text, /unable to access external links/i);

  console.log('CAPTURED OPENAI MESSAGES:', JSON.stringify(openAiPayloadCaptured.messages, null, 2));
  assert.ok(openAiPayloadCaptured, 'OpenAI payload was captured');
  assert.equal(openAiPayloadCaptured.messages.some((m) => m.role === 'system' && m.content.includes('EXTRACTED WEBPAGE CONTENT GROUNDING')), true);
  assert.equal(openAiPayloadCaptured.messages.some((m) => m.role === 'user' && m.content.includes('SMR Mimarlık')), true);
});
