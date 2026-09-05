import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChannelAssistantRuntime } from '../services/assistant-runtime-resolution-service.js';
import { buildTenantRuntimeSystemInstruction } from '../services/tenant-runtime-persona-service.js';

test('Task 7L2: AI Guide runtime context contract provides knowledge chunks array and model metadata', async () => {
  const mockScope = {
    tenant_id: 'tenant-123',
    assistant_id: 'assistant-123',
    channel_id: 'channel-123',
    channel_assistant_id: 'assistant-123',
    channel_status: 'active',
    assistant_status: 'active',
    channel_type: 'SAMCHEGUIDE',
  };

  const mockPersona = {
    available: true,
    companyIdentity: 'Samche Company',
    assistantIdentity: 'Samche Guide',
    profile: {
      company_identity: 'Samche Company',
    },
    configuration: {
      assistant_identity: 'Samche Guide',
    },
    profileVersionId: 'profile-ver-1',
    configurationVersionId: 'config-ver-1',
  };

  const mockKnowledge = {
    activeConfiguration: {
      id: 'config-ver-1',
      active_business_profile_version_id: 'profile-ver-1',
    },
    activeConfigurationContext: 'Approved context',
    knowledge: [
      { id: 'chunk-1', text: 'Knowledge chunk 1' },
      { id: 'chunk-2', text: 'Knowledge chunk 2' },
    ],
    knowledgeContext: 'Untrusted knowledge context',
    retrievalAvailable: true,
  };

  const runtime = await resolveChannelAssistantRuntime({
    database: {},
    embed: null,
    scope: mockScope,
    query: 'hello',
    channelType: 'SAMCHEGUIDE',
    resolvePersona: async () => mockPersona,
    resolveKnowledge: async () => mockKnowledge,
    resolveModel: () => ({
      provider: 'GOOGLE_VERTEX',
      mode: 'google',
      model: 'gemini-1.5-flash',
    }),
  });

  // Verify exact contract access expressions used in app.js
  assert.equal(runtime.knowledge.activeConfiguration ? '1' : '0', '1');
  assert.equal(Array.isArray(runtime.knowledge.knowledge), true);
  assert.equal(runtime.knowledge.knowledge.length, 2);
  assert.equal(runtime.knowledge.retrievalAvailable ? '1' : '0', '1');
  assert.equal(runtime.mode, 'google');
  assert.equal(runtime.model, 'gemini-1.5-flash');

  // Verify system instruction generation with guide context summary
  const guideContextSummary = 'ROADMAP: Goal A, Goal B';
  const runtimeSystemInstruction = buildTenantRuntimeSystemInstruction({
    persona: runtime.persona,
    knowledgeContext: [guideContextSummary, runtime.knowledge.knowledgeContext].filter(Boolean).join('\n\n'),
    channelRules: 'Return safe, readable HTML suitable for the AI Guide interface.',
  });

  assert.match(runtimeSystemInstruction, /Samche Guide/);
  assert.match(runtimeSystemInstruction, /ROADMAP: Goal A, Goal B/);
  assert.match(runtimeSystemInstruction, /Untrusted knowledge context/);
});
