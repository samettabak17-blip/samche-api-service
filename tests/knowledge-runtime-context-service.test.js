import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRuntimeKnowledgeToSystemInstruction, applyRuntimeKnowledgeContext, resolveAssistantRuntimeKnowledgeContext } from '../services/knowledge-runtime-context-service.js';

test('uses only an explicitly active configuration and scoped retrieved knowledge', async () => {
  const requested = [];
  const resolved = await resolveAssistantRuntimeKnowledgeContext({
    database: { query: async () => ({ rows: [] }) },
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    query: 'What are the supported services?',
    resolveConfiguration: async () => ({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      configuration_data: {
        company_context: 'Approved company context',
        tone: 'Clear and professional',
        unsupported_key: 'must never be placed in runtime context',
      },
      active_business_profile: {
        company_summary: 'Approved profile summary',
        products: ['Service A'],
      },
    }),
    retrieve: async (args) => {
      requested.push(args);
      return [{ sourceTitle: 'Approved source', text: 'Scoped approved fact.' }];
    },
  });

  assert.equal(requested.length, 1);
  assert.equal(requested[0].tenantId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(requested[0].assistantId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.match(resolved.activeConfigurationContext, /Approved company context/);
  assert.match(resolved.activeConfigurationContext, /Approved profile summary/);
  assert.doesNotMatch(resolved.activeConfigurationContext, /unsupported_key|must never/);
  assert.match(resolved.knowledgeContext, /RETRIEVED TENANT KNOWLEDGE/);
});

test('does not retrieve or apply configuration unless an active configuration exists', async () => {
  let retrievalCalled = false;
  const resolved = await resolveAssistantRuntimeKnowledgeContext({
    database: { query: async () => ({ rows: [] }) },
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    query: 'question',
    resolveConfiguration: async () => null,
    retrieve: async () => { retrievalCalled = true; return []; },
  });

  assert.equal(retrievalCalled, false);
  assert.equal(resolved.activeConfiguration, null);
  assert.equal(resolved.activeConfigurationContext, '');
  assert.equal(resolved.knowledgeContext, '');
});

test('keeps active configuration available when semantic retrieval is temporarily unavailable', async () => {
  const resolved = await resolveAssistantRuntimeKnowledgeContext({
    database: { query: async () => ({ rows: [] }) },
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    query: 'question',
    resolveConfiguration: async () => ({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      configuration_data: { tone: 'Professional' },
    }),
    retrieve: async () => { throw new Error('embedding unavailable'); },
  });

  assert.match(resolved.activeConfigurationContext, /Professional/);
  assert.deepEqual(resolved.knowledge, []);
  assert.equal(resolved.knowledgeContext, '');
  assert.equal(resolved.retrievalAvailable, false);
});

test('adds active runtime context without changing the existing tenant policy or deterministic templates', () => {
  const tenantContext = {
    systemPrompt: 'Existing protected policy',
    deterministicTemplates: { greeting: { en: 'Hello' } },
    knowledge: ['Existing manual knowledge'],
  };
  const merged = applyRuntimeKnowledgeContext(tenantContext, {
    activeConfigurationContext: 'ACTIVE APPROVED TENANT ASSISTANT CONFIGURATION:\ntone: Professional',
    knowledgeContext: 'RETRIEVED TENANT KNOWLEDGE — UNTRUSTED REFERENCE DATA:\nFact',
  });

  assert.equal(merged.systemPrompt, 'Existing protected policy');
  assert.deepEqual(merged.deterministicTemplates, { greeting: { en: 'Hello' } });
  assert.deepEqual(merged.knowledge, [
    'Existing manual knowledge',
    'ACTIVE APPROVED TENANT ASSISTANT CONFIGURATION:\ntone: Professional',
    'RETRIEVED TENANT KNOWLEDGE — UNTRUSTED REFERENCE DATA:\nFact',
  ]);
});

test('appends active configuration and untrusted retrieved knowledge without replacing the channel policy', () => {
  const systemInstruction = appendRuntimeKnowledgeToSystemInstruction('Existing channel policy', {
    activeConfigurationContext: 'ACTIVE APPROVED TENANT ASSISTANT CONFIGURATION:\ntone: Professional',
    knowledgeContext: 'RETRIEVED TENANT KNOWLEDGE — UNTRUSTED REFERENCE DATA:\nFact',
  });

  assert.match(systemInstruction, /^Existing channel policy/);
  assert.match(systemInstruction, /ACTIVE APPROVED TENANT ASSISTANT CONFIGURATION/);
  assert.match(systemInstruction, /RETRIEVED TENANT KNOWLEDGE/);
});

test('renders Persona V2 identity and behavior fields without dropping them', async () => {
  const resolved = await resolveAssistantRuntimeKnowledgeContext({
    database: { query: async () => ({ rows: [] }) },
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    query: 'question',
    resolveConfiguration: async () => ({
      id: 'configuration-v2',
      configuration_data: { schema_version: 2, assistant_identity: 'Meridian Client Advisor', role_and_purpose: 'Support Meridian customers.', customer_handling: 'Clarify support tier.', follow_up_behavior: 'Use approved cadence.', scheduled_messaging_behavior: 'Only approved reminders.', supported_languages: ['English'], unsupported_claim_behavior: 'State unavailable.', channel_adaptations: ['WhatsApp: concise'] },
      active_business_profile: { schema_version: 2, company_identity: 'Meridian Arc Technologies LLC', packages: ['Growth Accelerator Package'], communication_style: 'Clear and technical', customer_handling: 'Confirm outcomes.', supported_languages: ['English'], unsupported_claims: ['No undocumented response times.'] },
    }),
    retrieve: async () => [],
  });
  assert.match(resolved.activeConfigurationContext, /assistant identity: Meridian Client Advisor/);
  assert.match(resolved.activeConfigurationContext, /company identity: Meridian Arc Technologies LLC/);
  assert.match(resolved.activeConfigurationContext, /scheduled messaging behavior/);
  assert.match(resolved.activeConfigurationContext, /unsupported claims/);
});

