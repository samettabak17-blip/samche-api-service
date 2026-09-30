import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTenantRuntimeSystemInstruction,
  TENANT_FACTUAL_GROUNDING_POLICY,
} from '../services/tenant-runtime-persona-service.js';
import {
  createSharedAiRuntime,
} from '../services/shared-ai-provider-resilience.js';

function createTenantFixture({
  companyIdentity,
  assistantIdentity,
  knowledgeContext = '',
  policies = [],
  unsupportedClaims = [],
}) {
  return {
    available: true,
    companyIdentity,
    assistantIdentity,
    profileVersionId: '11111111-1111-4111-8111-111111111111',
    configurationVersionId: '22222222-2222-4222-8222-222222222222',
    profile: {
      schema_version: 2,
      company_identity: companyIdentity,
      company_display_name: companyIdentity,
      policies,
      unsupported_claims: unsupportedClaims,
    },
    configuration: {
      schema_version: 2,
      assistant_identity: assistantIdentity,
      role_and_purpose: `Corporate assistant for ${companyIdentity}`,
      fallback_guidance: 'State naturally that unconfirmed details must be confirmed with the team.',
      prohibited_claims: unsupportedClaims,
    },
    knowledgeContext,
  };
}

test('Test 1: Approved knowledge says OPTIONAL → AI cannot claim mandatory', () => {
  const tenantOptional = createTenantFixture({
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    knowledgeContext: `[Source: BAE Sağlık ve Sigorta Sistemi]
Dubai'de sağlık sigortası oturum izninin zorunlu bir parçası değil, isteğe bağlıdır ve özel sigorta şirketleri üzerinden yapılır.
Sponsorlu oturum paketlerine ve aile vizelerine sağlık sigortası dahil değildir.
Temel paketler yıllık yaklaşık 800 AED civarındadır.
Bu sigorta çalışma izni sağlamaz; sadece sağlık kapsamı içindir.`,
    policies: [
      'Sağlık sigortası sponsorlu oturum veya aile vizesi paketlerine dahil değildir; isteğe bağlıdır ve özel sigorta şirketleri üzerinden yıllık ~800 AED maliyetle yapılır.',
    ],
    unsupportedClaims: [
      'Sağlık sigortası Emirates ID veya oturum süreci için yasal bir zorunluluktur',
      'Sağlık sigortası sponsorlu oturum paketine dahildir',
    ],
  });

  const instruction = buildTenantRuntimeSystemInstruction({
    persona: tenantOptional,
    knowledgeContext: tenantOptional.knowledgeContext,
  });

  assert.match(instruction, /TENANT-SPECIFIC FACTUAL GROUNDING POLICY/);
  assert.match(instruction, /NO INVENTED LEGAL OR PROCEDURAL MANDATES/);
  assert.match(instruction, /MUST NEVER claim that a service, document, registration, fee, or insurance is legally mandatory/);
  assert.match(instruction, /sağlık sigortası oturum izninin zorunlu bir parçası değil, isteğe bağlıdır/);
  assert.match(instruction, /Sağlık sigortası Emirates ID veya oturum süreci için yasal bir zorunluluktur/);
});

test('Test 2: Different tenant knowledge says MANDATORY → AI follows that tenant knowledge', () => {
  const tenantMandatory = createTenantFixture({
    companyIdentity: 'Global Health Care FZE',
    assistantIdentity: 'Global Care Advisor',
    knowledgeContext: `[Source: Global Health Group Policy]
Özel sağlık sigortası poliçesi şirketimiz bünyesindeki tüm kurumsal programlar, stajyerler ve vize başvuruları için zorunludur.
Tüm başvuru sahipleri onaylı sağlık sigortası poliçesini ibraz etmekle yükümlüdür.`,
    policies: [
      'Sağlık sigortası kurumsal kayıt ve başvuru işlemleri için zorunlu yasal şarttır.',
    ],
  });

  const instruction = buildTenantRuntimeSystemInstruction({
    persona: tenantMandatory,
    knowledgeContext: tenantMandatory.knowledgeContext,
  });

  assert.match(instruction, /Global Health Care FZE/);
  assert.match(instruction, /Özel sağlık sigortası poliçesi şirketimiz bünyesindeki tüm kurumsal programlar.*için zorunludur/);
  assert.doesNotMatch(instruction, /SamChe Company LLC/);
});

