import OpenAI from 'openai';
import { createGoogleGeminiProvider, GoogleGeminiProviderError } from './google-gemini-provider.js';

export const MODEL_REGISTRY = Object.freeze({
  VERTEX: Object.freeze({
    primary: 'gemini-3.7-flash',
    approved_successors: Object.freeze(['gemini-3.7-flash', 'gemini-3-flash-preview']),
    legacy_mapping: Object.freeze({
      'gemini-2.5-pro': 'gemini-3.7-flash',
      'gemini-2.5-flash': 'gemini-3.7-flash',
      'gemini-1.5-flash': 'gemini-3.7-flash',
      'gemini-1.5-pro': 'gemini-3.7-flash',
      'gemini-3-flash-preview': 'gemini-3.7-flash',
    }),
  }),
  OPENAI: Object.freeze({
    secondary: 'gpt-4o-mini',
    approved_successors: Object.freeze(['gpt-4o-mini', 'gpt-4o']),
    legacy_mapping: Object.freeze({
      'gpt-3.5-turbo': 'gpt-4o-mini',
      'gpt-4': 'gpt-4o',
      'gpt-4-turbo': 'gpt-4o',
    }),
  }),
});

export const AI_PROVIDER_CAPABILITIES = Object.freeze({
  CONVERSATIONAL_TEXT: 'CONVERSATIONAL_TEXT',
  STRUCTURED_TEXT: 'STRUCTURED_TEXT',
  IMAGE_UNDERSTANDING_STRUCTURED: 'IMAGE_UNDERSTANDING_STRUCTURED',
  EMBEDDING: 'EMBEDDING',
  IMAGE_GENERATION: 'IMAGE_GENERATION',
});

const IMMEDIATE_CIRCUIT_FAILURES = new Set([
  'PROVIDER_AUTHENTICATION_FAILED',
  'PROVIDER_PERMISSION_DENIED',
]);

const FAILOVER_ELIGIBLE_FAILURES = new Set([
  'PROVIDER_AUTHENTICATION_FAILED',
  'PROVIDER_PERMISSION_DENIED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_NETWORK_ERROR',
  'PROVIDER_CAPACITY_UNAVAILABLE',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_INTERNAL_ERROR',
  'MODEL_UNAVAILABLE',
  'EMPTY_RESPONSE',
  'CIRCUIT_BREAKER_OPEN',
]);

export class AllAiProvidersFailedError extends Error {
  constructor(message = 'All AI providers failed to generate a response', options = {}) {
    super(message, options);
    this.name = 'AllAiProvidersFailedError';
    this.code = 'ALL_AI_PROVIDERS_FAILED';
    this.status = 502;
    if (options.safeMetadata) {
      this.safeMetadata = Object.freeze({ ...options.safeMetadata });
    }
  }
}

export function resolveCanonicalPlatformModel({ model = null, provider = 'VERTEX' } = {}) {
  const provKey = String(provider || 'VERTEX').toUpperCase();
  const reg = MODEL_REGISTRY[provKey] || MODEL_REGISTRY.VERTEX;
  if (!model || typeof model !== 'string') {
    return provKey === 'OPENAI' ? reg.secondary : reg.primary;
  }
  const clean = model.trim();
  if (reg.legacy_mapping[clean]) {
    return reg.legacy_mapping[clean];
  }
  if (reg.approved_successors.includes(clean)) {
    return clean;
  }
  return provKey === 'OPENAI' ? reg.secondary : reg.primary;
}

