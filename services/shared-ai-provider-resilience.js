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
  const status = Number(error?.status ?? error?.statusCode ?? error?.code ?? error?.httpStatus ?? error?.response?.status ?? error?.safeMetadata?.http_status);
  const msg = String(error?.message || error?.details || error?.cause?.message || '');

  if (error?.name === 'AbortError' || /timeout|deadline exceeded/i.test(msg)) {
    return 'PROVIDER_TIMEOUT';
  }
  if (status === 503 || /503|high demand|overloaded|service unavailable|temporarily unavailable/i.test(msg)) {
    return 'PROVIDER_CAPACITY_UNAVAILABLE';
  }
  if (status === 429 || /429|resource exhausted|rate limit|quota/i.test(msg)) {
    return 'PROVIDER_RATE_LIMITED';
  }
  if (status === 404 || /404|not found|no longer available|is not found/i.test(msg)) {
    return 'MODEL_UNAVAILABLE';
  }
  if (status === 401 || status === 403 || /401|403|unauthenticated|permission denied|forbidden/i.test(msg)) {
    return 'PROVIDER_PERMISSION_DENIED';
  }
  if (/ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return 'PROVIDER_NETWORK_ERROR';
  }
  if (/empty response|empty text|no usable response|no text returned/i.test(msg)) {
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
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
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

export const defaultAiCircuitBreaker = new ProviderCircuitBreaker();

function normalizeSystemInstructionText(systemInstruction) {
  if (!systemInstruction) return '';
  if (typeof systemInstruction === 'string') return systemInstruction.trim();
  if (Array.isArray(systemInstruction?.parts)) {
    return systemInstruction.parts.map((p) => p?.text || '').filter(Boolean).join('\n\n').trim();
  }
  return '';
}

function normalizeUserPromptText(prompt, text, userMessage) {
  if (typeof prompt === 'string' && prompt.trim()) return prompt.trim();
  if (typeof text === 'string' && text.trim()) return text.trim();
  if (typeof userMessage === 'string' && userMessage.trim()) return userMessage.trim();
  return '';
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
  prompt = '',
  multimodalParts = null,
}) {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages;
  }
  const out = [];
  const sysText = normalizeSystemInstructionText(systemInstruction);
  if (sysText) {
    out.push({ role: 'system', content: sysText });
  }

  if (Array.isArray(conversationHistory)) {
    for (const h of conversationHistory) {
      const role = (h.role === 'model' || h.role === 'assistant') ? 'assistant' : 'user';
      let content = '';
      if (Array.isArray(h.parts)) {
        content = h.parts.map((p) => p?.text || '').filter(Boolean).join('\n\n').trim();
      } else if (typeof h.content === 'string') {
        content = h.content.trim();
      }
      if (content) {
        out.push({ role, content });
      }
    }
  }

  const currentText = prompt.trim();
  if (currentText) {
    const last = out[out.length - 1];
    if (!last || last.role !== 'user' || last.content !== currentText) {
      out.push({ role: 'user', content: currentText });
    }
  }

  return out;
}

