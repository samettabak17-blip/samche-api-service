import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssistantRuntimeKnowledgeContext } from '../services/knowledge-runtime-context-service.js';

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

