import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveInstagramBehavioralPolicy } from '../services/instagram-behavioral-policy-service.js';
import { resolveTenantRuntimePersona } from '../services/tenant-runtime-persona-service.js';
import {
  buildInstagramBehavioralInstruction,
  buildInstagramChannelRules,
} from '../services/instagram-ai-orchestrator.js';
import { buildTenantRuntimeSystemInstruction } from '../services/tenant-runtime-persona-service.js';

test('returns the active tenant Instagram behavioral prompt without a tenant-specific fallback', () => {
  const result = resolveInstagramBehavioralPolicy({
    persona: {
      configuration: {
        channel_adaptations: {
          instagram: {
            behavioral_prompt: '  Use the prepared residency explanation exactly.  \n',
          },
        },
      },
    },
  });

  assert.deepEqual(result, {
    policy: '  Use the prepared residency explanation exactly.  \n',
    configured: true,
  });
});

test('rejects absent, non-text, and oversized Instagram policies', () => {
  const cases = [
    {},
    { channel_adaptations: { instagram: {} } },
    { channel_adaptations: { instagram: { behavioral_prompt: { content: 'not text' } } } },
    { channel_adaptations: { instagram: { behavioral_prompt: 'x'.repeat(25) } } },
  ];

  for (const configuration of cases) {
    assert.deepEqual(
      resolveInstagramBehavioralPolicy({ persona: { configuration }, maxLength: 24 }),
      { policy: '', configured: false },
    );
  }
});

test('accepts a complete uploaded behavioral prompt within the default bound', () => {
  const uploadedPrompt = 'r'.repeat(51_040);

  assert.deepEqual(
    resolveInstagramBehavioralPolicy({
      persona: { configuration: { channel_adaptations: { instagram: { behavioral_prompt: uploadedPrompt } } } },
    }),
    { policy: uploadedPrompt, configured: true },
  );
});

