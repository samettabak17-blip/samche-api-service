import { GoogleGenAI } from '@google/genai';
import {
  VisualAIProviderError,
  VisualAISafetyError,
  VisualAIValidationError,
} from './visual-ai-provider-adapter.js';

export const DEFAULT_GOOGLE_VISUAL_AI_MODEL = 'gemini-3.1-flash-image';
const SUPPORTED_INPUT_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

function normalizeGoogleError(error) {
  if (error instanceof VisualAIProviderError) return error;
  const status = error?.status || error?.statusCode || error?.httpStatusCode;
  const message = String(error?.message || error?.details || '');
  const isSafety = /safety|blocked|policy|recitation|prohibited/i.test(message) || (status === 400 && /safety/i.test(message)) || status === 422;

  if (isSafety) {
    return new VisualAISafetyError('VISUAL_AI_SAFETY_BLOCKED', message || 'Visual generation blocked by safety policy.');
  }
  if (status === 401 || status === 403 || /unauthenticated|permission denied|api key|credential/i.test(message)) {
    return new VisualAIProviderError('VISUAL_AI_AUTHENTICATION_FAILED', 'Google Visual AI authentication failed.', { retryable: false, status: 401 });
  }
  if (status === 429 || /rate limit|quota|resource exhausted/i.test(message)) {
    return new VisualAIProviderError('VISUAL_AI_RATE_LIMITED', 'Google Visual AI rate limit exceeded.', { retryable: true, status: 429 });
  }
  if (status === 503 || status === 500 || status === 502 || status === 504 || /unavailable|deadline exceeded|timeout|econnreset|etimedout/i.test(message)) {
    return new VisualAIProviderError('VISUAL_AI_PROVIDER_UNAVAILABLE', 'Google Visual AI service is temporarily unavailable.', { retryable: true, status: 503 });
  }
  if (status === 400 || /invalid argument/i.test(message)) {
    return new VisualAIProviderError('VISUAL_AI_INVALID_REQUEST', 'Google Visual AI request was invalid.', { retryable: false, status: 400 });
  }
  return new VisualAIProviderError(
    error?.code || 'VISUAL_AI_PROVIDER_ERROR',
    'Google Visual AI provider failure.',
    { retryable: false, status: status || 500 }
  );
}

function validateAndNormalizeImages(images, prefix = 'IMAGE') {
  if (!images) return [];
  if (!Array.isArray(images)) throw new VisualAIValidationError(`${prefix}_INVALID`, `${prefix} must be an array.`);
  return images.map((img, idx) => {
    if (!img || !Buffer.isBuffer(img.buffer) || img.buffer.length === 0) {
      throw new VisualAIValidationError(`${prefix}_MALFORMED`, `Image at index ${idx} is malformed.`);
    }
    const mime = String(img.mimeType || '').toLowerCase().trim();
    if (!SUPPORTED_INPUT_MIME_TYPES.includes(mime)) {
      throw new VisualAIValidationError(`${prefix}_MIME_UNSUPPORTED`, `Image MIME type "${mime}" is not supported.`);
    }
    if (img.buffer.length > MAX_IMAGE_BYTES) {
      throw new VisualAIValidationError(`${prefix}_TOO_LARGE`, `Image exceeds maximum allowed size.`);
    }
    return {
      buffer: img.buffer,
      mimeType: mime,
      originalFilename: img.originalFilename || `${prefix.toLowerCase()}_${idx}`,
    };
  });
}

