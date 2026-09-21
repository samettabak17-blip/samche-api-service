import { GoogleGenAI } from '@google/genai';

export const DEFAULT_GOOGLE_VISUAL_AI_MODEL = 'gemini-3.1-flash-image';

function requiredString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveGoogleVisualAiConfig(env) {
  const mode = String(env.GOOGLE_GENAI_MODE || 'developer').trim().toLowerCase();
  if (!['developer', 'vertex'].includes(mode)) {
    throw new Error('GOOGLE_GENAI_MODE_INVALID');
  }
  if (mode === 'developer' && !requiredString(env.GEMINI_API_KEY)) {
    throw new Error('GOOGLE_GEMINI_API_KEY_REQUIRED');
  }
  if (mode === 'vertex' && (!requiredString(env.GOOGLE_CLOUD_PROJECT) || !requiredString(env.GOOGLE_CLOUD_LOCATION))) {
    throw new Error('GOOGLE_VERTEX_CONFIGURATION_REQUIRED');
  }
  return {
    mode,
    project: requiredString(env.GOOGLE_CLOUD_PROJECT),
    location: requiredString(env.GOOGLE_CLOUD_LOCATION),
    apiKey: requiredString(env.GEMINI_API_KEY),
  };
}

export function resolveGoogleVisualAiModel(env = process.env) {
  const model = requiredString(env.VISUAL_AI_GOOGLE_IMAGE_MODEL) || DEFAULT_GOOGLE_VISUAL_AI_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(model)) {
    throw new Error('VISUAL_AI_GOOGLE_MODEL_INVALID');
  }
  return model;
}

export function createGoogleVisualAIProvider({ env = process.env, clientFactory, validateInput, ProviderError } = {}) {
  const config = resolveGoogleVisualAiConfig(env);
  const model = resolveGoogleVisualAiModel(env);
  const clientOptions = config.mode === 'vertex'
    ? { vertexai: true, project: config.project, location: config.location }
    : { apiKey: config.apiKey };
  let client;
  try {
    client = clientFactory ? clientFactory(clientOptions) : new GoogleGenAI(clientOptions);
  } catch {
    throw new ProviderError('VISUAL_AI_PROVIDER_CONFIGURATION_INVALID', 'Google Visual AI configuration is unavailable.', { retryable: false, status: 503 });
  }
  if (!client?.interactions?.create) {
    throw new ProviderError('VISUAL_AI_PROVIDER_CONFIGURATION_INVALID', 'Google Visual AI client is unavailable.', { retryable: false, status: 503 });
  }

  return Object.freeze({
    provider: 'GOOGLE',
    model,
    async generateConcept(request) {
      validateInput(request);
      throw new ProviderError('VISUAL_AI_GOOGLE_ADAPTER_NOT_READY', 'Google Visual AI request mapping is unavailable.', { retryable: false, status: 503 });
    },
    getProviderIdentity() { return { provider: 'GOOGLE', model }; },
    getCapabilities() {
      return Object.freeze({
        textToImage: true,
        imageConditionedGeneration: true,
        imageEditing: true,
        referenceImages: true,
      });
    },
  });
}
