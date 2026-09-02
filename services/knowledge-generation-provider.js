import diagnosticsChannel from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';
import { validateImageKnowledgeSemanticOutput } from './image-knowledge-semantic-service.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const ASSISTANT_GENERATION_TIMEOUT_MS = 30_000;
const IMAGE_SEMANTIC_TIMEOUT_MS = 60_000;
const transportContext = new AsyncLocalStorage();
let transportTelemetryInstalled = false;

function installTransportTelemetry() {
  if (transportTelemetryInstalled) return;
  transportTelemetryInstalled = true;
  const observe = (event, message) => {
    const context = transportContext.getStore();
    if (context?.onEvent) context.onEvent(event, message);
  };
  diagnosticsChannel.channel('undici:client:beforeConnect').subscribe((message) => observe('transport_connect_started', message));
  diagnosticsChannel.channel('undici:client:connected').subscribe((message) => {
    observe('transport_connected', message);
    if (message?.connectParams?.protocol === 'https:') observe('tls_established', message);
  });
  diagnosticsChannel.channel('undici:request:bodySent').subscribe((message) => observe('request_body_sent', message));
  diagnosticsChannel.channel('undici:request:headers').subscribe((message) => observe('response_headers_received', { statusCode: message?.response?.statusCode }));
  diagnosticsChannel.channel('undici:request:error').subscribe((message) => observe('transport_error', { error: message?.error }));
}

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

function buildImageSemanticResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      classifications: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            segment_order: { type: 'INTEGER' },
            category: { type: 'STRING' },
            canonical_fact: { anyOf: [{ type: 'STRING' }, { type: 'NULL' }] },
            confidence: { type: 'NUMBER' },
          },
        },
      },
    },
  };
}

export class KnowledgeGenerationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
    if (options?.details) this.details = options.details;
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

export function buildRecommendationResponseSchema() {
  const schema = responseSchema(ASSISTANT_RECOMMENDATION_FIELDS);
  return schema;
}

