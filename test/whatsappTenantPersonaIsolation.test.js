import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhatsAppActivePersonaTenantContext,
  resolveWhatsAppPersonaUnavailableResponse,
} from '../services/whatsapp-tenant-context-service.js';
import { readFileSync } from 'node:fs';

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
    deterministicTemplates: { first_contact: { en: 'Hello from SamChe.' } },
  });
  assert.equal(context.companyName, 'Meridian Arc Technologies LLC');
  assert.equal(context.assistantName, 'Meridian Client Advisor');
  assert.match(context.systemPrompt, /Enterprise support/);
  assert.match(context.systemPrompt, /SAPPHIRE-7319/);
  assert.doesNotMatch(context.systemPrompt, /SamChe|Dubai|company formation/i);
  assert.deepEqual(context.knowledge, []);
  assert.equal(context.deterministicTemplates, null);
});

test('mapped WhatsApp deterministic templates come only from ACTIVE tenant configuration', () => {
  const configuredPersona = {
    ...persona,
    configuration: {
      ...persona.configuration,
      channel_adaptations: {
        whatsapp: {
          deterministic_templates: {
            first_contact: { en: 'Hello, I am {{assistantName}} for {{companyName}}.' },
          },
        },
      },
    },
  };
  const context = buildWhatsAppActivePersonaTenantContext({
    persona: configuredPersona,
    deterministicTemplates: { first_contact: { en: 'SamChe legacy greeting' } },
  });
  assert.deepEqual(context.deterministicTemplates, configuredPersona.configuration.channel_adaptations.whatsapp.deterministic_templates);
  assert.doesNotMatch(JSON.stringify(context.deterministicTemplates), /SamChe|Dubai/i);
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

test('mapped WhatsApp resolves ACTIVE persona before any customer-visible deterministic response', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const webhook = app.slice(app.indexOf('const tenantContext = whatsappInbox?.tenantContext;'), app.indexOf('// --------------------------------------\n      // TARİHÇE VE SKOR'));
  const personaResolution = webhook.indexOf('resolveTenantRuntimePersona({');
  const deterministicResponse = webhook.indexOf('planWhatsAppDeterministicSocialResponse({');
  const legacyShortReply = webhook.indexOf('wpCorporateShortReplyMap[lower]');
  assert.ok(personaResolution >= 0);
  assert.ok(deterministicResponse > personaResolution);
  assert.ok(legacyShortReply < 0);
});
