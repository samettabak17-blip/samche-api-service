import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  resolveActiveManagedGuideDomain,
  resolveGuideRuntimeScopeFromRequest,
} from '../services/guide-domain-service.js';
import {
  issueGuideResumeSession,
  resolveGuideResumeSession,
  loadGuideResumeState,
  saveGuideResumeState,
} from '../services/guide-conversation-service.js';
import { resolveChannelAssistantRuntime } from '../services/assistant-runtime-resolution-service.js';
import {
  resolveTenantRuntimePersona,
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';
import { inspectGuideExperiencePublication } from '../services/guide-experience-service.js';

// Two distinct, independently configured fresh tenants
const TENANT_ALPHA = '11111111-aaaa-4111-8111-111111111111';
const ASSISTANT_ALPHA = '22222222-aaaa-4222-8222-222222222222';
const CHANNEL_ALPHA = '33333333-aaaa-4333-8333-333333333333';
const DOMAIN_ALPHA = '44444444-aaaa-4444-8444-444444444444';
const CONFIG_ALPHA = '55555555-aaaa-4555-8555-555555555555';
const PROFILE_ALPHA = '66666666-aaaa-4666-8666-666666666666';

const TENANT_BETA = '77777777-bbbb-4777-8777-777777777777';
const ASSISTANT_BETA = '88888888-bbbb-4888-8888-888888888888';
const CHANNEL_BETA = '99999999-bbbb-4999-8999-999999999999';
const DOMAIN_BETA = 'aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa';
const CONFIG_BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROFILE_BETA = 'cccccccc-bbbb-4ccc-8ccc-cccccccccccc';

function createMockMultiTenantDatabase() {
  const publicSessions = new Map();
  return {
    publicSessions,
    async query(sql, params = []) {
      if (sql.includes('guide_domains gd') && sql.includes('lower(gd.slug) = $1')) {
        const slug = params[0];
        if (slug === 'alpha-freight-guide') {
          return { rowCount: 1, rows: [{ domain_id: DOMAIN_ALPHA, hostname: 'guide-staging.samchecompany.com', slug: 'alpha-freight-guide', tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, channel_assistant_id: ASSISTANT_ALPHA, channel_type: 'SAMCHEGUIDE', channel_status: 'active', assistant_status: 'active', integration_enabled: true }] };
        }
        if (slug === 'beta-medical-guide') {
          return { rowCount: 1, rows: [{ domain_id: DOMAIN_BETA, hostname: 'guide-staging.samchecompany.com', slug: 'beta-medical-guide', tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, channel_assistant_id: ASSISTANT_BETA, channel_type: 'SAMCHEGUIDE', channel_status: 'active', assistant_status: 'active', integration_enabled: true }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT tenant_id FROM guide_public_sessions WHERE token_hash = $1')) {
        const found = publicSessions.get(params[0]);
        return found ? { rowCount: 1, rows: [{ tenant_id: found.tenant_id }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO guide_public_sessions')) {
        publicSessions.set(params[0], { token_hash: params[0], session_id: params[1], tenant_id: params[2], assistant_id: params[3], channel_id: params[4], domain_id: params[5], experience_version: params[6], preview_mode: params[7], expires_at: params[8], state: {} });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT session_id, expires_at FROM guide_public_sessions')) {
        const found = publicSessions.get(params[0]);
        if (found && found.tenant_id === params[1] && found.assistant_id === params[2] && found.experience_version === params[5]) {
          return { rowCount: 1, rows: [{ session_id: found.session_id, expires_at: found.expires_at }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE guide_public_sessions SET last_seen_at=CURRENT_TIMESTAMP')) return { rowCount: 1, rows: [] };
      if (sql.includes('UPDATE guide_public_sessions SET state=$2::jsonb')) {
        const found = publicSessions.get(params[0]);
        if (found) found.state = JSON.parse(params[1]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT state FROM guide_public_sessions')) {
        const found = publicSessions.get(params[0]);
        if (found && found.tenant_id === params[1] && found.assistant_id === params[2]) {
          return { rowCount: 1, rows: [{ state: found.state || {} }] };
        }
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

function mockPersona(tenantId) {
  if (tenantId === TENANT_ALPHA) {
    return {
      available: true,
      companyIdentity: 'Alpha Freight & Logistics LLC',
      assistantIdentity: 'Alpha Operations Specialist',
      profileVersionId: PROFILE_ALPHA,
      configurationVersionId: CONFIG_ALPHA,
      profile: { schema_version: 2, company_identity: 'Alpha Freight & Logistics LLC', services: ['Air Cargo', 'Sea Freight'] },
      configuration: { schema_version: 2, assistant_identity: 'Alpha Operations Specialist' },
    };
  }
  if (tenantId === TENANT_BETA) {
    return {
      available: true,
      companyIdentity: 'Beta Medical Trading LLC',
      assistantIdentity: 'Beta Medical Clinical Advisor',
      profileVersionId: PROFILE_BETA,
      configurationVersionId: CONFIG_BETA,
      profile: { schema_version: 2, company_identity: 'Beta Medical Trading LLC', services: ['Diagnostic Devices', 'Surgical Tools'] },
      configuration: { schema_version: 2, assistant_identity: 'Beta Medical Clinical Advisor' },
    };
  }
  return { available: false, code: 'TENANT_PERSONA_NOT_ACTIVE' };
}

function mockKnowledge(tenantId) {
  if (tenantId === TENANT_ALPHA) {
    return {
      activeConfiguration: { id: CONFIG_ALPHA, active_business_profile_version_id: PROFILE_ALPHA },
      retrievalAvailable: true,
      knowledge: [{ sourceId: 'src-alpha', text: 'Alpha Freight delivers air cargo within 48 hours across GCC.' }],
      knowledgeContext: 'Alpha Freight delivers air cargo within 48 hours across GCC.',
    };
  }
  if (tenantId === TENANT_BETA) {
    return {
      activeConfiguration: { id: CONFIG_BETA, active_business_profile_version_id: PROFILE_BETA },
      retrievalAvailable: true,
      knowledge: [{ sourceId: 'src-beta', text: 'Beta Medical provides CE-certified diagnostic equipment with 3-year warranty.' }],
      knowledgeContext: 'Beta Medical provides CE-certified diagnostic equipment with 3-year warranty.',
    };
  }
  return { activeConfiguration: null, retrievalAvailable: false, knowledge: [], knowledgeContext: '' };
}

test('1. Independent persona resolution & isolation across two fresh tenants', async () => {
  const db = createMockMultiTenantDatabase();
  const runtimeAlpha = await resolveChannelAssistantRuntime({
    database: db,
    embed: async () => [],
    scope: { tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, channel_assistant_id: ASSISTANT_ALPHA, channel_type: 'SAMCHEGUIDE', channel_status: 'active', assistant_status: 'active' },
    query: 'freight options',
    channelType: 'SAMCHEGUIDE',
    resolvePersona: async () => mockPersona(TENANT_ALPHA),
    resolveKnowledge: async () => mockKnowledge(TENANT_ALPHA),
    resolveModel: () => ({ provider: 'TEST', mode: 'mock', model: 'gemini-test' }),
  });

  const runtimeBeta = await resolveChannelAssistantRuntime({
    database: db,
    embed: async () => [],
    scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, channel_assistant_id: ASSISTANT_BETA, channel_type: 'SAMCHEGUIDE', channel_status: 'active', assistant_status: 'active' },
    query: 'diagnostic tools',
    channelType: 'SAMCHEGUIDE',
    resolvePersona: async () => mockPersona(TENANT_BETA),
    resolveKnowledge: async () => mockKnowledge(TENANT_BETA),
    resolveModel: () => ({ provider: 'TEST', mode: 'mock', model: 'gemini-test' }),
  });

  assert.equal(runtimeAlpha.persona.companyIdentity, 'Alpha Freight & Logistics LLC');
  assert.equal(runtimeAlpha.persona.assistantIdentity, 'Alpha Operations Specialist');
  assert.equal(runtimeBeta.persona.companyIdentity, 'Beta Medical Trading LLC');
  assert.equal(runtimeBeta.persona.assistantIdentity, 'Beta Medical Clinical Advisor');

  const instructionAlpha = buildTenantRuntimeSystemInstruction({ persona: runtimeAlpha.persona, knowledgeContext: runtimeAlpha.knowledge.knowledgeContext });
  const instructionBeta = buildTenantRuntimeSystemInstruction({ persona: runtimeBeta.persona, knowledgeContext: runtimeBeta.knowledge.knowledgeContext });

  assert.match(instructionAlpha, /Alpha Freight/);
  assert.doesNotMatch(instructionAlpha, /Beta Medical/);
  assert.match(instructionBeta, /Beta Medical/);
  assert.doesNotMatch(instructionBeta, /Alpha Freight/);
});

test('2. Clean first session: new conversation starts empty on both fresh tenants', async () => {
  const db = createMockMultiTenantDatabase();
  const sessionAlpha = await issueGuideResumeSession({ database: db, scope: { tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, domain_id: DOMAIN_ALPHA }, experienceVersion: 1, previewMode: false });
  const sessionBeta = await issueGuideResumeSession({ database: db, scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, domain_id: DOMAIN_BETA }, experienceVersion: 1, previewMode: false });

  assert.notEqual(sessionAlpha.token, sessionBeta.token);
  assert.notEqual(sessionAlpha.sessionId, sessionBeta.sessionId);

  const stateAlpha = await loadGuideResumeState({ database: db, token: sessionAlpha.token, scope: { tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, domain_id: DOMAIN_ALPHA }, experienceVersion: 1, previewMode: false });
  const stateBeta = await loadGuideResumeState({ database: db, token: sessionBeta.token, scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, domain_id: DOMAIN_BETA }, experienceVersion: 1, previewMode: false });

  assert.deepEqual(stateAlpha, {});
  assert.deepEqual(stateBeta, {});
});


test('3. Multi-turn conversation and state persistence across tenants', async () => {
  const db = createMockMultiTenantDatabase();
  const sessionAlpha = await issueGuideResumeSession({ database: db, scope: { tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, domain_id: DOMAIN_ALPHA }, experienceVersion: 1, previewMode: false });
  const sessionBeta = await issueGuideResumeSession({ database: db, scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, domain_id: DOMAIN_BETA }, experienceVersion: 1, previewMode: false });

  // Save conversation turn to Alpha
  await saveGuideResumeState({
    database: db,
    token: sessionAlpha.token,
    scope: { tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, domain_id: DOMAIN_ALPHA },
    experienceVersion: 1,
    previewMode: false,
    state: {
      assistantConversation: {
        messages: [
          { role: 'user', content: 'What are the air freight rates?' },
          { role: 'assistant', content: 'Standard air freight starts from 15 AED/kg with 48h delivery.' },
        ],
      },
    },
  });

  // Save conversation turn to Beta
  await saveGuideResumeState({
    database: db,
    token: sessionBeta.token,
    scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, domain_id: DOMAIN_BETA },
    experienceVersion: 1,
    previewMode: false,
    state: {
      assistantConversation: {
        messages: [
          { role: 'user', content: 'Do you supply MRI equipment?' },
          { role: 'assistant', content: 'Yes, Beta Medical provides diagnostic imaging equipment with 3-year warranty.' },
        ],
      },
    },
  });

  // Reload states and verify strict isolation
  const loadedAlpha = await loadGuideResumeState({ database: db, token: sessionAlpha.token, scope: { tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, domain_id: DOMAIN_ALPHA }, experienceVersion: 1, previewMode: false });
  const loadedBeta = await loadGuideResumeState({ database: db, token: sessionBeta.token, scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, domain_id: DOMAIN_BETA }, experienceVersion: 1, previewMode: false });

  assert.equal(loadedAlpha.assistantConversation.messages.length, 2);
  assert.equal(loadedAlpha.assistantConversation.messages[0].content, 'What are the air freight rates?');
  assert.match(loadedAlpha.assistantConversation.messages[1].content, /15 AED\/kg/);

  assert.equal(loadedBeta.assistantConversation.messages.length, 2);
  assert.equal(loadedBeta.assistantConversation.messages[0].content, 'Do you supply MRI equipment?');
  assert.match(loadedBeta.assistantConversation.messages[1].content, /Beta Medical/);
});

test('4. Cross-tenant token presented at another tenant URL resolves clean domain without 503', async () => {
  const db = createMockMultiTenantDatabase();
  // Issue session for Alpha
  const sessionAlpha = await issueGuideResumeSession({ database: db, scope: { tenant_id: TENANT_ALPHA, assistant_id: ASSISTANT_ALPHA, channel_id: CHANNEL_ALPHA, domain_id: DOMAIN_ALPHA }, experienceVersion: 1, previewMode: false });

  // Visitor navigates to Beta with Alpha's session token
  const reqToBeta = {
    headers: {
      host: 'guide-staging.samchecompany.com',
      'x-samcheguide-session': sessionAlpha.token,
    },
    params: { slug: 'beta-medical-guide' },
  };

  const resolvedScope = await resolveGuideRuntimeScopeFromRequest({ database: db, req: reqToBeta });
  assert.ok(resolvedScope, 'Domain resolution must succeed for Beta');
  assert.equal(resolvedScope.tenant_id, TENANT_BETA);
  assert.equal(reqToBeta.headers['x-samcheguide-session'], undefined, 'Cross-tenant session header must be stripped');

  // Verify Alpha token cannot resolve against Beta scope
  const attempt = await resolveGuideResumeSession({
    database: db,
    token: sessionAlpha.token,
    scope: { tenant_id: TENANT_BETA, assistant_id: ASSISTANT_BETA, channel_id: CHANNEL_BETA, domain_id: DOMAIN_BETA },
    experienceVersion: 1,
    previewMode: false,
  });
  assert.equal(attempt, null, 'Alpha token must not resolve for Beta');
});


test('5. Actionable onboarding validation errors when prerequisites are missing', async () => {
  const TENANT_GAMMA = 'eeeeeeee-cccc-4eee-8eee-eeeeeeeeeeee';
  const ASSISTANT_GAMMA = 'ffffffff-cccc-4fff-8fff-ffffffffffff';

  // Mock DB where Tenant Gamma has a published guide experience, but NO active Business Profile
  const dbGamma = {
    async query(sql, params = []) {
      if (sql.includes('FROM guide_experience_versions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'version-gamma-1',
            tenant_id: TENANT_GAMMA,
            assistant_id: ASSISTANT_GAMMA,
            version: 1,
            status: 'PUBLISHED',
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        };
      }
      if (sql.includes('FROM business_profiles p')) {
        // No active business profile
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM ai_assistants a')) {
        // Assistant exists without active configuration
        return { rowCount: 1, rows: [{ active_configuration_version_id: null, status: null, source_profile_version_id: null }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const diagnostics = await inspectGuideExperiencePublication({
    database: dbGamma,
    tenantId: TENANT_GAMMA,
    assistantId: ASSISTANT_GAMMA,
  });

  assert.equal(diagnostics.consistency, 'HEALTHY');
  assert.equal(diagnostics.public_bootstrap_version, 1);
  assert.ok(diagnostics.prerequisites, 'Prerequisites inspection must be present');
  assert.equal(diagnostics.prerequisites.ready, false, 'Runtime must not be marked ready without prerequisites');
  assert.ok(diagnostics.prerequisites.missing_prerequisites.includes('ACTIVE_BUSINESS_PROFILE_REQUIRED'));
  assert.ok(diagnostics.prerequisites.missing_prerequisites.includes('ACTIVE_ASSISTANT_CONFIGURATION_REQUIRED'));
});

