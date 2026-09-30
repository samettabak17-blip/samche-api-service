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
  if (/ECONNRESET|ENOTFOUND|fetch failed|network|socket/i.test(msg)) {
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
      const cbState = circuitBreaker.getState();
      let vertexError = null;
      let vertexClassification = null;

      // Check if upstream caller already aborted before initiating work
      if (signal?.aborted) {
        const callerAbortErr = signal.reason || new Error('Request was aborted by caller');
        callerAbortErr.name = 'AbortError';
        throw callerAbortErr;
      }

      // 1. PRIMARY PROVIDER: Vertex AI / Google Gemini (if circuit is NOT OPEN)
      if (cbState !== 'OPEN') {
        const primaryController = new AbortController();
        const primaryTimeoutId = setTimeout(() => primaryController.abort(new Error('Vertex primary timeout exceeded')), 12000);
        const onCallerAbortPrimary = () => primaryController.abort(signal?.reason || new Error('Request was aborted by caller'));
        if (signal) {
          signal.addEventListener('abort', onCallerAbortPrimary, { once: true });
        }

        try {
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
            signal: primaryController.signal,
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
        } finally {
          clearTimeout(primaryTimeoutId);
          if (signal) {
            signal.removeEventListener('abort', onCallerAbortPrimary);
          }
        }
      } else {
        vertexClassification = 'CIRCUIT_BREAKER_OPEN';
        logger.warn?.(`SHARED_AI_PRIMARY_CIRCUIT_OPEN channel=${channel} model=${vertexModel}`);
      }

      // If caller aborted or failover is explicitly disabled:
      if (signal?.aborted) {
        const callerAbortErr = signal.reason || new Error('Request was aborted by caller');
        callerAbortErr.name = 'AbortError';
        throw callerAbortErr;
      }

      if (disableFailover) {
        if (vertexError) throw vertexError;
        const cbErr = new Error('Circuit breaker is open and failover is disabled');
        cbErr.code = 'CIRCUIT_BREAKER_OPEN';
        throw cbErr;
      }


      // 2. SECONDARY PROVIDER: OpenAI Automatic Failover with a FRESH unpoisoned controller
      const openaiModel = resolveCanonicalPlatformModel({ model, provider: 'OPENAI', env });
      const openai = callerOpenai || getOpenAi();

      if (openai) {
        const secondaryController = new AbortController();
        const secondaryTimeoutId = setTimeout(() => secondaryController.abort(new Error('OpenAI secondary timeout exceeded')), 15000);
        const onCallerAbortSecondary = () => secondaryController.abort(signal?.reason || new Error('Request was aborted by caller'));
        if (signal) {
          signal.addEventListener('abort', onCallerAbortSecondary, { once: true });
        }

        try {
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
          }, { signal: secondaryController.signal });

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
        } finally {
          clearTimeout(secondaryTimeoutId);
          if (signal) {
            signal.removeEventListener('abort', onCallerAbortSecondary);
          }
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

