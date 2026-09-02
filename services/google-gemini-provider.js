import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODE = 'developer';
const ALLOWED_MODES = new Set(['developer', 'vertex']);
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

export class GoogleGeminiProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'GoogleGeminiProviderError';
    this.code = code;
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

function normalizeResponse(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  if (candidates.length) {
    return { ...(response?.__httpStatus ? { status: response.__httpStatus } : {}), candidates: candidates.map((candidate) => ({
      ...candidate,
      content: candidate?.content ? {
        ...candidate.content,
        parts: Array.isArray(candidate.content.parts) ? candidate.content.parts.map((part) => ({ ...part })) : candidate.content.parts,
      } : candidate.content,
    })) };
  }
  const text = typeof response?.text === 'string' ? response.text : '';
  return text ? { ...(response?.__httpStatus ? { status: response.__httpStatus } : {}), candidates: [{ content: { parts: [{ text }] } }] } : { candidates: [] };
}

function normalizeRequestError(error, mode, model) {
  const status = Number(error?.status ?? error?.code);
  if (error?.name === 'AbortError') {
    return new GoogleGeminiProviderError('GOOGLE_GEMINI_TIMEOUT', 'Google Gemini request timed out', { cause: error });
  }
  if (status === 401 || status === 403) {
    return new GoogleGeminiProviderError(mode === 'vertex' ? 'GOOGLE_VERTEX_PERMISSION_DENIED' : 'GOOGLE_GEMINI_AUTH_FAILED', mode === 'vertex' ? 'Vertex AI authentication or permission was denied' : 'Gemini Developer API authentication failed', { cause: error });
  }
  if (status === 404) {
    return new GoogleGeminiProviderError('GOOGLE_GEMINI_MODEL_UNAVAILABLE', `Gemini model is unavailable: ${model}`, { cause: error });
  }
  if (status >= 400 && status < 500) {
    return new GoogleGeminiProviderError('GOOGLE_GEMINI_HTTP_4XX', 'Google Gemini request was rejected', { cause: error });
  }
  if (mode === 'vertex' && /credential|authentication|adc|application default/i.test(String(error?.message || ''))) {
    return new GoogleGeminiProviderError('GOOGLE_VERTEX_AUTH_FAILED', 'Vertex AI Application Default Credentials are unavailable', { cause: error });
  }
  return new GoogleGeminiProviderError('GOOGLE_GEMINI_REQUEST_FAILED', 'Google Gemini request failed', { cause: error });
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