export function classifyAiProviderError(error, provider = 'VERTEX') {
  if (!error) return 'UNKNOWN';
  const code = String(error?.code || '').trim();
  const status = Number(error?.status ?? error?.statusCode ?? error?.httpStatus ?? error?.response?.status ?? error?.safeMetadata?.http_status);
  const msg = String(error?.message || error?.details || error?.cause?.message || '');

  if (error?.name === 'AbortError' || /request was aborted|operation was aborted|aborted/i.test(msg)) {
    if (/timeout|deadline exceeded/i.test(msg) || code === 'GOOGLE_GEMINI_TIMEOUT') {
      return 'PROVIDER_TIMEOUT';
    }
    return 'PROVIDER_REQUEST_ABORTED';
  }
  if (/timeout|deadline exceeded/i.test(msg) || code === 'GOOGLE_GEMINI_TIMEOUT' || code === 'ETIMEDOUT') {
    return 'PROVIDER_TIMEOUT';
  }
  if (status === 503 || /503|high demand|overloaded|service unavailable|temporarily unavailable/i.test(msg) || code === 'GOOGLE_GEMINI_CAPACITY_UNAVAILABLE') {
    return 'PROVIDER_CAPACITY_UNAVAILABLE';
  }
  if (status === 429 || /429|resource exhausted|rate limit|quota/i.test(msg) || code === 'GOOGLE_GEMINI_RATE_LIMITED') {
    return 'PROVIDER_RATE_LIMITED';
  }
  if (status === 404 || /404|not found|no longer available|is not found/i.test(msg) || code === 'GOOGLE_GEMINI_MODEL_UNAVAILABLE') {
    return 'MODEL_UNAVAILABLE';
  }
  if (status === 401 || /401|unauthenticated|invalid api key/i.test(msg) || code === 'GOOGLE_GEMINI_AUTH_FAILED' || code === 'GOOGLE_VERTEX_AUTH_FAILED') {
    return 'PROVIDER_AUTHENTICATION_FAILED';
  }
  if (status === 403 || /403|permission denied|permission was denied|forbidden|denied/i.test(msg) || code === 'GOOGLE_VERTEX_PERMISSION_DENIED') {
    return 'PROVIDER_PERMISSION_DENIED';
  }
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code.toUpperCase())
    || /ECONNRESET|ENOTFOUND|fetch failed|network|socket/i.test(msg)) {
    return 'PROVIDER_NETWORK_ERROR';
  }
  if (/empty response|empty text|no usable response|no text returned/i.test(msg) || code === 'EMPTY_RESPONSE') {
    return 'EMPTY_RESPONSE';
  }
  if (status >= 500 && status < 600) {
    return 'PROVIDER_INTERNAL_ERROR';
  }
  if (status >= 400 && status < 500) {
    return 'INVALID_RESPONSE';
  }
  return 'PROVIDER_INTERNAL_ERROR';
}

export class ProviderCircuitBreaker {
  constructor({ failureThreshold = 3, cooldownMs = 30000, logger = console } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.logger = logger;
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
  }

  getState() {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.lastFailureTime || 0);
      if (elapsed >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.logger.info?.(`CIRCUIT_BREAKER_HALF_OPEN cooldown_elapsed_ms=${elapsed}`);
      }
    }
    return this.state;
  }

  recordSuccess() {
    const prevState = this.state;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();
    this.state = 'CLOSED';
    if (prevState !== 'CLOSED') {
      this.logger.info?.(`CIRCUIT_BREAKER_RECOVERED previous_state=${prevState} new_state=CLOSED`);
    }
  }

  recordFailure(classification = 'UNKNOWN') {
    this.consecutiveFailures += 1;
    this.lastFailureTime = Date.now();
    if (IMMEDIATE_CIRCUIT_FAILURES.has(classification)
      || this.state === 'HALF_OPEN'
      || this.consecutiveFailures >= this.failureThreshold) {
      const prevState = this.state;
      this.state = 'OPEN';
      this.logger.warn?.(`CIRCUIT_BREAKER_TRIPPED previous_state=${prevState} new_state=OPEN consecutive_failures=${this.consecutiveFailures} reason=${classification}`);
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
  }
}

export function providerCircuitKey({ provider, model, capability } = {}) {
  const normalizedProvider = String(provider ?? '').trim().toUpperCase();
  const normalizedModel = String(model ?? '').trim().toLowerCase();
  const normalizedCapability = String(capability ?? '').trim().toUpperCase();
  if (!normalizedProvider || !normalizedModel || !normalizedCapability) {
    throw new TypeError('Provider circuit key requires provider, model, and capability');
  }
  return `${normalizedProvider}:${normalizedModel}:${normalizedCapability}`;
}

export class ProviderCircuitBreakerRegistry {
  constructor({ createBreaker = null, logger = console } = {}) {
    this.createBreaker = typeof createBreaker === 'function'
      ? createBreaker
      : (options) => new ProviderCircuitBreaker(options);
    this.logger = logger;
    this.breakers = new Map();
  }

