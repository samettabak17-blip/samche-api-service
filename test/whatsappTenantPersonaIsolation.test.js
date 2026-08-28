import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhatsAppActivePersonaTenantContext,
  resolveWhatsAppPersonaUnavailableResponse,
} from '../services/whatsapp-tenant-context-service.js';

const persona = {
  available: true,
  companyIdentity: 'Meridian Arc Technologies LLC',
  assistantIdentity: 'Meridian Client Advisor',
  profile: { schema_version: 2, company_identity: 'Meridian Arc Technologies LLC', services: ['Enterprise support'], pricing_information: ['35,650 AED'] },
  configuration: { schema_version: 2, assistant_identity: 'Meridian Client Advisor', role_and_purpose: 'Support Meridian customers.', fallback_guidance: 'Say information is unavailable.' },
};

test('non-SamChe mapped WhatsApp context uses only ACTIVE tenant persona and current knowledge', () => {
  const context = buildWhatsAppActivePersonaTenantContext({
    persona,
    knowledgeContext: 'Current approved marker SAPPHIRE-7319',
    communicationLanguage: 'en',
    deterministicTemplates: { social: { greeting: { en: 'Hello.' } } },
  });
  assert.equal(context.companyName, 'Meridian Arc Technologies LLC');
  assert.equal(context.assistantName, 'Meridian Client Advisor');
  assert.match(context.systemPrompt, /Enterprise support/);
  assert.match(context.systemPrompt, /SAPPHIRE-7319/);
  assert.doesNotMatch(context.systemPrompt, /SamChe|Dubai|company formation/i);
  assert.deepEqual(context.knowledge, []);
});

test('mapped WhatsApp context refuses to use a missing ACTIVE persona', () => {
  assert.throws(
    () => buildWhatsAppActivePersonaTenantContext({ persona: { available: false }, communicationLanguage: 'en' }),
    (error) => error.code === 'WHATSAPP_TENANT_PERSONA_NOT_ACTIVE',
  );
});

test('persona unavailable response is neutral and localized without a business fallback', () => {
  assert.equal(resolveWhatsAppPersonaUnavailableResponse('en'), 'The assistant configuration is temporarily unavailable. Please try again later.');
  for (const language of ['tr', 'en', 'ar']) {
    assert.doesNotMatch(resolveWhatsAppPersonaUnavailableResponse(language), /SamChe|Dubai|company formation/i);
  }
});
