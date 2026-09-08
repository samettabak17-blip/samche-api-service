import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantRuntimeSystemInstruction, TENANT_FACTUAL_GROUNDING_POLICY } from '../services/tenant-runtime-persona-service.js';
import { buildWhatsAppActivePersonaTenantContext } from '../services/whatsapp-tenant-context-service.js';

function fixturePersona(overrides = {}) {
  return {
    available: true,
    companyIdentity: 'Verdant Landscapes LLC',
    assistantIdentity: 'Verdant Client Advisor',
    profileVersionId: '11111111-1111-4111-8111-111111111111',
    configurationVersionId: '22222222-2222-4222-8222-222222222222',
    profile: {
      schema_version: 2,
      company_identity: 'Verdant Landscapes LLC',
      company_display_name: 'Verdant Landscapes LLC',
      services: ['Landscape architectural design', 'Automatic irrigation installation'],
      pricing_information: ['Consultation: 350 AED', 'Terrace garden packages from 4,500 AED'],
      policies: ['Standard 30-day workmanship check for completed installations'],
      ...overrides.profile,
    },
    configuration: {
      schema_version: 2,
      assistant_identity: 'Verdant Client Advisor',
      role_and_purpose: 'Assist prospective clients with landscaping consultations and planning',
      fallback_guidance: 'State naturally that unconfirmed details must be confirmed with the team.',
      ...overrides.configuration,
    },
    ...overrides,
  };
}

test('Workstream A - Contract H: Provider contract - shared grounding policy is embedded in runtime instructions for all channels', () => {
  const persona = fixturePersona();
  
  // AI Guide / General channel instruction
  const guideInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Irrigation systems designed per plot specifications.',
    channelRules: 'Return safe, readable HTML suitable for the AI Guide interface.',
  });
  assert.ok(guideInstruction.includes(TENANT_FACTUAL_GROUNDING_POLICY));
  assert.match(guideInstruction, /TENANT-SPECIFIC FACTUAL GROUNDING POLICY/);
  assert.match(guideInstruction, /CANONICAL TENANT AUTHORITY/);
  assert.match(guideInstruction, /GENERAL WORLD KNOWLEDGE vs TENANT FACTS/);
  assert.match(guideInstruction, /UNKNOWN OR UNSUPPORTED TENANT FACTS/);
  assert.match(guideInstruction, /VISITOR-FACING NATURAL TONE/);

  // Web Chat instruction
  const webChatInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Irrigation systems designed per plot specifications.',
    channelRules: 'Return safe HTML suitable for Web Chat. Do not reveal internal metadata.',
  });
  assert.ok(webChatInstruction.includes(TENANT_FACTUAL_GROUNDING_POLICY));

  // WhatsApp context
  const wpContext = buildWhatsAppActivePersonaTenantContext({
    persona,
    knowledgeContext: 'Irrigation systems designed per plot specifications.',
    communicationLanguage: 'en',
  });
  assert.ok(wpContext.systemPrompt.includes(TENANT_FACTUAL_GROUNDING_POLICY));
});

test('Workstream A - Contract A: Known tenant fact is present in approved tenant authority', () => {
  const persona = fixturePersona();
  const instruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Approved service scope: Automatic irrigation installation is offered for residential villas.',
  });
  assert.match(instruction, /Automatic irrigation installation/);
  assert.match(instruction, /Automatic irrigation installation is offered for residential villas/);
});

test('Workstream A - Contract B: Unknown brand/model - instructions strictly prohibit inventing brands not in tenant authority', () => {
  const persona = fixturePersona();
  const instruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Approved service scope: Automatic irrigation installation is offered for residential villas.',
  });
  
  assert.doesNotMatch(instruction, /Hunter|Rain Bird|Toro|Weathermatic/i);
  assert.match(instruction, /When eligible tenant authority does not contain a requested company-specific fact/);
  assert.match(instruction, /Never invent, guess, speculate, or endorse unverified brands, models, or numbers/);
});