  get(boundary) {
    const key = providerCircuitKey(boundary);
    if (!this.breakers.has(key)) {
      this.breakers.set(key, this.createBreaker({ logger: this.logger }));
    }
    return this.breakers.get(key);
  }

  reset(boundary = {}) {
    const hasBoundary = boundary?.provider || boundary?.model || boundary?.capability;
    if (!hasBoundary) {
      for (const breaker of this.breakers.values()) breaker.reset();
      return;
    }
    const breaker = this.breakers.get(providerCircuitKey(boundary));
    breaker?.reset();
  }
}

export const defaultAiCircuitBreakerRegistry = new ProviderCircuitBreakerRegistry();

function callerAbortError(signal) {
  const error = new Error('Request was aborted by caller', { cause: signal?.reason });
  error.name = 'AbortError';
  error.code = 'CALLER_REQUEST_ABORTED';
  return error;
}

function isApplicationFailure(error) {
  const code = String(error?.code ?? '').toUpperCase();
  return /(?:SCHEMA|VALIDATION|INPUT|GROUNDING|TENANT|AUTHORIZATION|PERSISTENCE|PROVENANCE|IDENTITY|UNSUPPORTED|CONFLICT)/.test(code);
}

function executionFailureClassification(error, provider) {
  if (error?.code === 'AI_PROVIDER_ATTEMPT_TIMEOUT') return 'PROVIDER_TIMEOUT';
  if (isApplicationFailure(error)) return 'APPLICATION_ERROR';
  return classifyAiProviderError(error, provider);
}

async function emitProviderTelemetry(telemetry, payload) {
  if (typeof telemetry !== 'function') return;
  try {
    await telemetry(Object.freeze(payload));
  } catch {
    // Observability must never change the originating domain outcome.
  }
}

async function executeProviderAttempt({ invoke, timeoutMs, signal, provider }) {
  if (signal?.aborted) throw callerAbortError(signal);
  const controller = new AbortController();
  const boundedTimeoutMs = Math.max(1, Number(timeoutMs));
  const timeoutError = new Error(`${provider} provider attempt timed out`);
  timeoutError.code = 'AI_PROVIDER_ATTEMPT_TIMEOUT';
  let timeoutId;
  let onCallerAbort;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, boundedTimeoutMs);
  });
  const races = [Promise.resolve().then(() => invoke({ signal: controller.signal })), timeoutPromise];

  if (signal) {
    races.push(new Promise((_, reject) => {
      onCallerAbort = () => {
        const abortError = callerAbortError(signal);
        controller.abort(abortError);
        reject(abortError);
      };
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }));
  }

  try {
    return await Promise.race(races);
  } finally {
    clearTimeout(timeoutId);
    if (signal && onCallerAbort) signal.removeEventListener('abort', onCallerAbort);
  }
}