export function createGoogleVisualAIProvider({ env = process.env, clientFactory, ProviderError } = {}) {
  const ErrorClass = ProviderError || VisualAIProviderError;
  let config;
  let model;
  try {
    config = resolveGoogleVisualAiConfig(env);
    model = resolveGoogleVisualAiModel(env);
  } catch {
    throw new ErrorClass('VISUAL_AI_PROVIDER_CONFIGURATION_INVALID', 'Google Visual AI configuration is unavailable.', { retryable: false, status: 503 });
  }

  const clientOptions = config.mode === 'vertex'
    ? { vertexai: true, project: config.project, location: config.location }
    : { apiKey: config.apiKey };
  let client;
  try {
    client = clientFactory ? clientFactory(clientOptions) : new GoogleGenAI(clientOptions);
  } catch {
    throw new ErrorClass('VISUAL_AI_PROVIDER_CONFIGURATION_INVALID', 'Google Visual AI configuration is unavailable.', { retryable: false, status: 503 });
  }
  if (!client?.interactions?.create) {
    throw new ErrorClass('VISUAL_AI_PROVIDER_CONFIGURATION_INVALID', 'Google Visual AI client is unavailable.', { retryable: false, status: 503 });
  }

  return Object.freeze({
    provider: 'GOOGLE',
    model,
    async generateConcept(request) {
      if (!request || typeof request !== 'object') {
        throw new VisualAIValidationError('VISUAL_INPUT_REQUIRED', 'Input required');
      }

      const instruction = String(request.instruction || '').trim();
      if (!instruction) {
        throw new VisualAIValidationError('INSTRUCTION_REQUIRED', 'Instruction required');
      }
      if (instruction.length > 2000) {
        throw new VisualAIValidationError('INSTRUCTION_TOO_LONG', 'Instruction too long');
      }

      let rawSources = request.sourceImages;
      if (rawSources === undefined && request.targetImage) {
        rawSources = [request.targetImage];
      }
      let rawReferences = request.referenceImages;
      if (rawReferences === undefined && request.referenceImage) {
        rawReferences = [request.referenceImage];
      }

      const sources = validateAndNormalizeImages(rawSources, 'SOURCE_IMAGE');
      const references = validateAndNormalizeImages(rawReferences, 'REFERENCE_IMAGE');

      const input = [];
      for (const img of sources) {
        input.push({ type: 'image', data: img.buffer.toString('base64'), mime_type: img.mimeType });
      }
      for (const img of references) {
        input.push({ type: 'image', data: img.buffer.toString('base64'), mime_type: img.mimeType });
      }
      input.push({ type: 'text', text: instruction });

      const response_format = { type: 'image' };
      if (request.outputOptions?.mimeType) response_format.mime_type = request.outputOptions.mimeType;
      if (request.outputOptions?.aspectRatio) response_format.aspect_ratio = request.outputOptions.aspectRatio;
      if (request.outputOptions?.imageSize) response_format.image_size = request.outputOptions.imageSize;

      let response;
      try {
        response = await client.interactions.create({ model, input, response_format });
      } catch (err) {
        throw normalizeGoogleError(err);
      }

      if (!response?.output_image?.data) {
        throw new ErrorClass('VISUAL_AI_PROVIDER_RESPONSE_INVALID', 'Google Visual AI response did not contain a valid image.', { retryable: false, status: 502 });
      }

      const imageBuffer = Buffer.from(response.output_image.data, 'base64');
      if (imageBuffer.length === 0) {
        throw new ErrorClass('VISUAL_AI_PROVIDER_RESPONSE_INVALID', 'Google Visual AI response image buffer was empty.', { retryable: false, status: 502 });
      }

      const mimeType = response.output_image.mime_type || request.outputOptions?.mimeType || 'image/png';
      const providerRequestId = response.id || null;
      const costMetadata = { provider: 'GOOGLE', model: response.model || model };
      if (typeof response.usage?.input_tokens === 'number') costMetadata.inputTokens = response.usage.input_tokens;
      if (typeof response.usage?.output_tokens === 'number') costMetadata.outputTokens = response.usage.output_tokens;

      return Object.freeze({
        imageBuffer,
        mimeType,
        provider: 'GOOGLE',
        model: response.model || model,
        providerRequestId,
        finishReason: 'SUCCESS',
        costMetadata: Object.freeze(costMetadata),
      });
    },
    getProviderIdentity() { return Object.freeze({ provider: 'GOOGLE', model }); },
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