test('Workstream A - Contract C: General knowledge boundary is strictly maintained without attributing to tenant', () => {
  const persona = fixturePersona();
  const instruction = buildTenantRuntimeSystemInstruction({ persona });
  assert.match(instruction, /You may use general world knowledge ONLY for reasoning, explaining generic industry concepts, or general educational information/);
  assert.match(instruction, /You MUST NEVER transform general world knowledge, popular industry brands, typical equipment, or standard assumptions into factual statements about this tenant/);
  assert.match(instruction, /Generic domain knowledge does NOT equal a tenant fact/);
});

test('Workstream A - Contract D: Unknown exact price for an unsupported scope requires confirmation', () => {
  const persona = fixturePersona();
  const instruction = buildTenantRuntimeSystemInstruction({ persona });
  assert.match(instruction, /Terrace garden packages from 4,500 AED/);
  assert.doesNotMatch(instruction, /500\s*m²/);
  assert.match(instruction, /exact price for an unsupported scope.*must state naturally that you do not have confirmed information/);
});

test('Workstream A - Contract E: Known price explicitly in tenant authority may be stated with qualification', () => {
  const persona = fixturePersona({
    profile: {
      pricing_information: ['Consultation: 350 AED', 'Terrace garden packages from 4,500 AED', '500 m² irrigation estimate starts at 12,000 AED subject to site survey'],
    },
  });
  const instruction = buildTenantRuntimeSystemInstruction({ persona });
  assert.match(instruction, /500 m² irrigation estimate starts at 12,000 AED subject to site survey/);
});

test('Workstream A - Contract F: Unsupported policy/warranty/certification must not be invented', () => {
  const persona = fixturePersona();
  const instruction = buildTenantRuntimeSystemInstruction({ persona });
  assert.match(instruction, /Standard 30-day workmanship check/);
  assert.doesNotMatch(instruction, /10-year|lifetime guarantee|ISO\s*9001/i);
  assert.match(instruction, /warranties\/guarantees, certifications.*MUST be strictly grounded/);
});

test('Workstream A - Contract G: Adversarial user asking assistant to guess must not cause speculation', () => {
  const persona = fixturePersona();
  const instruction = buildTenantRuntimeSystemInstruction({ persona });
  assert.match(instruction, /even if the user explicitly asks you to guess or speculate/);
});

test('Workstream A - Contract I: Strict tenant isolation - Tenant A facts never leak into Tenant B system instructions', () => {
  const tenantAPersona = fixturePersona({
    companyIdentity: 'Verdant Landscapes LLC',
    assistantIdentity: 'Verdant Advisor',
    profile: {
      company_identity: 'Verdant Landscapes LLC',
      company_display_name: 'Verdant Landscapes LLC',
      services: ['Drip irrigation'],
      pricing_information: ['3,200 AED package'],
    },
    configuration: {
      assistant_identity: 'Verdant Advisor',
      role_and_purpose: 'Landscape advice',
    },
  });

  const tenantBPersona = fixturePersona({
    companyIdentity: 'Aura Event Production LLC',
    assistantIdentity: 'Aura Concierge',
    profile: {
      company_identity: 'Aura Event Production LLC',
      company_display_name: 'Aura Event Production LLC',
      services: ['Stage lighting and sound'],
      pricing_information: ['Event staging from 48,000 AED'],
    },
    configuration: {
      assistant_identity: 'Aura Concierge',
      role_and_purpose: 'Event staging advice',
    },
  });

  const instructionA = buildTenantRuntimeSystemInstruction({
    persona: tenantAPersona,
    knowledgeContext: 'Tenant A proprietary knowledge item: ALPHA-9988',
  });

  const instructionB = buildTenantRuntimeSystemInstruction({
    persona: tenantBPersona,
    knowledgeContext: 'Tenant B proprietary knowledge item: BETA-7766',
  });

  assert.match(instructionA, /Verdant Landscapes LLC/);
  assert.match(instructionA, /ALPHA-9988/);
  assert.doesNotMatch(instructionA, /Aura Event Production|Stage lighting|BETA-7766|48,000 AED/);

  assert.match(instructionB, /Aura Event Production LLC/);
  assert.match(instructionB, /BETA-7766/);
  assert.doesNotMatch(instructionB, /Verdant Landscapes|Drip irrigation|ALPHA-9988|3,200 AED/);
});
