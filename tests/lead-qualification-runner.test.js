import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeLeadQualificationModel, runLeadQualification } from '../services/lead-qualification-runner.js';
import { ProviderCircuitBreakerRegistry } from '../services/shared-ai-provider-resilience.js';

const validOutput = {
  intent: 'PURCHASE', service_interest: 'Consulting', summary: 'Qualified request', reasons: [],
  signals: {
    purchase_intent: 'EXPLICIT', service_fit: 'STRONG', decision_readiness: 'HIGH',
    pricing_request: true, appointment_interest: false, human_consultant_request: false,
    budget: { amount: null, currency: null, evidence: null },
    timeline: { value: null, evidence: null },
  },
};

test('CRM Vertex success preserves primary provider provenance', async () => {
  let openaiCalls = 0;
  const result = await invokeLeadQualificationModel('prompt', {
    env: { DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true', OPENAI_API_KEY: 'key' },
    circuitRegistry: new ProviderCircuitBreakerRegistry(),
    googleProviderFactory: () => ({ generateContent: async () => ({ structured_text: JSON.stringify(validOutput) }) }),
    openaiClient: { chat: { completions: { create: async () => { openaiCalls += 1; } } } },
  });
  assert.equal(result.provider, 'VERTEX');
  assert.equal(result.model, 'gemini-3-flash-preview');
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(result.output, validOutput);
  assert.equal(openaiCalls, 0);
});

test('CRM suspended Vertex falls back to OpenAI with actual provenance', async () => {
  const result = await invokeLeadQualificationModel('prompt', {
    env: { DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true', OPENAI_API_KEY: 'key' },
    circuitRegistry: new ProviderCircuitBreakerRegistry(),
    googleProviderFactory: () => ({ generateContent: async () => { throw Object.assign(new Error('suspended'), { status: 403 }); } }),
    openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(validOutput) } }] }) } } },
  });
  assert.equal(result.provider, 'OPENAI');
  assert.equal(result.model, 'gpt-4o-mini');
  assert.equal(result.fallbackUsed, true);
});

test('CRM invalid OpenAI output is terminal after eligible fallback', async () => {
  await assert.rejects(
    invokeLeadQualificationModel('prompt', {
      env: { DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true', OPENAI_API_KEY: 'key' },
      circuitRegistry: new ProviderCircuitBreakerRegistry(),
      googleProviderFactory: () => ({ generateContent: async () => { throw Object.assign(new Error('suspended'), { status: 403 }); } }),
      openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{bad' } }] }) } } },
    }),
    { code: 'LEAD_QUALIFICATION_PROVIDER_RESPONSE_INVALID' },
  );
});

function qualificationDatabase({ failCommitOnce = false } = {}) {
  const calls = [];
  let commitFailures = failCommitOnce ? 1 : 0;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM crm_leads l/i.test(sql)) return { rows: [{ id: 'lead-a', email: null, phone: null }] };
      if (/FROM conversation_messages/i.test(sql)) return { rows: [{ id: 'm1', sender_type: 'CUSTOMER', content: 'I need a detailed pricing proposal for company formation.', created_at: new Date().toISOString() }] };
      if (/FROM crm_lead_analyses/i.test(sql)) return { rows: [] };
      if (/pg_try_advisory_lock/i.test(sql)) return { rows: [{ acquired: true }] };
      if (/^COMMIT$/i.test(sql.trim()) && commitFailures > 0) { commitFailures -= 1; throw Object.assign(new Error('interrupted'), { code: 'CONNECTION_LOST' }); }
      return { rows: [] };
    },
    release() {},
  };
  return { database: { connect: async () => client }, calls };
}

test('CRM interruption rolls back, clears inFlight, and a rerun can converge', async () => {
  const fixture = qualificationDatabase({ failCommitOnce: true });
  await assert.rejects(runLeadQualification({
    database: fixture.database, tenantId: 'tenant-a', conversationId: 'conversation-a', force: true,
    invokeModel: async () => validOutput,
  }), { code: 'CONNECTION_LOST' });
  const result = await runLeadQualification({
    database: fixture.database, tenantId: 'tenant-a', conversationId: 'conversation-a', force: true,
    invokeModel: async () => validOutput,
  });
  assert.equal(result.provider, 'GEMINI');
  assert.ok(fixture.calls.some(({ sql }) => /^ROLLBACK$/i.test(sql.trim())));
  assert.equal(fixture.calls.filter(({ sql }) => /^COMMIT$/i.test(sql.trim())).length, 2);
  assert.equal(fixture.calls.filter(({ sql }) => /INSERT INTO crm_lead_analyses/i.test(sql)).length, 2);
  assert.ok(fixture.calls.some(({ sql }) => /ON CONFLICT \(tenant_id, lead_id, analysis_hash\)/i.test(sql)));
  assert.ok(fixture.calls.filter(({ sql }) => /tenant_id = \$1 AND l\.conversation_id = \$2/i.test(sql)).every(({ params }) => params[0] === 'tenant-a'));
});
