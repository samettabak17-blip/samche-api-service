import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChannelAssistantRuntime } from '../services/assistant-runtime-resolution-service.js';

const scope = Object.freeze({
  tenant_id: '11111111-1111-4111-8111-111111111111',
  assistant_id: '22222222-2222-4222-8222-222222222222',
  channel_id: '33333333-3333-4333-8333-333333333333',
  channel_assistant_id: '22222222-2222-4222-8222-222222222222',
  channel_type: 'SAMCHEGUIDE',
  channel_status: 'active',
  assistant_status: 'active',
});

test('shared runtime resolver returns a platform-selected model and matching ACTIVE profile/configuration', async () => {
  const result = await resolveChannelAssistantRuntime({
    database: {},
    scope,
    query: 'event planning',
    resolvePersona: async () => ({
      available: true,
      companyIdentity: 'Example Events LLC',
      assistantIdentity: 'Example Assistant',
      profileVersionId: '44444444-4444-4444-8444-444444444444',
      configurationVersionId: '55555555-5555-4555-8555-555555555555',
    }),
    resolveKnowledge: async () => ({
      activeConfiguration: {
        id: '55555555-5555-4555-8555-555555555555',
        active_business_profile_version_id: '44444444-4444-4444-8444-444444444444',
      },
      knowledge: [],
      knowledgeContext: '',
      retrievalAvailable: true,
    }),
    resolveModel: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3-flash-preview' }),
  });

  assert.equal(result.health.status, 'HEALTHY');
  assert.equal(result.model, 'gemini-3-flash-preview');
  assert.equal(result.persona.companyIdentity, 'Example Events LLC');
});

test('shared runtime resolver fails closed without invoking provider selection for mismatched channel ownership', async () => {
  let modelResolved = false;
  await assert.rejects(
    resolveChannelAssistantRuntime({
      database: {},
      scope: { ...scope, channel_assistant_id: '99999999-9999-4999-8999-999999999999' },
      query: 'event planning',
      resolvePersona: async () => { throw new Error('must not resolve persona'); },
      resolveKnowledge: async () => { throw new Error('must not resolve knowledge'); },
      resolveModel: () => { modelResolved = true; return { model: 'gemini-3-flash-preview' }; },
    }),
    (error) => error?.code === 'CHANNEL_TENANT_ASSISTANT_MISMATCH',
  );
  assert.equal(modelResolved, false);
});

test('shared runtime resolver fails closed when the platform model is unavailable', async () => {
  await assert.rejects(
    resolveChannelAssistantRuntime({
      database: {},
      scope,
      query: 'event planning',
      resolvePersona: async () => ({ available: true, profileVersionId: '44444444-4444-4444-8444-444444444444', configurationVersionId: '55555555-5555-4555-8555-555555555555' }),
      resolveKnowledge: async () => ({ activeConfiguration: { id: '55555555-5555-4555-8555-555555555555', active_business_profile_version_id: '44444444-4444-4444-8444-444444444444' } }),
      resolveModel: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: null }),
    }),
    (error) => error?.code === 'RUNTIME_MODEL_UNAVAILABLE',
  );
});

test('shared runtime resolver fails closed when an ACTIVE configuration points at another profile version', async () => {
  await assert.rejects(
    resolveChannelAssistantRuntime({
      database: {},
      scope,
      query: 'event planning',
      resolvePersona: async () => ({ available: true, profileVersionId: '44444444-4444-4444-8444-444444444444', configurationVersionId: '55555555-5555-4555-8555-555555555555' }),
      resolveKnowledge: async () => ({ activeConfiguration: { id: '55555555-5555-4555-8555-555555555555', active_business_profile_version_id: '77777777-7777-4777-8777-777777777777' } }),
      resolveModel: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3-flash-preview' }),
    }),
    (error) => error?.code === 'ACTIVE_PROFILE_UNAVAILABLE',
  );
});
