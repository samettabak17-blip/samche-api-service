import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';

const DEFAULT_MODE = 'developer';
const ALLOWED_MODES = new Set(['developer', 'vertex']);
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_RUNTIME_MODEL = 'gemini-3-flash-preview';

export class GoogleGeminiProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'GoogleGeminiProviderError';
    this.code = code;
    if (options.safeMetadata) this.safeMetadata = Object.freeze({ ...options.safeMetadata });
  }
}

function requiredString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getGoogleGeminiConfig(env = process.env) {
  const mode = String(env.GOOGLE_GENAI_MODE || DEFAULT_MODE).trim().toLowerCase();
  if (!ALLOWED_MODES.has(mode)) {
    throw new GoogleGeminiProviderError('GOOGLE_GENAI_MODE_INVALID', 'GOOGLE_GENAI_MODE must be "developer" or "vertex"');
  }

  if (mode === 'developer' && !requiredString(env.GEMINI_API_KEY)) {
    throw new GoogleGeminiProviderError('GOOGLE_GEMINI_API_KEY_REQUIRED', 'GEMINI_API_KEY is required in developer mode');
  }
  if (mode === 'vertex' && !requiredString(env.GOOGLE_CLOUD_PROJECT)) {
    throw new GoogleGeminiProviderError('GOOGLE_CLOUD_PROJECT_REQUIRED', 'GOOGLE_CLOUD_PROJECT is required in vertex mode');
  }
  if (mode === 'vertex' && !requiredString(env.GOOGLE_CLOUD_LOCATION)) {
    throw new GoogleGeminiProviderError('GOOGLE_CLOUD_LOCATION_REQUIRED', 'GOOGLE_CLOUD_LOCATION is required in vertex mode');
  }

  return Object.freeze({
    mode,
    project: requiredString(env.GOOGLE_CLOUD_PROJECT),
    location: requiredString(env.GOOGLE_CLOUD_LOCATION),
    apiKey: requiredString(env.GEMINI_API_KEY),
  });
}

export function resolveGoogleGeminiRuntimeModel(env = process.env) {
  return requiredString(env.GOOGLE_GEMINI_RUNTIME_MODEL)
    || requiredString(env.WHATSAPP_GEMINI_MODEL)
    || DEFAULT_RUNTIME_MODEL;
}

function normalizePart(part) {
  if (!part || typeof part !== 'object') return part;
  if (part.inline_data) {
    return { ...part, inlineData: { mimeType: part.inline_data.mime_type, data: part.inline_data.data } };
  }
  return part;
}

function normalizeContents(contents) {
  return Array.isArray(contents)
    ? contents.map((content) => ({
      ...content,
      parts: Array.isArray(content?.parts) ? content.parts.map(normalizePart) : content?.parts,
    }))
    : contents;
}

function safeHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function looksLikeJson(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return /^[{[]/.test(trimmed);
}

function describeResponseShape(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const partSummaries = [];
  let finalTextPartCount = 0;
  let jsonLookingFinalPartCount = 0;
  let finishReason = null;
  candidates.slice(0, 8).forEach((candidate, candidateIndex) => {
    if (candidateIndex === 0 && typeof candidate?.finishReason === 'string') finishReason = candidate.finishReason;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    parts.slice(0, 32).forEach((part, partIndex) => {
      const text = typeof part?.text === 'string' ? part.text : null;
      const thought = part?.thought === true;
      const jsonLooking = !thought && looksLikeJson(text);
      if (!thought && text !== null) finalTextPartCount += 1;
      if (jsonLooking) jsonLookingFinalPartCount += 1;
      partSummaries.push({
        candidate_index: candidateIndex,
        part_index: partIndex,
        type: text !== null ? 'TEXT' : part?.inlineData ? 'INLINE_DATA' : part?.functionCall ? 'FUNCTION_CALL' : 'OTHER',
        thought,
        text_present: text !== null,
        text_length: text?.length ?? 0,
        ...(text !== null ? { text_sha256: safeHash(text) } : {}),
        ...(typeof part?.inlineData?.mimeType === 'string' ? { mime_type: part.inlineData.mimeType } : {}),
        json_looking: jsonLooking,
        markdown_fence: typeof text === 'string' && /^```(?:json)?\s*/i.test(text.trim()),
      });
    });
  });
  return {
    candidate_count: candidates.length,
    content_part_count: partSummaries.length,
    final_text_part_count: finalTextPartCount,
    json_looking_final_part_count: jsonLookingFinalPartCount,
    multiple_final_json_payload_candidates: jsonLookingFinalPartCount > 1,
    concatenation_attempted: finalTextPartCount > 1,
    canonical_payload_field: candidates.length ? 'CANDIDATES_PARTS' : typeof response?.text === 'string' ? 'RESPONSE_TEXT' : 'NONE',
    ...(finishReason ? { finish_reason: finishReason } : {}),
    part_summaries: partSummaries,
  };
}

function stripOuterJsonFence(value) {
  const trimmed = String(value ?? '').trim();
  const fenced = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function selectStructuredPayload(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  if (candidates.length) {
    const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
    const finalTextParts = parts.filter((part) => part?.thought !== true && typeof part?.text === 'string');
    if (finalTextParts.length === 0) return { text: null, error: 'EMPTY_FINAL_TEXT_PARTS' };
    // Gemini may expose multiple part categories, but a SamChe structured result
    // must be exactly one final text payload. Joining independent parts creates
    // JSON that Gemini never returned and is unsafe.
    if (finalTextParts.length > 1) return { text: null, error: 'MULTIPLE_FINAL_TEXT_PARTS' };
    return { text: stripOuterJsonFence(finalTextParts[0].text), error: null };
  }
  if (typeof response?.text === 'string') return { text: stripOuterJsonFence(response.text), error: null };
  return { text: null, error: 'NO_CANONICAL_STRUCTURED_PAYLOAD' };
}

function normalizeResponse(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const responseShape = describeResponseShape(response);
  const structuredPayload = selectStructuredPayload(response);
  if (candidates.length) {
    return {
      ...(response?.__httpStatus ? { status: response.__httpStatus } : {}),
      response_shape: responseShape,
      structured_text: structuredPayload.text,
      structured_payload_error: structuredPayload.error,
      candidates: candidates.map((candidate) => ({
      ...candidate,
      content: candidate?.content ? {
        ...candidate.content,
        // Gemini can return internal thinking parts alongside the final structured
        // answer. They are provider-private reasoning, never part of SamChe's
        // canonical JSON result, and would corrupt the final response if joined.
        parts: Array.isArray(candidate.content.parts)
          ? candidate.content.parts.filter((part) => part?.thought !== true).map((part) => ({ ...part }))
          : candidate.content.parts,
      } : candidate.content,
      })),
    };
  }
  const text = typeof response?.text === 'string' ? response.text : '';
  return text
    ? { ...(response?.__httpStatus ? { status: response.__httpStatus } : {}), response_shape: responseShape, structured_text: structuredPayload.text, structured_payload_error: structuredPayload.error, candidates: [{ content: { parts: [{ text }] } }] }
    : { response_shape: responseShape, structured_text: structuredPayload.text, structured_payload_error: structuredPayload.error, candidates: [] };
}

function safeRequestMetadata({ mode, model, status = null }) {
  return Object.freeze({
    provider: 'GOOGLE_GEMINI',
    mode,
    model,
    endpoint_class: mode === 'vertex' ? 'VERTEX_GENERATE_CONTENT' : 'GEMINI_DEVELOPER_GENERATE_CONTENT',
    ...(Number.isInteger(status) ? { http_status: status } : {}),
  });
}

function normalizeRequestError(error, mode, model) {
  const status = Number(error?.status ?? error?.code);
  const safeMetadata = safeRequestMetadata({ mode, model, status });
  if (error?.name === 'AbortError') {
    return new GoogleGeminiProviderError('GOOGLE_GEMINI_TIMEOUT', 'Google Gemini request timed out', { cause: error, safeMetadata });
  }
  if (status === 401 || status === 403) {
    return new GoogleGeminiProviderError(mode === 'vertex' ? 'GOOGLE_VERTEX_PERMISSION_DENIED' : 'GOOGLE_GEMINI_AUTH_FAILED', mode === 'vertex' ? 'Vertex AI authentication or permission was denied' : 'Gemini Developer API authentication failed', { cause: error, safeMetadata });
  }
  if (status === 404) {
    return new GoogleGeminiProviderError('GOOGLE_GEMINI_MODEL_UNAVAILABLE', `Gemini model is unavailable: ${model}`, { cause: error, safeMetadata });
  }
  if (status >= 400 && status < 500) {
    return new GoogleGeminiProviderError('GOOGLE_GEMINI_HTTP_4XX', 'Google Gemini request was rejected', { cause: error, safeMetadata });
  }
  if (mode === 'vertex' && /credential|authentication|adc|application default/i.test(String(error?.message || ''))) {
    return new GoogleGeminiProviderError('GOOGLE_VERTEX_AUTH_FAILED', 'Vertex AI Application Default Credentials are unavailable', { cause: error, safeMetadata });
  }
  return new GoogleGeminiProviderError('GOOGLE_GEMINI_REQUEST_FAILED', 'Google Gemini request failed', { cause: error, safeMetadata });
}

function createDeveloperFetchClient({ apiKey, fetchImpl }) {
  return {
    models: {
      async generateContent({ model, contents, config }) {
        const { abortSignal, ...generationConfig } = config ?? {};
        const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: abortSignal,
          body: JSON.stringify({ contents, generationConfig }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const error = new Error(`Google Gemini request failed with status ${response.status}`);
          error.status = response.status;
          throw error;
        }
        return { ...body, __httpStatus: response.status };
      },
    },
  };
}

export function createGoogleGeminiProvider({ env = process.env, clientFactory, fetchImpl = null } = {}) {
  const config = getGoogleGeminiConfig(env);
  const clientOptions = config.mode === 'vertex'
    ? { vertexai: true, project: config.project, location: config.location }
    : { apiKey: config.apiKey };
  let client;
  try {
    client = clientFactory
      ? clientFactory(clientOptions)
      : (fetchImpl ? createDeveloperFetchClient({ apiKey: config.apiKey, fetchImpl }) : new GoogleGenAI(clientOptions));
  } catch (error) {
    throw normalizeRequestError(error, config.mode, 'unknown');
  }
  if (!client?.models?.generateContent) {
    throw new GoogleGeminiProviderError('GOOGLE_GEMINI_CLIENT_INVALID', 'Google Gemini client is invalid');
  }

  return Object.freeze({
    mode: config.mode,
    runtimeMetadata() {
      return Object.freeze({
        provider: 'GOOGLE_GEMINI',
        mode: config.mode,
        model: resolveGoogleGeminiRuntimeModel(env),
        endpoint_class: config.mode === 'vertex' ? 'VERTEX_GENERATE_CONTENT' : 'GEMINI_DEVELOPER_GENERATE_CONTENT',
      });
    },
    async generateContent({ model, contents, generationConfig = undefined, systemInstruction = undefined, signal = undefined }) {
      const request = {
        model,
        contents: normalizeContents(contents),
        ...(generationConfig ? { config: { ...generationConfig } } : {}),
      };
      if (systemInstruction) request.config = { ...(request.config || {}), systemInstruction };
      if (signal) {
        request.config = { ...(request.config || {}), abortSignal: signal };
      } else {
        request.config = {
          ...(request.config || {}),
          httpOptions: {
            ...(request.config?.httpOptions || {}),
            timeout: request.config?.httpOptions?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
          },
        };
      }
      try {
        const response = await client.models.generateContent(request);
        return normalizeResponse(response);
      } catch (error) {
        throw normalizeRequestError(error, config.mode, model);
      }
    },
  });
}
