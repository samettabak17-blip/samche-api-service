import { AI_PROVIDER_CAPABILITIES } from './shared-ai-provider-resilience.js';

const operation = (capability, primaryTimeoutMs, secondaryTimeoutMs, totalTimeoutMs) => Object.freeze({
  capability,
  primaryTimeoutMs,
  secondaryTimeoutMs,
  totalTimeoutMs,
});

export const DASHBOARD_AI_OPERATIONS = Object.freeze({
  BUSINESS_IDENTITY_ANALYSIS: operation(AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT, 8_000, 10_000, 20_000),
  BUSINESS_PROFILE: operation(AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT, 15_000, 15_000, 32_000),
  ASSISTANT_RECOMMENDATION: operation(AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT, 12_000, 15_000, 30_000),
  ASSISTANT_CONFIGURATION: operation(AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT, 40_000, 45_000, 90_000),
  IMAGE_SEMANTIC_CLASSIFICATION: operation(AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT, 25_000, 30_000, 60_000),
  IMAGE_KNOWLEDGE_EXTRACTION: operation(AI_PROVIDER_CAPABILITIES.IMAGE_UNDERSTANDING_STRUCTURED, 15_000, 15_000, 32_000),
  CRM_LEAD_QUALIFICATION: operation(AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT, 12_000, 15_000, 30_000),
});

export class DashboardAiProviderPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DashboardAiProviderPolicyError';
    this.code = code;
  }
}

function requireModel(value, fallback) {
  const model = value === undefined || value === null ? fallback : value;
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(model)) {
    throw new DashboardAiProviderPolicyError('DASHBOARD_AI_MODEL_INVALID', 'Dashboard AI provider model configuration is invalid');
  }
  return model;
}

function legacyProviderPolicy(env) {
  const configured = String(env.KNOWLEDGE_GENERATION_PROVIDER || 'GEMINI').trim().toUpperCase();
  if (configured !== 'GEMINI' && configured !== 'OPENAI') {
    throw new DashboardAiProviderPolicyError('DASHBOARD_AI_LEGACY_PROVIDER_INVALID', 'Legacy Dashboard AI provider configuration is invalid');
  }
  const defaultModel = configured === 'GEMINI' ? 'gemini-3-flash-preview' : 'gpt-5-mini';
  return {
    primaryProvider: configured,
    primaryModel: requireModel(env.KNOWLEDGE_GENERATION_MODEL, defaultModel),
    secondaryProvider: null,
    secondaryModel: null,
  };
}

export function getDashboardAiProviderPolicy(operationName, env = process.env) {
  const operationPolicy = DASHBOARD_AI_OPERATIONS[operationName];
  if (!operationPolicy) {
    throw new DashboardAiProviderPolicyError('DASHBOARD_AI_OPERATION_UNSUPPORTED', 'Dashboard AI operation is unsupported');
  }

  const isMultimodal = operationPolicy.capability === AI_PROVIDER_CAPABILITIES.IMAGE_UNDERSTANDING_STRUCTURED;
  const flagName = isMultimodal
    ? 'DASHBOARD_AI_MULTIMODAL_FAILOVER_ENABLED'
    : 'DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED';
  const failoverEnabled = env[flagName] === 'true';
  const providerPolicy = failoverEnabled
    ? {
        primaryProvider: 'VERTEX',
        primaryModel: 'gemini-3-flash-preview',
        secondaryProvider: 'OPENAI',
        secondaryModel: requireModel(
          isMultimodal ? env.DASHBOARD_AI_OPENAI_VISION_MODEL : env.DASHBOARD_AI_OPENAI_STRUCTURED_MODEL,
          'gpt-4o-mini',
        ),
      }
    : legacyProviderPolicy(env);

  return Object.freeze({
    operation: operationName,
    ...operationPolicy,
    failoverEnabled,
    ...providerPolicy,
  });
}