export async function executeAiProviderFailover({
  operation,
  capability,
  correlationId = null,
  primary,
  secondary = null,
  primaryProvider = 'VERTEX',
  primaryModel,
  secondaryProvider = 'OPENAI',
  secondaryModel,
  primaryTimeoutMs,
  secondaryTimeoutMs,
  totalTimeoutMs,
  circuitRegistry = defaultAiCircuitBreakerRegistry,
  failoverEnabled = true,
  signal = null,
  telemetry = null,
  logger = console,
} = {}) {
  if (typeof primary !== 'function') throw new TypeError('Primary AI provider attempt is required');
  if (signal?.aborted) throw callerAbortError(signal);

  const startedAt = Date.now();
  const safeOperation = String(operation || 'AI_OPERATION').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80);
  const safeCapability = String(capability || '').trim().toUpperCase();
  const safeCorrelationId = correlationId == null ? null : String(correlationId).slice(0, 64);
  const totalBudgetMs = Math.max(1, Number(totalTimeoutMs));
  const primaryBoundary = { provider: primaryProvider, model: primaryModel, capability: safeCapability };
  const secondaryBoundary = { provider: secondaryProvider, model: secondaryModel, capability: safeCapability };
  const primaryBreaker = circuitRegistry.get(primaryBoundary);
  const baseTelemetry = {
    operation: safeOperation,
    capability: safeCapability,
    correlation_id: safeCorrelationId,
  };
  const emit = (event, extra = {}) => emitProviderTelemetry(telemetry, {
    ...baseTelemetry,
    event,
    timestamp: new Date().toISOString(),
    ...extra,
  });
  const remainingBudget = () => Math.max(0, totalBudgetMs - (Date.now() - startedAt));
  let primaryAttempted = false;
  let primaryError = null;
  let primaryClassification = null;

  if (primaryBreaker.getState() === 'OPEN') {
    primaryClassification = 'CIRCUIT_BREAKER_OPEN';
    await emit('primary_skipped', { primary_provider: String(primaryProvider).toUpperCase(), primary_classification: primaryClassification });
  } else {
    primaryAttempted = true;
    await emit('primary_attempted', { primary_provider: String(primaryProvider).toUpperCase() });
    try {
      const output = await executeProviderAttempt({
        invoke: primary,
        timeoutMs: Math.min(Number(primaryTimeoutMs), remainingBudget()),
        signal,
        provider: primaryProvider,
      });
      primaryBreaker.recordSuccess();
      await emit('primary_succeeded', {
        primary_provider: String(primaryProvider).toUpperCase(),
        selected_provider: String(primaryProvider).toUpperCase(),
        selected_model: primaryModel,
        total_duration_ms: Date.now() - startedAt,
      });
      return Object.freeze({
        output,
        provider: String(primaryProvider).toUpperCase(),
        model: primaryModel,
        primaryAttempted: true,
        fallbackAttempted: false,
        fallbackUsed: false,
        totalDurationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (signal?.aborted || error?.code === 'CALLER_REQUEST_ABORTED') throw callerAbortError(signal);
      primaryError = error;
      primaryClassification = executionFailureClassification(error, primaryProvider);
      if (!FAILOVER_ELIGIBLE_FAILURES.has(primaryClassification)) {
        await emit('terminal_error', { terminal_error_category: primaryClassification, total_duration_ms: Date.now() - startedAt });
        throw error;
      }
      primaryBreaker.recordFailure(primaryClassification);
      logger.warn?.(`AI_PROVIDER_PRIMARY_FAILED operation=${safeOperation} provider=${String(primaryProvider).toUpperCase()} classification=${primaryClassification}`);
      await emit('primary_failed', {
        primary_provider: String(primaryProvider).toUpperCase(),
        primary_classification: primaryClassification,
      });
    }
  }

  if (!failoverEnabled) {
    if (primaryError) throw primaryError;
    const error = new Error('Primary provider circuit is open and failover is disabled');
    error.code = 'CIRCUIT_BREAKER_OPEN';
    throw error;
  }

  let secondaryClassification = null;
  const secondaryBreaker = circuitRegistry.get(secondaryBoundary);
  if (typeof secondary === 'function' && secondaryBreaker.getState() !== 'OPEN' && remainingBudget() > 0) {
    await emit('fallback_attempted', {
      primary_provider: String(primaryProvider).toUpperCase(),
      primary_classification: primaryClassification,
      fallback_provider: String(secondaryProvider).toUpperCase(),
    });
    try {
      const output = await executeProviderAttempt({
        invoke: secondary,
        timeoutMs: Math.min(Number(secondaryTimeoutMs), remainingBudget()),
        signal,
        provider: secondaryProvider,
      });
      secondaryBreaker.recordSuccess();
      await emit('fallback_succeeded', {
        primary_provider: String(primaryProvider).toUpperCase(),
        primary_classification: primaryClassification,
        fallback_provider: String(secondaryProvider).toUpperCase(),
        selected_provider: String(secondaryProvider).toUpperCase(),
        selected_model: secondaryModel,
        total_duration_ms: Date.now() - startedAt,
      });
      return Object.freeze({
        output,
        provider: String(secondaryProvider).toUpperCase(),
        model: secondaryModel,
        primaryAttempted,
        fallbackAttempted: true,
        fallbackUsed: true,
        failoverFrom: String(primaryProvider).toUpperCase(),
        failoverReason: primaryClassification,
        totalDurationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (signal?.aborted || error?.code === 'CALLER_REQUEST_ABORTED') throw callerAbortError(signal);
      secondaryClassification = executionFailureClassification(error, secondaryProvider);
      if (!FAILOVER_ELIGIBLE_FAILURES.has(secondaryClassification)) {
        await emit('terminal_error', { terminal_error_category: secondaryClassification, total_duration_ms: Date.now() - startedAt });
        throw error;
      }
      secondaryBreaker.recordFailure(secondaryClassification);
      logger.error?.(`AI_PROVIDER_FALLBACK_FAILED operation=${safeOperation} provider=${String(secondaryProvider).toUpperCase()} classification=${secondaryClassification}`);
    }
  } else {
    secondaryClassification = secondaryBreaker.getState() === 'OPEN'
      ? 'CIRCUIT_BREAKER_OPEN'
      : (remainingBudget() <= 0 ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE');
  }

  await emit('fallback_failed', {
    primary_provider: String(primaryProvider).toUpperCase(),
    primary_classification: primaryClassification,
    fallback_provider: String(secondaryProvider).toUpperCase(),
    fallback_classification: secondaryClassification,
    terminal_error_category: 'ALL_AI_PROVIDERS_FAILED',
    total_duration_ms: Date.now() - startedAt,
  });
  throw new AllAiProvidersFailedError('Both primary and secondary AI providers are unavailable', {
    cause: primaryError,
    safeMetadata: {
      operation: safeOperation,
      capability: safeCapability,
      primaryProvider: String(primaryProvider).toUpperCase(),
      primaryModel,
      primaryClassification,
      secondaryProvider: String(secondaryProvider).toUpperCase(),
      secondaryModel,
      secondaryClassification,
      totalDurationMs: Date.now() - startedAt,
    },
  });
}

export const defaultAiCircuitBreaker = new ProviderCircuitBreaker();

function normalizeSystemInstructionText(systemInstruction) {
  if (!systemInstruction) return '';
  if (typeof systemInstruction === 'string') return systemInstruction.trim();
  if (Array.isArray(systemInstruction?.parts)) {
    return systemInstruction.parts.map((p) => (typeof p === 'string' ? p : (p?.text || ''))).filter(Boolean).join('\n\n').trim();
  }
  return '';
}

function normalizeUserPromptText(prompt, text, userMessage) {
  if (typeof prompt === 'string' && prompt.trim()) return prompt.trim();
  if (typeof text === 'string' && text.trim()) return text.trim();
  if (typeof userMessage === 'string' && userMessage.trim()) return userMessage.trim();
  return '';
}

function extractImageInfo(part) {
  if (!part || typeof part !== 'object') return null;
  if (part.inlineData || part.inline_data) {
    const src = part.inlineData || part.inline_data;
    const mimeType = src.mimeType || src.mime_type;
    const data = src.data;
    if (mimeType && data) {
      return { mimeType: String(mimeType).trim().toLowerCase(), data: String(data).trim() };
    }
  }
  if (part.type === 'image_url') {
    const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
    if (typeof url === 'string') {
      const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(url.trim());
      if (match) {
        return { mimeType: match[1].toLowerCase(), data: match[2] };
      }
      return { url };
    }
  }
  if (part.mimeType && Buffer.isBuffer(part.buffer)) {
    return { mimeType: String(part.mimeType).trim().toLowerCase(), data: part.buffer.toString('base64') };
  }
  if (part.mimeType && typeof part.data === 'string') {
    return { mimeType: String(part.mimeType).trim().toLowerCase(), data: part.data.trim() };
  }
  return null;
}

function extractTextInfo(part) {
  if (typeof part === 'string') return part.trim();
  if (!part || typeof part !== 'object') return '';
  if (part.thought === true) return '';
  if (typeof part.text === 'string') return part.text.trim();
  if (typeof part.safeContextText === 'string') return part.safeContextText.trim();
  if (part.type === 'text' && typeof part.text === 'string') return part.text.trim();
  return '';
}

function normalizeGeminiPart(part) {
  if (typeof part === 'string') return { text: part };
  if (!part || typeof part !== 'object') return null;
  const img = extractImageInfo(part);
  if (img?.data) {
    return {
      inlineData: { mimeType: img.mimeType, data: img.data },
      inline_data: { mime_type: img.mimeType, data: img.data },
    };
  }
  const text = extractTextInfo(part);
  if (text) {
    return { text };
  }
  return null;
}

function normalizeOpenAiPart(part) {
  if (typeof part === 'string') return { type: 'text', text: part };
  if (!part || typeof part !== 'object') return null;
  const img = extractImageInfo(part);
  if (img?.data) {
    return {
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    };
  }
  if (img?.url) {
    return {
      type: 'image_url',
      image_url: { url: img.url },
    };
  }
  const text = extractTextInfo(part);
  if (text) {
    return { type: 'text', text };
  }
  return null;
}

function extractGeminiResponseText(response) {
  if (!response) return null;
  if (typeof response.structured_text === 'string' && response.structured_text.trim()) {
    return response.structured_text.trim();
  }
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  if (candidates.length > 0) {
    const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
    const textParts = parts.filter((p) => p?.thought !== true && typeof p?.text === 'string' && p.text.trim());
    if (textParts.length > 0) {
      return textParts.map((p) => p.text.trim()).join('\n\n');
    }
  }
  if (typeof response.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }
  return null;
}

function buildOpenAiMessages({
  systemInstruction,
  conversationHistory = [],
  messages = null,
  contents = null,
  prompt = '',
  multimodalParts = null,
}) {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages.map((m) => {
      if (typeof m.content === 'string') return m;
      if (Array.isArray(m.content)) {
        const normParts = m.content.map(normalizeOpenAiPart).filter(Boolean);
        return { ...m, content: normParts };
      }
      return m;
    });
  }

  const out = [];
  const sysText = normalizeSystemInstructionText(systemInstruction);
  if (sysText) {
    out.push({ role: 'system', content: sysText });
  }

  if (Array.isArray(contents) && contents.length > 0) {
    for (const item of contents) {
      const role = (item.role === 'model' || item.role === 'assistant') ? 'assistant' : 'user';
      const parts = Array.isArray(item.parts) ? item.parts : (item.parts ? [item.parts] : []);
      const openAiParts = parts.map(normalizeOpenAiPart).filter(Boolean);
      if (openAiParts.length === 0) continue;
      const hasImages = openAiParts.some((p) => p.type === 'image_url');
      if (!hasImages) {
        const combinedText = openAiParts.map((p) => p.text).filter(Boolean).join('\n\n');
        if (combinedText) {
          out.push({ role, content: combinedText });
        }
      } else {
        out.push({ role, content: openAiParts });
      }
    }
    return out;
  }

  if (Array.isArray(conversationHistory)) {
    for (const h of conversationHistory) {
      const role = (h.role === 'model' || h.role === 'assistant') ? 'assistant' : 'user';
      let content = '';
      if (Array.isArray(h.parts)) {
        content = h.parts.map(extractTextInfo).filter(Boolean).join('\n\n').trim();
      } else if (typeof h.content === 'string') {
        content = h.content.trim();
      }
      if (content) {
        out.push({ role, content });
      }
    }
  }

  const currentText = String(prompt || '').trim();
  const extraParts = Array.isArray(multimodalParts) ? multimodalParts : (multimodalParts ? [multimodalParts] : []);
  const userParts = [];
  if (currentText) {
    userParts.push({ type: 'text', text: currentText });
  }
  for (const p of extraParts) {
    const norm = normalizeOpenAiPart(p);
    if (norm) userParts.push(norm);
  }

  if (userParts.length > 0) {
    const hasImages = userParts.some((p) => p.type === 'image_url');
    if (!hasImages) {
      const joined = userParts.map((p) => p.text).filter(Boolean).join('\n\n');
      if (joined) {
        const last = out[out.length - 1];
        if (!last || last.role !== 'user' || last.content !== joined) {
          out.push({ role: 'user', content: joined });
        }
      }
    } else {
      out.push({ role: 'user', content: userParts });
    }
  }

  return out.length > 0 ? out : [{ role: 'user', content: 'Merhaba' }];
}

function buildGeminiContents({
  conversationHistory = [],
  contents = null,
  messages = null,
  prompt = '',
  multimodalParts = null,
}) {
  if (Array.isArray(contents) && contents.length > 0) {
    return contents.map((c) => {
      const parts = Array.isArray(c.parts) ? c.parts : (c.parts ? [c.parts] : []);
      const normParts = parts.map(normalizeGeminiPart).filter(Boolean);
      return {
        role: (c.role === 'model' || c.role === 'assistant') ? 'model' : 'user',
        parts: normParts.length > 0 ? normParts : [{ text: '...' }],
      };
    });
  }

  if (Array.isArray(messages) && messages.length > 0) {
    const out = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
      const parts = [];
      if (typeof m.content === 'string') {
        if (m.content.trim()) parts.push({ text: m.content.trim() });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          const norm = normalizeGeminiPart(p);
          if (norm) parts.push(norm);
        }
      }
      if (parts.length > 0) {
        if (out.length > 0 && out[out.length - 1].role === role) {
          out[out.length - 1].parts.push(...parts);
        } else {
          out.push({ role, parts });
        }
      }
    }
    while (out.length > 0 && out[0].role === 'model') {
      out.shift();
    }
    return out.length > 0 ? out : [{ role: 'user', parts: [{ text: 'Merhaba' }] }];
  }

  const rawContents = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const h of conversationHistory) {
      const role = (h.role === 'model' || h.role === 'assistant') ? 'model' : 'user';
      const parts = [];
      if (Array.isArray(h.parts)) {
        for (const p of h.parts) {
          const norm = normalizeGeminiPart(p);
          if (norm) parts.push(norm);
        }
      } else if (typeof h.content === 'string' && h.content.trim()) {
        parts.push({ text: h.content.trim() });
      }
      if (parts.length === 0) continue;

      if (rawContents.length > 0 && rawContents[rawContents.length - 1].role === role) {
        rawContents[rawContents.length - 1].parts.push(...parts);
      } else {
        rawContents.push({ role, parts });
      }
    }
  }

  while (rawContents.length > 0 && rawContents[0].role === 'model') {
    rawContents.shift();
  }

  const currentPrompt = String(prompt || '').trim();
  const extraParts = Array.isArray(multimodalParts) ? multimodalParts : (multimodalParts ? [multimodalParts] : []);
  const userParts = [];
  if (currentPrompt) {
    userParts.push({ text: currentPrompt });
  }
  for (const p of extraParts) {
    const norm = normalizeGeminiPart(p);
    if (norm) userParts.push(norm);
  }

  if (userParts.length > 0) {
    if (rawContents.length === 0) {
      rawContents.push({ role: 'user', parts: userParts });
    } else if (rawContents[rawContents.length - 1].role === 'user') {
      rawContents[rawContents.length - 1].parts = userParts;
    } else {
      rawContents.push({ role: 'user', parts: userParts });
    }
  }

  return rawContents.length > 0 ? rawContents : [{ role: 'user', parts: [{ text: 'Merhaba' }] }];
}


