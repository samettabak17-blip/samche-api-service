const DEFAULT_TIMEOUT_MS = 20_000;

const BUSINESS_PROFILE_FIELDS = Object.freeze([
  'schema_version', 'company_identity', 'company_display_name',
  'company_summary', 'industry', 'business_type', 'products', 'services', 'packages',
  'faq_themes', 'pricing_information', 'policies', 'procedures',
  'operating_information', 'sales_information', 'support_escalation_rules',
  'tone', 'communication_style', 'customer_handling', 'terminology',
  'supported_languages', 'unsupported_claims',
]);

const ASSISTANT_CONFIGURATION_FIELDS = Object.freeze([
  'schema_version', 'assistant_identity', 'role_and_purpose',
  'company_context', 'assistant_instructions', 'tone', 'greeting', 'customer_handling',
  'faq_guidance', 'qualification_guidance', 'fallback_guidance',
  'escalation_guidance', 'sales_guidance', 'prohibited_claims',
  'follow_up_behavior', 'scheduled_messaging_behavior', 'supported_languages',
  'language_selection_policy', 'unsupported_claim_behavior', 'terminology',
  'operating_rules', 'channel_adaptations',
]);

const ASSISTANT_RECOMMENDATION_FIELDS = Object.freeze([
  ...ASSISTANT_CONFIGURATION_FIELDS,
  'recommendation_rationale', 'evidence_gaps',
]);

const BUSINESS_IDENTITY_ANALYSIS_FIELDS = Object.freeze(['detected_identity', 'confidence', 'evidence']);

export class KnowledgeGenerationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

export function getKnowledgeGenerationConfig(env = process.env) {
  const provider = String(env.KNOWLEDGE_GENERATION_PROVIDER || 'GEMINI').trim().toUpperCase();
  if (!['GEMINI', 'OPENAI'].includes(provider)) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_PROVIDER_INVALID', 'Knowledge generation provider is invalid');
  }
  const defaultModel = provider === 'GEMINI' ? 'gemini-3-flash-preview' : 'gpt-5-mini';
  const timeoutMs = Number(env.KNOWLEDGE_GENERATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_TIMEOUT_INVALID', 'Knowledge generation timeout is invalid');
  }
  return {
    provider,
    model: String(env.KNOWLEDGE_GENERATION_MODEL || defaultModel).trim(),
    timeoutMs,
  };
}

function responseSchema(fields) {
  return {
    type: 'OBJECT',
    properties: Object.fromEntries(fields.map((field) => [field, field === 'schema_version'
      ? { type: 'INTEGER' }
      : { anyOf: [{ type: 'STRING' }, { type: 'ARRAY', items: { type: 'STRING' } }] }])),
  };
}

function validateOutput(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation output must be an object');
  }
  const allowed = new Set(fields);
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key]) => !allowed.has(key))) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation output contains unsupported fields');
  }
  const normalized = {};
  for (const [key, item] of entries) {
    if (key === 'schema_version') {
      if (item !== 2) throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation schema version is invalid');
      normalized[key] = 2;
      continue;
    }
    if (typeof item === 'string') {
      const text = item.trim();
      if (!text || text.length > 4000) throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation field is invalid');
      normalized[key] = text;
      continue;
    }
    if (Array.isArray(item) && item.length <= 50 && item.every((entry) => typeof entry === 'string' && entry.trim() && entry.trim().length <= 1000)) {
      normalized[key] = item.map((entry) => entry.trim());
      continue;
    }
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation field is invalid');
  }
  return normalized;
}

export function validateBusinessProfileOutput(value) {
  return validateOutput(value, BUSINESS_PROFILE_FIELDS);
}

export function validateAssistantRecommendationOutput(value) {
  return validateOutput(value, ASSISTANT_RECOMMENDATION_FIELDS);
}

export function validateAssistantConfigurationOutput(value) {
  return validateOutput(value, ASSISTANT_CONFIGURATION_FIELDS);
}

function parseJson(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_RESPONSE_INVALID', 'Knowledge generation returned no usable response');
  }
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (cause) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_RESPONSE_INVALID', 'Knowledge generation returned invalid JSON', { cause });
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export function createKnowledgeGenerationProvider({ env = process.env, fetchImpl = globalThis.fetch, openaiClient = null } = {}) {
  const config = getKnowledgeGenerationConfig(env);

  async function generate({ prompt, fields, validate, thinkingLevel = null }) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_INPUT_REQUIRED', 'Knowledge generation input is required');
    }
    const timeout = timeoutSignal(config.timeoutMs);
    try {
      let text;
      if (config.provider === 'GEMINI') {
        if (!env.GEMINI_API_KEY || typeof fetchImpl !== 'function') {
          throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_PROVIDER_UNAVAILABLE', 'Gemini knowledge generation is unavailable');
        }
        const response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: timeout.signal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt.trim() }] }],
              generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: responseSchema(fields),
                ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
              },
            }),
          },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_PROVIDER_FAILED', `Gemini knowledge generation failed with status ${response.status}`);
        text = body?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('');
      } else {
        if (!env.OPENAI_API_KEY || !openaiClient?.chat?.completions?.create) {
          throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_PROVIDER_UNAVAILABLE', 'OpenAI knowledge generation is unavailable');
        }
        const completion = await openaiClient.chat.completions.create({
          model: config.model,
          temperature: 0,
          messages: [{ role: 'user', content: prompt.trim() }],
          response_format: { type: 'json_object' },
        }, { signal: timeout.signal });
        text = completion?.choices?.[0]?.message?.content;
      }
      return validate(parseJson(text));
    } catch (error) {
      if (error instanceof KnowledgeGenerationError) throw error;
      if (timeout.signal.aborted || error?.name === 'AbortError') {
        throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_TIMEOUT', 'Knowledge generation timed out', { cause: error });
      }
      throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_PROVIDER_FAILED', 'Knowledge generation failed', { cause: error });
    } finally {
      timeout.clear();
    }
  }

  return Object.freeze({
    provider: config.provider,
    model: config.model,
    timeoutMs: config.timeoutMs,
    assistantGenerationPolicy: config.provider === 'GEMINI'
      ? 'gemini-structured-v2:thinking-low'
      : 'openai-structured-v2',
    generateBusinessProfile: ({ prompt }) => generate({ prompt, fields: BUSINESS_PROFILE_FIELDS, validate: validateBusinessProfileOutput }),
    generateBusinessIdentityAnalysis: ({ source }) => generate({
      prompt: [
        'Extract the legal or clearly presented company identity from this single tenant source.',
        'Do not infer a company from platform branding. Return detected_identity, confidence as a decimal string from 0 to 1, and a short source-derived evidence statement.',
        `SOURCE ${source.id} — ${source.title}\n${String(source.content).slice(0, 12000)}`,
      ].join('\n\n'),
      fields: BUSINESS_IDENTITY_ANALYSIS_FIELDS,
      validate: (value) => validateOutput(value, BUSINESS_IDENTITY_ANALYSIS_FIELDS),
    }),
    generateAssistantRecommendation: ({ prompt }) => generate({ prompt, fields: ASSISTANT_RECOMMENDATION_FIELDS, validate: validateAssistantRecommendationOutput, thinkingLevel: config.provider === 'GEMINI' ? 'low' : null }),
    generateAssistantConfiguration: ({ prompt }) => generate({ prompt, fields: ASSISTANT_CONFIGURATION_FIELDS, validate: validateAssistantConfigurationOutput, thinkingLevel: config.provider === 'GEMINI' ? 'low' : null }),
  });
}