test('Test 3: No approved information exists → AI says information unavailable, does not infer legal requirement', () => {
  const tenantNoKnowledge = createTenantFixture({
    companyIdentity: 'Aura Event Production LLC',
    assistantIdentity: 'Aura Concierge',
    knowledgeContext: '',
    policies: ['Etkinlik planlama ve sahne kiralama hizmetleri sunulur.'],
  });

  const instruction = buildTenantRuntimeSystemInstruction({
    persona: tenantNoKnowledge,
    knowledgeContext: '',
  });

  assert.match(instruction, /CURRENT APPROVED ASSISTANT KNOWLEDGE: No relevant approved result is available for this turn/);
  assert.match(instruction, /When eligible tenant authority does not contain a requested company-specific fact.*must state naturally that you do not have confirmed information/);
  assert.match(instruction, /NO INVENTED LEGAL OR PROCEDURAL MANDATES/);
});

test('Test 4: Vertex response preserves factual authority boundary', async () => {
  const tenant = createTenantFixture({
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    knowledgeContext: `[Source: BAE Sağlık ve Sigorta Sistemi]
Dubai'de sağlık sigortası oturum izninin zorunlu bir parçası değil, isteğe bağlıdır ve özel sigorta şirketleri üzerinden yapılır.`,
  });

  const instruction = buildTenantRuntimeSystemInstruction({
    persona: tenant,
    knowledgeContext: tenant.knowledgeContext,
  });

  let vertexSystemInstructionReceived = '';
  let vertexPromptReceived = '';

  const mockGemini = {
    generateContent: async ({ systemInstruction, contents }) => {
      vertexSystemInstructionReceived = systemInstruction?.parts?.[0]?.text || '';
      vertexPromptReceived = contents?.[0]?.parts?.[0]?.text || '';
      return {
        candidates: [{
          content: {
            parts: [{
              text: 'Dubai’de sağlık sigortası oturum izninin zorunlu bir parçası olmayıp isteğe bağlıdır ve özel sigorta şirketleri üzerinden temin edilir.',
            }],
          },
        }],
      };
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    env: { GEMINI_API_KEY: 'mock-key', OPENAI_API_KEY: 'mock-key' },
  });

  const result = await runtime.generateAiResponse({
    systemInstruction: instruction,
    text: 'Sağlık sigortası vize için zorunlu mu?',
    channel: 'INSTAGRAM',
  });

  assert.equal(result.provider, 'vertex');
  assert.ok(vertexSystemInstructionReceived.includes('NO INVENTED LEGAL OR PROCEDURAL MANDATES'));
  assert.ok(vertexSystemInstructionReceived.includes('isteğe bağlıdır'));
  assert.match(result.text, /isteğe bağlıdır/);
  assert.doesNotMatch(result.text, /yasal bir zorunluluktur/);
});

test('Test 5: OpenAI failover response preserves the exact same factual boundary', async () => {
  const tenant = createTenantFixture({
    companyIdentity: 'SamChe Company LLC',
    assistantIdentity: 'SamChe AI',
    knowledgeContext: `[Source: BAE Sağlık ve Sigorta Sistemi]
Dubai'de sağlık sigortası oturum izninin zorunlu bir parçası değil, isteğe bağlıdır ve özel sigorta şirketleri üzerinden yapılır.`,
  });

  const instruction = buildTenantRuntimeSystemInstruction({
    persona: tenant,
    knowledgeContext: tenant.knowledgeContext,
  });

  let openaiSystemInstructionReceived = '';
  let openaiPromptReceived = '';

  // Vertex throws transient 503 error -> triggers OpenAI failover
  const failingGemini = {
    generateContent: async () => {
      const err = new Error('Vertex 503 Service Unavailable');
      err.status = 503;
      throw err;
    },
  };

  const mockOpenAI = {
    chat: {
      completions: {
        create: async ({ messages }) => {
          const sysMsg = messages.find((m) => m.role === 'system');
          const userMsg = messages.find((m) => m.role === 'user');
          openaiSystemInstructionReceived = sysMsg?.content || '';
          openaiPromptReceived = userMsg?.content || '';
          return {
            choices: [{
              message: {
                content: 'Dubai’de sağlık sigortası oturum izninin zorunlu bir parçası değildir; isteğe bağlıdır ve özel sigorta şirketleri üzerinden yapılır.',
              },
            }],
          };
        },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: failingGemini,
    openaiClient: mockOpenAI,
    env: { GEMINI_API_KEY: 'mock-key', OPENAI_API_KEY: 'mock-key' },
  });

  const result = await runtime.generateAiResponse({
    systemInstruction: instruction,
    text: 'Sağlık sigortası vize için zorunlu mu?',
    channel: 'INSTAGRAM',
  });

  assert.equal(result.provider, 'openai');
  assert.equal(result.failoverFrom, 'vertex');
  assert.ok(openaiSystemInstructionReceived.includes('NO INVENTED LEGAL OR PROCEDURAL MANDATES'));
  assert.ok(openaiSystemInstructionReceived.includes('isteğe bağlıdır'));
  assert.match(result.text, /isteğe bağlıdır/);
  assert.doesNotMatch(result.text, /yasal bir zorunluluktur/);
});