export function createSharedAiRuntime({
  env = process.env,
  geminiProvider = null,
  openaiClient = null,
  circuitBreaker = defaultAiCircuitBreaker,
  fetchImpl = null,
  logger = console,
} = {}) {
  let activeGemini = geminiProvider;
  let activeOpenai = openaiClient;

  function getGemini() {
    if (!activeGemini) {
      activeGemini = createGoogleGeminiProvider({ env, fetchImpl });
    }
    return activeGemini;
  }

  function getOpenAi() {
    if (!activeOpenai) {
      const apiKey = env.OPENAI_API_KEY;
      if (apiKey) {
        activeOpenai = new OpenAI({ apiKey });
      }
    }
    return activeOpenai;
  }

  const secondaryCircuitRegistry = new ProviderCircuitBreakerRegistry({ logger });
  const runtimeCircuitRegistry = {
    get(boundary) {
      return String(boundary?.provider ?? '').toUpperCase() === 'VERTEX'
        ? circuitBreaker
        : secondaryCircuitRegistry.get(boundary);
    },
    reset(boundary = {}) {
      if (!boundary?.provider || String(boundary.provider).toUpperCase() === 'VERTEX') circuitBreaker.reset();
      secondaryCircuitRegistry.reset(boundary?.provider ? boundary : {});
    },
  };

  return {
    circuitBreaker,
    runtimeMetadata(provider = 'VERTEX') {
      const provKey = String(provider || 'VERTEX').toUpperCase();
      const resolvedModel = resolveCanonicalPlatformModel({ provider: provKey, env });
      return Object.freeze({
        provider: provKey === 'OPENAI' ? 'OPENAI' : 'GOOGLE_GEMINI',
        mode: provKey === 'OPENAI' ? 'openai' : (env.GOOGLE_GENAI_MODE?.toLowerCase() === 'vertex' ? 'vertex' : 'developer'),
        model: resolvedModel,
        endpoint_class: provKey === 'OPENAI' ? 'OPENAI_CHAT_COMPLETIONS' : (env.GOOGLE_GENAI_MODE?.toLowerCase() === 'vertex' ? 'VERTEX_GENERATE_CONTENT' : 'GEMINI_DEVELOPER_GENERATE_CONTENT'),
      });
    },

    async generateAiResponse({
      systemInstruction = null,
      prompt = null,
      text = null,
      userMessage = null,
      contents = null,
      messages = null,
      conversationHistory = null,
      multimodalParts = null,
      model = null,
      generationConfig = null,
      signal = null,
      channel = 'UNKNOWN',
      disableFailover = false,
      geminiProvider: callerGemini = null,
      openaiClient: callerOpenai = null,
    } = {}) {
      const cleanPrompt = normalizeUserPromptText(prompt, text, userMessage);
      const vertexModel = resolveCanonicalPlatformModel({ model, provider: 'VERTEX', env });
      const openaiModel = resolveCanonicalPlatformModel({ model, provider: 'OPENAI', env });

      const execution = await executeAiProviderFailover({
        operation: `CHANNEL_${String(channel || 'UNKNOWN').toUpperCase()}`,
        capability: AI_PROVIDER_CAPABILITIES.CONVERSATIONAL_TEXT,
        correlationId: null,
        primaryProvider: 'VERTEX',
        primaryModel: vertexModel,
        secondaryProvider: 'OPENAI',
        secondaryModel: openaiModel,
        primaryTimeoutMs: 12_000,
        secondaryTimeoutMs: 15_000,
        totalTimeoutMs: 28_000,
        circuitRegistry: runtimeCircuitRegistry,
        failoverEnabled: !disableFailover,
        signal,
        logger,
        primary: async ({ signal: attemptSignal }) => {
          const provider = callerGemini || getGemini();
          const geminiContents = buildGeminiContents({
            conversationHistory,
            contents,
            messages,
            prompt: cleanPrompt,
            multimodalParts,
          });
          const sysInstrText = normalizeSystemInstructionText(systemInstruction);
          const geminiResponse = await provider.generateContent({
            model: vertexModel,
            contents: geminiContents,
            systemInstruction: sysInstrText ? { parts: [{ text: sysInstrText }] } : undefined,
            generationConfig,
            signal: attemptSignal,
          });
          const extractedText = extractGeminiResponseText(geminiResponse);
          if (!extractedText || !extractedText.trim()) {
            const error = new Error('Gemini returned an empty response');
            error.code = 'EMPTY_RESPONSE';
            error.status = 502;
            throw error;
          }
          return extractedText;
        },
        secondary: async ({ signal: attemptSignal }) => {
          const openai = callerOpenai || getOpenAi();
          if (!openai?.chat?.completions?.create) {
            const error = new Error('OpenAI secondary provider is unavailable');
            error.code = 'OPENAI_PROVIDER_UNAVAILABLE';
            throw error;
          }
          const openAiMessages = buildOpenAiMessages({
            systemInstruction,
            conversationHistory,
            messages,
            contents,
            prompt: cleanPrompt,
            multimodalParts,
          });
          const completion = await openai.chat.completions.create({
            model: openaiModel,
            messages: openAiMessages,
            ...(generationConfig?.temperature !== undefined ? { temperature: generationConfig.temperature } : {}),
            ...(generationConfig?.maxOutputTokens ? { max_tokens: generationConfig.maxOutputTokens } : {}),
          }, { signal: attemptSignal });
          const openAiText = completion?.choices?.[0]?.message?.content?.trim();
          if (!openAiText) {
            const error = new Error('OpenAI returned an empty response');
            error.code = 'EMPTY_RESPONSE';
            error.status = 502;
            throw error;
          }
          return openAiText;
        },
      });

      if (execution.provider === 'VERTEX') {
        return {
          text: execution.output,
          model: execution.model,
          provider: 'vertex',
          canonicalSharedRuntime: true,
          providerSuccess: true,
          fallbackUsed: false,
          channel,
        };
      }

      return {
        text: execution.output,
        model: execution.model,
        provider: 'openai',
        canonicalSharedRuntime: true,
        providerSuccess: true,
        fallbackUsed: true,
        failoverFrom: 'vertex',
        failoverReason: execution.failoverReason,
        channel,
      };
    },
  };
}

export const canonicalSharedAiRuntime = createSharedAiRuntime();