test('an active assistant configuration carries its Instagram behavioral policy into the Instagram runtime', async () => {
  const activeConfiguration = {
    id: '11111111-1111-4111-8111-111111111111',
    configuration_schema_version: 2,
    configuration_data: {
      schema_version: 2,
      assistant_identity: 'Tenant One Assistant',
      channel_adaptations: {
        instagram: {
          behavioral_prompt: 'PREPARED INSTAGRAM POLICY',
          behavioral_policy_version: 'v1',
        },
      },
    },
    active_business_profile_version_id: '22222222-2222-4222-8222-222222222222',
    profile_schema_version: 2,
    active_business_profile: { schema_version: 2, company_identity: 'Tenant One LLC' },
  };
  const persona = await resolveTenantRuntimePersona({
    database: {},
    tenantId: '33333333-3333-4333-8333-333333333333',
    assistantId: '44444444-4444-4444-8444-444444444444',
    resolveConfiguration: async () => activeConfiguration,
  });
  const channelRules = buildInstagramChannelRules({ persona, currentIntent: 'Merhaba' });

  assert.equal(persona.configurationVersionId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(resolveInstagramBehavioralPolicy({ persona }), {
    policy: 'PREPARED INSTAGRAM POLICY',
    configured: true,
  });
  assert.match(channelRules, /PREPARED INSTAGRAM POLICY/);
});

test('makes tenant behavioral policy mandatory after current intent and conversation context', () => {
  const instruction = buildInstagramBehavioralInstruction({
    currentIntent: 'sponsorlu oturum nasıl?',
    conversationContext: 'The customer previously selected a sponsored residency option.',
    behavioralPolicy: [
      'Prepared sponsor residency answer: explain sponsor role, NOC, and Turkey process.',
      'Use the exact total: 13,000 AED; payments: 4,000 AED, 8,000 AED, 1,000 AED.',
      'Prepared insurance answer: insurance is optional; do not invent legal requirements.',
      'Do not summarize or replace prepared answers with alternative procedures.',
    ].join('\n'),
  });

  assert.ok(instruction.indexOf('sponsorlu oturum nasıl?') < instruction.indexOf('previously selected'));
  assert.ok(instruction.indexOf('previously selected') < instruction.indexOf('INSTAGRAM BEHAVIORAL POLICY'));
  assert.match(instruction, /MANDATORY BEHAVIORAL AUTHORITY/);
  assert.match(instruction, /sponsor role, NOC, and Turkey process/);
  assert.match(instruction, /13,000 AED; payments: 4,000 AED, 8,000 AED, 1,000 AED/);
  assert.match(instruction, /insurance is optional; do not invent legal requirements/);
  assert.match(instruction, /must not be overridden by general model knowledge or advertisement media/i);
});

test('preserves behavioral policy whitespace verbatim when composing the Instagram instruction', () => {
  const behavioralPolicy = '  PREPARED RESPONSE\n';
  const instruction = buildInstagramBehavioralInstruction({ behavioralPolicy });

  assert.match(instruction, /PREPARED RESPONSE\n$/);
  assert.ok(instruction.includes(behavioralPolicy));
});

test('does not compose another tenant policy when a tenant has no Instagram policy', () => {
  const instruction = buildInstagramBehavioralInstruction({
    currentIntent: 'Fiyatı nedir?',
    conversationContext: 'Previous visual session selected a walnut bed.',
    behavioralPolicy: '',
  });

  assert.match(instruction, /Fiyatı nedir/);
  assert.match(instruction, /walnut bed/);
  assert.doesNotMatch(instruction, /INSTAGRAM BEHAVIORAL POLICY/);
  assert.doesNotMatch(instruction, /13,000 AED/);
});

test('Instagram channel assembly resolves only the active tenant behavioral policy', () => {
  const channelRules = buildInstagramChannelRules({
    persona: {
      configuration: {
        channel_adaptations: {
          instagram: { behavioral_prompt: 'Use this tenant prepared insurance answer exactly.' },
        },
      },
    },
    currentIntent: 'Sigorta dahil mi?',
    conversationContext: 'The customer is asking about the sponsored residency package.',
    customerIdentityContext: 'CUSTOMER IDENTITY CONTEXT: known customer',
  });

  assert.match(channelRules, /Use this tenant prepared insurance answer exactly/);
  assert.ok(channelRules.indexOf('Sigorta dahil mi?') < channelRules.indexOf('INSTAGRAM BEHAVIORAL POLICY'));
  assert.ok(channelRules.indexOf('INSTAGRAM BEHAVIORAL POLICY') < channelRules.indexOf('INSTAGRAM CHANNEL PRESENTATION'));
  assert.doesNotMatch(channelRules, /another tenant/i);
});

test('Instagram passes the complete behavioral policy through the shared renderer without changing other channel defaults', () => {
  const behavioralPolicy = `POLICY_START${'x'.repeat(51_040)}POLICY_END`;
  const persona = {
    available: true,
    companyIdentity: 'Tenant One LLC',
    assistantIdentity: 'Tenant One Assistant',
    profile: { company_identity: 'Tenant One LLC' },
    configuration: {
      assistant_identity: 'Tenant One Assistant',
      channel_adaptations: { instagram: { behavioral_prompt: behavioralPolicy } },
    },
  };
  const instagramRules = buildInstagramChannelRules({ persona });

  const instagramInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    channelRules: instagramRules,
    channelRulesLimit: 80_000,
  });
  const defaultInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    channelRules: 'q'.repeat(4_001),
  });

  assert.match(instagramInstruction, /POLICY_START/);
  assert.match(instagramInstruction, /POLICY_END/);
  assert.doesNotMatch(defaultInstruction, /q$/);
});

test('shared WhatsApp and AI Guide instruction assembly never receives Instagram behavior policy', () => {
  const persona = {
    available: true,
    companyIdentity: 'Tenant Two LLC',
    assistantIdentity: 'Tenant Two Assistant',
    profile: { company_identity: 'Tenant Two LLC' },
    configuration: {
      assistant_identity: 'Tenant Two Assistant',
      channel_adaptations: {
        instagram: { behavioral_prompt: 'TENANT_TWO_INSTAGRAM_ONLY_POLICY' },
      },
    },
  };

  const whatsappInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Tenant Two approved facts.',
    channelRules: 'WhatsApp delivery rules.',
  });
  const guideInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Tenant Two approved facts.',
    channelRules: 'AI Guide delivery rules.',
  });

  assert.doesNotMatch(whatsappInstruction, /TENANT_TWO_INSTAGRAM_ONLY_POLICY/);
  assert.doesNotMatch(guideInstruction, /TENANT_TWO_INSTAGRAM_ONLY_POLICY/);
});
