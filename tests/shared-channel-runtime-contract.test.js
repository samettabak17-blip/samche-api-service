import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssistantRuntimeResolutionError,
  resolveChannelAssistantRuntime,
} from '../services/assistant-runtime-resolution-service.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const ASSISTANT_A = '22222222-2222-4222-8222-222222222222';
const CONFIGURATION_A = '33333333-3333-4333-8333-333333333333';
const PROFILE_A = '44444444-4444-4444-8444-444444444444';

function scope(channelType) {
  return {
    tenant_id: TENANT_A,
    assistant_id: ASSISTANT_A,
    channel_assistant_id: ASSISTANT_A,
    channel_id: `channel-${channelType.toLowerCase()}`,
    channel_type: channelType,
    channel_status: 'active',
    assistant_status: 'active',
  };
}

function resolvers(calls) {
  return {
    resolvePersona: async (args) => {
      calls.push({ boundary: 'persona', ...args });
      return { available: true, profileVersionId: PROFILE_A, configurationVersionId: CONFIGURATION_A };
    },
    resolveKnowledge: async (args) => {
      calls.push({ boundary: 'knowledge', ...args });
      return {
        activeConfiguration: {
          id: CONFIGURATION_A,
          active_business_profile_version_id: PROFILE_A,
        },
        retrievalAvailable: true,
        knowledge: [{ sourceId: 'canonical-source', text: 'Approved canonical fact' }],
      };
    },
    resolveModel: () => ({ provider: 'FAKE', mode: 'test', model: 'fake-model' }),
  };
}

test('Guide, Web and WhatsApp resolve one approved canonical runtime brain', async () => {
  const calls = [];
  const common = resolvers(calls);
  const channels = ['SAMCHEGUIDE', 'WEB_CHAT', 'WHATSAPP'];
  const results = await Promise.all(channels.map((channelType) => resolveChannelAssistantRuntime({
    database: { query: async () => ({ rows: [] }) },
    embed: async () => [],
    scope: scope(channelType),
    query: 'approved service fact',
    channelType,
    ...common,
  })));

  assert.deepEqual(results.map((result) => result.knowledge.knowledge), [
    [{ sourceId: 'canonical-source', text: 'Approved canonical fact' }],
    [{ sourceId: 'canonical-source', text: 'Approved canonical fact' }],
    [{ sourceId: 'canonical-source', text: 'Approved canonical fact' }],
  ]);
  assert.ok(results.every((result) => result.health.retrievalAvailable === true));
  assert.ok(calls.every((call) => call.tenantId === TENANT_A && call.assistantId === ASSISTANT_A));
});

test('a channel cannot resolve a configuration/profile relation from another tenant authority', async () => {
  const common = resolvers([]);
  await assert.rejects(
    () => resolveChannelAssistantRuntime({
      database: { query: async () => ({ rows: [] }) },
      embed: async () => [],
      scope: { ...scope('WHATSAPP'), channel_assistant_id: '55555555-5555-4555-8555-555555555555' },
      query: 'approved service fact',
      channelType: 'WHATSAPP',
      ...common,
    }),
    (error) => error instanceof AssistantRuntimeResolutionError && error.code === 'CHANNEL_TENANT_ASSISTANT_MISMATCH',
  );
});
