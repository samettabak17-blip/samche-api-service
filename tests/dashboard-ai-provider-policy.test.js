import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_AI_OPERATIONS,
  DashboardAiProviderPolicyError,
  getDashboardAiProviderPolicy,
} from '../services/dashboard-ai-provider-policy.js';
import { AI_PROVIDER_CAPABILITIES } from '../services/shared-ai-provider-resilience.js';

const EXPECTED_OPERATIONS = Object.freeze({
  BUSINESS_IDENTITY_ANALYSIS: ['STRUCTURED_TEXT', 8_000, 10_000, 20_000],
  BUSINESS_PROFILE: ['STRUCTURED_TEXT', 15_000, 15_000, 32_000],
  ASSISTANT_RECOMMENDATION: ['STRUCTURED_TEXT', 12_000, 15_000, 30_000],
  ASSISTANT_CONFIGURATION: ['STRUCTURED_TEXT', 40_000, 45_000, 90_000],
  IMAGE_SEMANTIC_CLASSIFICATION: ['STRUCTURED_TEXT', 25_000, 30_000, 60_000],
  IMAGE_KNOWLEDGE_EXTRACTION: ['IMAGE_UNDERSTANDING_STRUCTURED', 15_000, 15_000, 32_000],
  CRM_LEAD_QUALIFICATION: ['STRUCTURED_TEXT', 12_000, 15_000, 30_000],
});

test('Dashboard operation policy exposes the exact approved immutable capability and timeout table', () => {
  assert.equal(Object.isFrozen(DASHBOARD_AI_OPERATIONS), true);
  assert.deepEqual(Object.keys(DASHBOARD_AI_OPERATIONS), Object.keys(EXPECTED_OPERATIONS));
  for (const [operation, [capability, primaryTimeoutMs, secondaryTimeoutMs, totalTimeoutMs]] of Object.entries(EXPECTED_OPERATIONS)) {
    const entry = DASHBOARD_AI_OPERATIONS[operation];
    assert.equal(Object.isFrozen(entry), true);
    assert.deepEqual(entry, {
      capability: AI_PROVIDER_CAPABILITIES[capability],
      primaryTimeoutMs,
      secondaryTimeoutMs,
      totalTimeoutMs,
    });
  }
});

test('Dashboard failover flags default off and accept only the exact true literal', () => {
  for (const value of [undefined, '', 'false', 'TRUE', ' true ', '1', 'yes', true]) {
    const policy = getDashboardAiProviderPolicy('ASSISTANT_RECOMMENDATION', {
      DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: value,
    });
    assert.equal(policy.failoverEnabled, false, String(value));
  }
  assert.equal(getDashboardAiProviderPolicy('ASSISTANT_RECOMMENDATION', {
    DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true',
  }).failoverEnabled, true);
});

test('structured and multimodal Dashboard rollout flags are independent', () => {
  const structuredOnly = {
    DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true',
    DASHBOARD_AI_MULTIMODAL_FAILOVER_ENABLED: 'false',
  };
  assert.equal(getDashboardAiProviderPolicy('BUSINESS_PROFILE', structuredOnly).failoverEnabled, true);
  assert.equal(getDashboardAiProviderPolicy('IMAGE_KNOWLEDGE_EXTRACTION', structuredOnly).failoverEnabled, false);

  const multimodalOnly = {
    DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'false',
    DASHBOARD_AI_MULTIMODAL_FAILOVER_ENABLED: 'true',
  };
  assert.equal(getDashboardAiProviderPolicy('BUSINESS_PROFILE', multimodalOnly).failoverEnabled, false);
  assert.equal(getDashboardAiProviderPolicy('IMAGE_KNOWLEDGE_EXTRACTION', multimodalOnly).failoverEnabled, true);
});

test('Dashboard models are platform-owned and use approved defaults', () => {
  const policy = getDashboardAiProviderPolicy('ASSISTANT_CONFIGURATION', {
    DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true',
  });
  assert.equal(policy.primaryProvider, 'VERTEX');
  assert.equal(policy.primaryModel, 'gemini-3-flash-preview');
  assert.equal(policy.secondaryProvider, 'OPENAI');
  assert.equal(policy.secondaryModel, 'gpt-4o-mini');

  assert.equal(getDashboardAiProviderPolicy('BUSINESS_PROFILE', {
    DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true',
    DASHBOARD_AI_OPENAI_STRUCTURED_MODEL: 'gpt-4o',
  }).secondaryModel, 'gpt-4o');
  assert.equal(getDashboardAiProviderPolicy('IMAGE_KNOWLEDGE_EXTRACTION', {
    DASHBOARD_AI_MULTIMODAL_FAILOVER_ENABLED: 'true',
    DASHBOARD_AI_OPENAI_VISION_MODEL: 'gpt-4o',
  }).secondaryModel, 'gpt-4o');
});

test('unknown operations and invalid platform model strings fail closed', () => {
  assert.throws(
    () => getDashboardAiProviderPolicy('NOT_AN_OPERATION', {}),
    (error) => error instanceof DashboardAiProviderPolicyError && error.code === 'DASHBOARD_AI_OPERATION_UNSUPPORTED',
  );
  for (const value of ['', ' ', 'model with spaces', 'gpt-4o\nsecret', '../model']) {
    assert.throws(
      () => getDashboardAiProviderPolicy('BUSINESS_PROFILE', {
        DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true',
        DASHBOARD_AI_OPENAI_STRUCTURED_MODEL: value,
      }),
      (error) => error instanceof DashboardAiProviderPolicyError && error.code === 'DASHBOARD_AI_MODEL_INVALID',
    );
  }
});

test('disabled failover preserves legacy single-provider Dashboard selection', () => {
  const openai = getDashboardAiProviderPolicy('BUSINESS_PROFILE', {
    KNOWLEDGE_GENERATION_PROVIDER: 'OPENAI',
    KNOWLEDGE_GENERATION_MODEL: 'gpt-5-mini',
  });
  assert.equal(openai.failoverEnabled, false);
  assert.equal(openai.primaryProvider, 'OPENAI');
  assert.equal(openai.primaryModel, 'gpt-5-mini');
  assert.equal(openai.secondaryProvider, null);
  assert.equal(openai.secondaryModel, null);

  const gemini = getDashboardAiProviderPolicy('ASSISTANT_RECOMMENDATION', {});
  assert.equal(gemini.primaryProvider, 'GEMINI');
  assert.equal(gemini.primaryModel, 'gemini-3-flash-preview');
  assert.equal(gemini.secondaryProvider, null);
});