function buildGeminiContents({
  conversationHistory = [],
  contents = null,
  prompt = '',
  multimodalParts = null,
}) {
  if (Array.isArray(contents) && contents.length > 0) {
    return contents;
  }
  const rawContents = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const h of conversationHistory) {
      const role = (h.role === 'model' || h.role === 'assistant') ? 'model' : 'user';
      let turnText = '';
      if (Array.isArray(h.parts)) {
        turnText = h.parts.map((p) => p?.text || '').filter(Boolean).join('\n\n').trim();
      } else if (typeof h.content === 'string') {
        turnText = h.content.trim();
      }
      if (!turnText) continue;

      if (rawContents.length > 0 && rawContents[rawContents.length - 1].role === role) {
        rawContents[rawContents.length - 1].parts[0].text += '\n\n' + turnText;
      } else {
        rawContents.push({ role, parts: [{ text: turnText }] });
      }
    }
  }

  while (rawContents.length > 0 && rawContents[0].role === 'model') {
    rawContents.shift();
  }

  const currentPrompt = String(prompt || '').trim();
  const extraParts = Array.isArray(multimodalParts) ? multimodalParts : (multimodalParts ? [multimodalParts] : []);
  const parts = currentPrompt ? [{ text: currentPrompt }, ...extraParts] : extraParts;

  if (parts.length > 0) {
    if (rawContents.length === 0) {
      rawContents.push({ role: 'user', parts });
    } else if (rawContents[rawContents.length - 1].role === 'user') {
      rawContents[rawContents.length - 1].parts = parts;
    } else {
      rawContents.push({ role: 'user', parts });
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
    } = {}) {
      const cleanPrompt = normalizeUserPromptText(prompt, text, userMessage);
      const vertexModel = resolveCanonicalPlatformModel({ model, provider: 'VERTEX', env });
      const cbState = circuitBreaker.getState();
      let vertexError = null;
      let vertexClassification = null;

      // 1. PRIMARY PROVIDER: Vertex AI / Google Gemini (if circuit is NOT OPEN)
      if (cbState !== 'OPEN') {
        try {
          const provider = getGemini();
          const geminiContents = buildGeminiContents({
            conversationHistory,
            contents,
            prompt: cleanPrompt,
            multimodalParts,
          });
          const sysInstrText = normalizeSystemInstructionText(systemInstruction);

          const geminiResponse = await provider.generateContent({
            model: vertexModel,
            contents: geminiContents,
            systemInstruction: sysInstrText ? { parts: [{ text: sysInstrText }] } : undefined,
            generationConfig,
            signal,
          });

          const extractedText = extractGeminiResponseText(geminiResponse);
          if (!extractedText || !extractedText.trim()) {
            const emptyErr = new Error('Gemini returned an empty response');
            emptyErr.code = 'EMPTY_RESPONSE';
            emptyErr.status = 502;
            throw emptyErr;
          }

          circuitBreaker.recordSuccess();
          return {
            text: extractedText,
            model: vertexModel,
            provider: 'vertex',
            canonicalSharedRuntime: true,
            providerSuccess: true,
            fallbackUsed: false,
            channel,
          };
        } catch (err) {
          vertexError = err;
          vertexClassification = classifyAiProviderError(err, 'VERTEX');
          circuitBreaker.recordFailure(vertexClassification);
          logger.warn?.(`SHARED_AI_PRIMARY_FAILURE channel=${channel} model=${vertexModel} classification=${vertexClassification} err=${err?.message}`);
        }
      } else {
        vertexClassification = 'CIRCUIT_BREAKER_OPEN';
        logger.warn?.(`SHARED_AI_PRIMARY_CIRCUIT_OPEN channel=${channel} model=${vertexModel}`);
      }

      // If failover is explicitly disabled, rethrow Vertex error
      if (disableFailover) {
        if (vertexError) throw vertexError;
        const cbErr = new Error('Circuit breaker is open and failover is disabled');
        cbErr.code = 'CIRCUIT_BREAKER_OPEN';
        throw cbErr;
      }


      // 2. SECONDARY PROVIDER: OpenAI Automatic Failover
      const openaiModel = resolveCanonicalPlatformModel({ model, provider: 'OPENAI', env });
      const openai = getOpenAi();

      if (openai) {
        try {
          const openAiMessages = buildOpenAiMessages({
            systemInstruction,
            conversationHistory,
            messages,
            prompt: cleanPrompt,
            multimodalParts,
          });

          const completion = await openai.chat.completions.create({
            model: openaiModel,
            messages: openAiMessages,
            ...(generationConfig?.temperature !== undefined ? { temperature: generationConfig.temperature } : {}),
            ...(generationConfig?.maxOutputTokens ? { max_tokens: generationConfig.maxOutputTokens } : {}),
          }, signal ? { signal } : undefined);

          const openAiText = completion?.choices?.[0]?.message?.content?.trim();
          if (!openAiText) {
            const emptyErr = new Error('OpenAI returned an empty response');
            emptyErr.code = 'EMPTY_RESPONSE';
            emptyErr.status = 502;
            throw emptyErr;
          }

          logger.info?.(`SHARED_AI_FAILOVER_SUCCESS channel=${channel} primary=vertex failover=openai failover_model=${openaiModel} reason=${vertexClassification}`);

          return {
            text: openAiText,
            model: openaiModel,
            provider: 'openai',
            canonicalSharedRuntime: true,
            providerSuccess: true,
            fallbackUsed: false,
            failoverFrom: 'vertex',
            failoverReason: vertexClassification,
            channel,
          };
        } catch (openaiErr) {
          const openaiClassification = classifyAiProviderError(openaiErr, 'OPENAI');
          logger.error?.(`SHARED_AI_FAILOVER_FAILURE channel=${channel} provider=openai classification=${openaiClassification} err=${openaiErr?.message}`);
        }
      } else {
        logger.warn?.(`SHARED_AI_OPENAI_UNAVAILABLE channel=${channel} reason=NO_API_KEY`);
      }

      // 3. BOTH PROVIDERS FAILED — NO STATIC CUSTOMER FAKE AI
      throw new AllAiProvidersFailedError('Both primary Vertex and secondary OpenAI providers failed to generate a response', {
        cause: vertexError,
        safeMetadata: {
          channel,
          vertexModel,
          openaiModel,
          vertexClassification,
        },
      });
    },
  };
}

export const canonicalSharedAiRuntime = createSharedAiRuntime();

