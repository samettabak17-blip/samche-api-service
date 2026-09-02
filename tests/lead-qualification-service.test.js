import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLeadScore,
  createAnalysisCheckpoint,
  isMeaningfulCustomerMessage,
  normalizeQualificationOutput,
  qualifyConversation,
  shouldRunQualification,
} from '../services/lead-qualification-service.js';
import { getLeadQualificationProviderPolicy } from '../services/lead-qualification-provider-policy.js';

test('lead qualification uses one bounded low-thinking deferred provider attempt', () => {
  assert.deepEqual(
    getLeadQualificationProviderPolicy({}),
    {
      model: 'gemini-3-flash-preview',
      timeoutMs: 30000,
      maxOutputTokens: 512,
      thinkingLevel: 'low',
      maxAttempts: 1,
    },
  );
  assert.deepEqual(
    getLeadQualificationProviderPolicy({ LEAD_QUALIFICATION_MODEL: 'platform-model', LEAD_QUALIFICATION_TIMEOUT_MS: '45000' }),
    {
      model: 'platform-model',
      timeoutMs: 45000,
      maxOutputTokens: 512,
      thinkingLevel: 'low',
      maxAttempts: 1,
    },
  );
});

test('trivial customer messages do not qualify as meaningful', () => {
  for (const content of ['hi', 'ok', 'thanks', 'teşekkürler']) {
    assert.equal(isMeaningfulCustomerMessage(content), false);
  }
});

test('meaningful customer context creates a stable analysis checkpoint', () => {
  const messages = [{ id: 'm1', sender_type: 'CUSTOMER', content: 'I need a Free Zone company quote for two visas within two weeks.' }];
  const first = createAnalysisCheckpoint(messages);
  const same = createAnalysisCheckpoint(messages);
  const changed = createAnalysisCheckpoint([...messages, { id: 'm2', sender_type: 'CUSTOMER', content: 'My budget is AED 30000.' }]);
  assert.equal(first.hash, same.hash);
  assert.notEqual(first.hash, changed.hash);
  assert.equal(first.meaningfulMessageCount, 1);
});

test('unchanged conversation is not re-analyzed and new high-intent context is eligible', () => {
  const initial = [{ id: 'm1', sender_type: 'CUSTOMER', content: 'I need a Free Zone company quote for two visas within two weeks.' }];
  const checkpoint = createAnalysisCheckpoint(initial);
  assert.equal(shouldRunQualification({ messages: initial, existingAnalysis: checkpoint }), false);
  assert.equal(shouldRunQualification({
    messages: [...initial, { id: 'm2', sender_type: 'CUSTOMER', content: 'My AED 30000 budget is approved. Please book a consultation.' }],
    existingAnalysis: checkpoint,
  }), true);
});

test('unknown budget and timeline remain null and score is server-computed from signals', () => {
  const normalized = normalizeQualificationOutput({
    intent: 'COMPANY_FORMATION',
    service_interest: 'Free Zone Company Formation',
    summary: 'Customer asked about company formation.',
    reasons: ['CLEAR_PURCHASE_INTENT'],
    signals: {
      purchase_intent: 'EXPLICIT',
      service_fit: 'STRONG',
      decision_readiness: 'HIGH',
      pricing_request: true,
      appointment_interest: false,
      human_consultant_request: false,
      budget: { amount: 999999, currency: 'AED', evidence: 'not in the source' },
      timeline: { value: 'WITHIN_2_WEEKS', evidence: 'not in the source' },
    },
  }, 'I need help setting up a company.');

  assert.equal(normalized.budget.amount, null);
  assert.equal(normalized.timeline, null);
  const score = computeLeadScore({ signals: normalized.signals, contact: { email: null, phone: null } });
  assert.equal(score.score, 68);
  assert.equal(score.temperature, 'WARM');
  assert.ok(score.reasonCodes.includes('PURCHASE_INTENT_EXPLICIT'));
});

test('dashboard reads cannot invoke a qualification model', async () => {
  let calls = 0;
  const result = await shouldRunQualification({ messages: [], existingAnalysis: null, readOnly: true, invokeModel: async () => { calls += 1; } });
  assert.equal(result, false);
  assert.equal(calls, 0);
});

test('model invocation occurs only for an eligible persisted customer checkpoint', async () => {
  let calls = 0;
  const result = await qualifyConversation({
    messages: [{ id: 'm1', sender_type: 'CUSTOMER', content: 'Please send a company formation pricing proposal for AED 30000.' }],
    contact: { email: null, phone: null },
    invokeModel: async () => {
      calls += 1;
      return { signals: { purchase_intent: 'EXPLICIT', service_fit: 'STRONG', decision_readiness: 'HIGH', pricing_request: true, appointment_interest: false, human_consultant_request: false, budget: { amount: 30000, currency: 'AED', evidence: 'AED 30000' }, timeline: { value: null, evidence: null } } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.score, 83);
});