function validateOutput(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation output must be an object', { details: { code: 'INVALID_FIELD_TYPE', field: null } });
  }
  const allowed = new Set(fields);
  const entries = Object.entries(value);
  if (!entries.length) {
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation output contains no supported fields', { details: { code: 'NO_RECOMMENDATION_FIELDS', field: null } });
  }
  if (entries.some(([key]) => !allowed.has(key))) {
    const field = entries.find(([key]) => !allowed.has(key))?.[0];
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation output contains unsupported fields', { details: { code: 'UNEXPECTED_FIELD', field } });
  }
  const normalized = {};
  for (const [key, item] of entries) {
    if (key === 'schema_version') {
      if (item !== 2) throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation schema version is invalid', { details: { code: 'INVALID_SCHEMA_VERSION', field: key } });
      normalized[key] = 2;
      continue;
    }
    if (typeof item === 'string') {
      const text = item.trim();
      if (!text) throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation field is invalid', { details: { code: 'EMPTY_FIELD', field: key } });
      if (text.length > 4000) throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation field is invalid', { details: { code: 'STRING_TOO_LONG', field: key } });
      normalized[key] = text;
      continue;
    }
    if (Array.isArray(item) && item.length > 0 && item.length <= 50 && item.every((entry) => typeof entry === 'string' && entry.trim() && entry.trim().length <= 1000)) {
      normalized[key] = item.map((entry) => entry.trim());
      continue;
    }
    const code = Array.isArray(item)
      ? (item.length > 50 ? 'ARRAY_TOO_LARGE' : item.some((entry) => typeof entry === 'string' && entry.trim().length > 1000) ? 'ARRAY_ITEM_TOO_LONG' : item.some((entry) => typeof entry === 'string' && !entry.trim()) ? 'EMPTY_FIELD' : 'INVALID_FIELD_TYPE')
      : 'INVALID_FIELD_TYPE';
    throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_SCHEMA_INVALID', 'Knowledge generation field is invalid', { details: { code, field: key } });
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

export function createKnowledgeGenerationProvider({ env = process.env, fetchImpl = globalThis.fetch, openaiClient = null, telemetry: telemetryImpl = null } = {}) {
  installTransportTelemetry();
  const config = getKnowledgeGenerationConfig(env);
  const telemetry = typeof telemetryImpl === 'function'
    ? telemetryImpl
    : (event) => console.log(`KNOWLEDGE_GENERATION_PROVIDER ${JSON.stringify(event)}`);

  async function generate({ prompt, fields, validate, thinkingLevel = null, timeoutMs = config.timeoutMs, runId = null, requestFingerprint = null, operation = 'KNOWLEDGE_GENERATION', telemetry: callTelemetry = null, schema = responseSchema(fields) }) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_INPUT_REQUIRED', 'Knowledge generation input is required');
    }
    const timeout = timeoutSignal(timeoutMs);
    const startedAt = Date.now();
    const correlation = typeof requestFingerprint === 'string' ? requestFingerprint.slice(0, 16) : null;
    const telemetrySinks = [telemetry, ...(typeof callTelemetry === 'function' ? [callTelemetry] : [])];
    const pendingTelemetry = [];
    const emit = (event, extra = {}) => {
      const payload = { event, run_id: runId, operation, provider: config.provider, model: config.model, correlation, timestamp: new Date().toISOString(), ...extra };
      for (const sink of telemetrySinks) pendingTelemetry.push(Promise.resolve().then(() => sink(payload)));
    };
    const flushTelemetry = async () => { await Promise.allSettled(pendingTelemetry); };
    const fetchWithTransportTelemetry = (...args) => transportContext.run({
      onEvent: (event, message = {}) => emit(event, {
        ...(message.statusCode ? { http_status: message.statusCode } : {}),
        ...(event === 'transport_error' ? { classification: 'TRANSPORT_ERROR' } : {}),
      }),
    }, () => fetchImpl(...args));
    let responseReceived = false;
    try {
      let text;
      if (config.provider === 'GEMINI') {
        if (!env.GEMINI_API_KEY || typeof fetchImpl !== 'function') {
          throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_PROVIDER_UNAVAILABLE', 'Gemini knowledge generation is unavailable');
        }
        emit('request_started');
        const response = await fetchWithTransportTelemetry(
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
                responseSchema: schema,
                ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
              },
            }),
          },
        );
        responseReceived = true;
        emit('http_status_received', { http_status: response.status });
        emit('fetch_fulfilled', { elapsed_ms: Date.now() - startedAt });
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
      const output = validate(parseJson(text));
      await flushTelemetry();
      return output;
    } catch (error) {
      if (error instanceof KnowledgeGenerationError) throw error;
      if (timeout.signal.aborted || error?.name === 'AbortError') {
        emit('fetch_aborted', { classification: 'ABORT_TIMEOUT', elapsed_ms: Date.now() - startedAt, http_response_received: responseReceived });
        await flushTelemetry();
        throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_TIMEOUT', 'Knowledge generation timed out', { cause: error });
      }
      if (config.provider === 'GEMINI') emit('network_error', { classification: 'NETWORK_ERROR', elapsed_ms: Date.now() - startedAt });
      await flushTelemetry();
      throw new KnowledgeGenerationError('KNOWLEDGE_GENERATION_PROVIDER_FAILED', 'Knowledge generation failed', { cause: error });
    } finally {
      timeout.clear();
    }
  }

  return Object.freeze({
    provider: config.provider,
    model: config.model,
    timeoutMs: config.timeoutMs,
    businessProfileTimeoutMs: config.timeoutMs,
    identityAnalysisTimeoutMs: config.timeoutMs,
    recommendationTimeoutMs: ASSISTANT_GENERATION_TIMEOUT_MS,
    configurationTimeoutMs: ASSISTANT_GENERATION_TIMEOUT_MS,
    assistantGenerationPolicy: config.provider === 'GEMINI'
      ? 'gemini-structured-v2:thinking-low:timeout-30000'
      : 'openai-structured-v2:timeout-30000',
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
    generateAssistantRecommendation: ({ prompt, runId, requestFingerprint, telemetry: callTelemetry }) => generate({ prompt, fields: ASSISTANT_RECOMMENDATION_FIELDS, validate: validateAssistantRecommendationOutput, thinkingLevel: config.provider === 'GEMINI' ? 'low' : null, timeoutMs: ASSISTANT_GENERATION_TIMEOUT_MS, runId, requestFingerprint, operation: 'ASSISTANT_RECOMMENDATION', telemetry: callTelemetry, schema: buildRecommendationResponseSchema() }),
    generateAssistantConfiguration: ({ prompt, runId, requestFingerprint, telemetry: callTelemetry }) => generate({ prompt, fields: ASSISTANT_CONFIGURATION_FIELDS, validate: validateAssistantConfigurationOutput, thinkingLevel: config.provider === 'GEMINI' ? 'low' : null, timeoutMs: ASSISTANT_GENERATION_TIMEOUT_MS, runId, requestFingerprint, operation: 'ASSISTANT_CONFIGURATION', telemetry: callTelemetry }),
    classifyImageKnowledgeSegments: ({ segments }) => {
      const safeSegments = Array.isArray(segments) ? segments : [];
      return generate({
        prompt: [
          'Classify each statement made by a business representative. A BUSINESS speaker is an authority signal, not proof that every statement is durable company knowledge.',
          'Return one category for every segment. A mixed segment may return exactly two artifacts only when it contains both a durable fact and reusable qualification behavior: DURABLE_BUSINESS_FACT plus ASSISTANT_BEHAVIOR_OR_QUALIFICATION. Otherwise return exactly one category: DURABLE_BUSINESS_FACT, ASSISTANT_BEHAVIOR_OR_QUALIFICATION, CUSTOMER_SPECIFIC_CONTEXT, TRANSIENT_CONVERSATION, DURABLE_POLICY_OR_COMMITMENT_CANDIDATE, or UNSAFE_OR_AMBIGUOUS.',
          'For DURABLE_BUSINESS_FACT return a concise, decontextualized canonical_fact in the source language. Canonicalization may shorten, clarify grammar, and remove filler, but must not strengthen authority: never invent contracts, partnerships, guarantees, policies, commercial/legal claims, or certainty not stated in the evidence. For ASSISTANT_BEHAVIOR_OR_QUALIFICATION return a concise reusable behavior instruction in canonical_fact. Exclude greetings, timestamps, customer-specific needs, one-off promises, and conversational filler. For every other category canonical_fact must be null.',
          'Do not infer a durable policy from one occurrence. Return every supplied segment at least once and no more than twice; a second artifact is allowed only for the durable-fact plus qualification-behavior pair.',
          JSON.stringify({ segments: safeSegments }),
        ].join('\n\n'),
        fields: [],
        validate: (value) => {
          validateImageKnowledgeSemanticOutput(value, safeSegments.map((segment) => ({ id: String(segment.segment_order), segment_order: segment.segment_order, role: 'BUSINESS', normalized_text: segment.text })));
          return value;
        },
        schema: buildImageSemanticResponseSchema(),
        operation: 'IMAGE_SEMANTIC_CLASSIFICATION',
        thinkingLevel: config.provider === 'GEMINI' ? 'low' : null,
        timeoutMs: Math.max(config.timeoutMs, IMAGE_SEMANTIC_TIMEOUT_MS),
      });
    },
    imageSemanticTimeoutMs: Math.max(config.timeoutMs, IMAGE_SEMANTIC_TIMEOUT_MS),
  });
}
