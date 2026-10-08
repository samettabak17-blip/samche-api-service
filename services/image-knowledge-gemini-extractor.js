import OpenAI from 'openai';
import { buildGeminiImagePart } from './whatsapp-multimodal-service.js';
import { createGoogleGeminiProvider, GoogleGeminiProviderError } from './google-gemini-provider.js';
import { executeAiProviderFailover, defaultAiCircuitBreakerRegistry, AllAiProvidersFailedError } from './shared-ai-provider-resilience.js';
import { getDashboardAiProviderPolicy } from './dashboard-ai-provider-policy.js';
import {
  IMAGE_KNOWLEDGE_EXTRACTION_VERSION,
  validateImageKnowledgeExtraction,
  validateImageKnowledgeInput,
  ImageKnowledgeExtractionError,
} from './image-knowledge-extraction.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_WIDTH = 12_000;
const MAX_HEIGHT = 12_000;
const MAX_PIXELS = 40_000_000;
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export class GeminiImageKnowledgeExtractionError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'GeminiImageKnowledgeExtractionError';
    this.code = code;
  }
}

function dimensionsFromPng(bytes) {
  if (bytes.length < 24) throw new GeminiImageKnowledgeExtractionError('IMAGE_DIMENSIONS_UNREADABLE', 'Image dimensions are unavailable');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function dimensionsFromJpeg(bytes) {
  let offset = 2;
  while (offset + 3 < bytes.length && offset < 1_048_576) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 1 >= bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) break;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new GeminiImageKnowledgeExtractionError('IMAGE_DIMENSIONS_UNREADABLE', 'Image dimensions are unavailable');
}

export function readBoundedImageDimensions({ mimeType, bytes }) {
  const dimensions = mimeType === 'image/png' ? dimensionsFromPng(bytes) : dimensionsFromJpeg(bytes);
  if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > MAX_WIDTH || dimensions.height > MAX_HEIGHT || dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new GeminiImageKnowledgeExtractionError('IMAGE_DIMENSIONS_INVALID', 'Image dimensions exceed safe limits');
  }
  return dimensions;
}

function parseProviderTextValue(text) {
  if (!text) throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_RESPONSE_EMPTY', 'Image provider returned no extraction');
  try {
    const trimmed = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(trimmed);
  } catch {
    throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_JSON_INVALID', 'Image provider returned invalid JSON');
  }
}

function parseProviderText(body) {
  return parseProviderTextValue(body?.structured_text ?? body?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('')?.trim());
}

function normalizeProviderOutput(value, { sourceHash, mimeType, extractionMethod = 'GEMINI_VISION' }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.segments)) {
    throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_RESPONSE_INVALID', 'Image provider response is invalid');
  }
  const segments = value.segments.map((segment, index) => ({
    order: Number.isInteger(segment?.order) && segment.order >= 0 ? segment.order : index,
    text: segment?.text,
    role: ['BUSINESS', 'CUSTOMER', 'UNKNOWN'].includes(String(segment?.role ?? '').toUpperCase()) ? String(segment.role).toUpperCase() : 'UNKNOWN',
    confidence: Number.isFinite(Number(segment?.confidence)) && Number(segment.confidence) >= 0 && Number(segment.confidence) <= 1 ? Number(segment.confidence) : 0,
    ...(segment?.sourceLocator ? { sourceLocator: segment.sourceLocator } : {}),
  })).sort((left, right) => left.order - right.order).map((segment, order) => ({ ...segment, order }));
  const extractionConfidence = Number.isFinite(Number(value.extractionConfidence)) && Number(value.extractionConfidence) >= 0 && Number(value.extractionConfidence) <= 1
    ? Number(value.extractionConfidence)
    : 0;
  try {
    return validateImageKnowledgeExtraction({
      extractionVersion: IMAGE_KNOWLEDGE_EXTRACTION_VERSION,
      sourceHash,
      mimeType,
      text: value.text,
      segments,
      extractionConfidence,
      extractionMethod,
    });
  } catch (error) {
    if (error instanceof ImageKnowledgeExtractionError) {
      throw new GeminiImageKnowledgeExtractionError('IMAGE_EXTRACTION_CANONICAL_INVALID', 'Image extraction failed canonical validation', { cause: error });
    }
    throw error;
  }
}

export function createGeminiImageKnowledgeExtractor({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = Number(env.IMAGE_KNOWLEDGE_EXTRACTION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) } = {}) {
  const model = String(env.IMAGE_KNOWLEDGE_GENERATION_MODEL || env.KNOWLEDGE_GENERATION_MODEL || 'gemini-3-flash-preview').trim();
  let googleProvider = null;
  return Object.freeze({
    provider: 'GEMINI',
    model,
    timeoutMs,
    async extract({ bytes, mimeType, sourceHash }) {
      const input = validateImageKnowledgeInput({ originalname: mimeType === 'image/png' ? 'image.png' : 'image.jpg', mimetype: mimeType, buffer: bytes, size: bytes?.length });
      if (!/^[a-f0-9]{64}$/i.test(String(sourceHash ?? ''))) throw new GeminiImageKnowledgeExtractionError('IMAGE_SOURCE_HASH_INVALID', 'Image source hash is invalid');
      readBoundedImageDimensions({ mimeType: input.mimeType, bytes: input.buffer });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        googleProvider ??= createGoogleGeminiProvider({ env, fetchImpl: fetchImpl === globalThis.fetch ? null : fetchImpl });
        const response = await googleProvider.generateContent({
          model,
          contents: [{ role: 'user', parts: [
            { text: 'Extract visible text from this image. Preserve reading order. For conversation-like content classify each segment as BUSINESS, CUSTOMER, or UNKNOWN; use UNKNOWN when role is uncertain. Return concise JSON only.' },
            buildGeminiImagePart({ mimeType: input.mimeType, bytes: input.buffer }),
          ] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: 'low' },
            responseSchema: {
              type: 'OBJECT',
              properties: {
                text: { type: 'STRING' },
                extractionConfidence: { type: 'NUMBER' },
                segments: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
                  order: { type: 'INTEGER' }, text: { type: 'STRING' }, role: { type: 'STRING' }, confidence: { type: 'NUMBER' },
                  sourceLocator: { type: 'OBJECT', properties: { page: { type: 'NUMBER' }, x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, width: { type: 'NUMBER' }, height: { type: 'NUMBER' } } },
                } } },
              },
            },
          },
          signal: controller.signal,
        });
        return normalizeProviderOutput(parseProviderText(response), { sourceHash: String(sourceHash).toLowerCase(), mimeType: input.mimeType });
      } catch (error) {
        if (error instanceof GeminiImageKnowledgeExtractionError) throw error;
        if (error?.code === 'GOOGLE_GEMINI_API_KEY_REQUIRED' || error?.code === 'GOOGLE_CLOUD_PROJECT_REQUIRED' || error?.code === 'GOOGLE_CLOUD_LOCATION_REQUIRED') throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_UNAVAILABLE', 'Gemini image extraction is unavailable', { cause: error });
        if (error instanceof GoogleGeminiProviderError && error.code === 'GOOGLE_GEMINI_TIMEOUT') throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_TIMEOUT', 'Gemini image extraction timed out', { cause: error });
        if (error instanceof GoogleGeminiProviderError && (error.code === 'GOOGLE_GEMINI_MODEL_UNAVAILABLE' || error.code === 'GOOGLE_GEMINI_AUTH_FAILED' || error.code === 'GOOGLE_VERTEX_PERMISSION_DENIED' || error.code === 'GOOGLE_GEMINI_HTTP_4XX')) throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_HTTP_4XX', 'Gemini image extraction request failed', { cause: error });
        if (controller.signal.aborted || error?.name === 'AbortError') throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_TIMEOUT', 'Gemini image extraction timed out');
        throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_NETWORK_ERROR', 'Gemini image extraction failed');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

const OPENAI_VISION_MODELS = new Set(['gpt-4o-mini', 'gpt-4o']);

export function createImageKnowledgeExtractor({
  env = process.env,
  fetchImpl = globalThis.fetch,
  googleProviderFactory = null,
  openaiClient = null,
  openaiClientFactory = null,
  circuitRegistry = defaultAiCircuitBreakerRegistry,
  telemetry = null,
} = {}) {
  const policy = getDashboardAiProviderPolicy('IMAGE_KNOWLEDGE_EXTRACTION', env);
  if (!policy.failoverEnabled) return createGeminiImageKnowledgeExtractor({ env, fetchImpl });

  let googleProvider = null;
  let resolvedOpenaiClient = openaiClient;
  const prompt = 'Extract visible text from this image. Preserve reading order. For conversation-like content classify each segment as BUSINESS, CUSTOMER, or UNKNOWN; use UNKNOWN when role is uncertain. Return concise JSON only.';
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      text: { type: 'STRING' },
      extractionConfidence: { type: 'NUMBER' },
      segments: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        order: { type: 'INTEGER' }, text: { type: 'STRING' }, role: { type: 'STRING' }, confidence: { type: 'NUMBER' },
        sourceLocator: { type: 'OBJECT', properties: { page: { type: 'NUMBER' }, x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, width: { type: 'NUMBER' }, height: { type: 'NUMBER' } } },
      } } },
    },
  };

  return Object.freeze({
    provider: 'VERTEX_OPENAI',
    model: policy.primaryModel,
    timeoutMs: policy.totalTimeoutMs,
    async extract({ bytes, mimeType, sourceHash }) {
      const input = validateImageKnowledgeInput({ originalname: mimeType === 'image/png' ? 'image.png' : 'image.jpg', mimetype: mimeType, buffer: bytes, size: bytes?.length });
      if (!/^[a-f0-9]{64}$/i.test(String(sourceHash ?? ''))) throw new GeminiImageKnowledgeExtractionError('IMAGE_SOURCE_HASH_INVALID', 'Image source hash is invalid');
      readBoundedImageDimensions({ mimeType: input.mimeType, bytes: input.buffer });
      if (!OPENAI_VISION_MODELS.has(policy.secondaryModel)) {
        throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_CAPABILITY_UNAVAILABLE', 'Configured fallback does not support structured image understanding');
      }
      if (!env.OPENAI_API_KEY) {
        throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_UNAVAILABLE', 'Image extraction fallback is unavailable');
      }

      try {
        const result = await executeAiProviderFailover({
          operation: policy.operation,
          capability: policy.capability,
          correlationId: String(sourceHash).slice(0, 16),
          primaryProvider: policy.primaryProvider,
          primaryModel: policy.primaryModel,
          secondaryProvider: policy.secondaryProvider,
          secondaryModel: policy.secondaryModel,
          primaryTimeoutMs: policy.primaryTimeoutMs,
          secondaryTimeoutMs: policy.secondaryTimeoutMs,
          totalTimeoutMs: policy.totalTimeoutMs,
          circuitRegistry,
          telemetry,
          primary: async ({ signal }) => {
            googleProvider ??= typeof googleProviderFactory === 'function'
              ? googleProviderFactory()
              : createGoogleGeminiProvider({ env, fetchImpl: fetchImpl === globalThis.fetch ? null : fetchImpl });
            const response = await googleProvider.generateContent({
              model: policy.primaryModel,
              contents: [{ role: 'user', parts: [
                { text: prompt },
                buildGeminiImagePart({ mimeType: input.mimeType, bytes: input.buffer }),
              ] }],
              generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingLevel: 'low' },
                responseSchema,
              },
              signal,
            });
            return response?.structured_text ?? response?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('')?.trim();
          },
          secondary: async ({ signal }) => {
            resolvedOpenaiClient ??= typeof openaiClientFactory === 'function'
              ? openaiClientFactory({ apiKey: env.OPENAI_API_KEY })
              : new OpenAI({ apiKey: env.OPENAI_API_KEY });
            if (!resolvedOpenaiClient?.chat?.completions?.create) {
              throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDER_UNAVAILABLE', 'OpenAI image extraction is unavailable');
            }
            const completion = await resolvedOpenaiClient.chat.completions.create({
              model: policy.secondaryModel,
              temperature: 0,
              response_format: { type: 'json_object' },
              messages: [{ role: 'user', content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.buffer.toString('base64')}` } },
              ] }],
            }, { signal });
            return completion?.choices?.[0]?.message?.content;
          },
        });
        return normalizeProviderOutput(parseProviderTextValue(result.output), {
          sourceHash: String(sourceHash).toLowerCase(),
          mimeType: input.mimeType,
          extractionMethod: result.provider === 'OPENAI' ? 'OPENAI_VISION' : 'GEMINI_VISION',
        });
      } catch (error) {
        if (error instanceof GeminiImageKnowledgeExtractionError) throw error;
        if (error instanceof AllAiProvidersFailedError) {
          throw new GeminiImageKnowledgeExtractionError('IMAGE_PROVIDERS_UNAVAILABLE', 'Image extraction providers are temporarily unavailable', { cause: error });
        }
        throw error;
      }
    },
  });
}

export const GEMINI_IMAGE_DIMENSION_LIMITS = Object.freeze({ maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT, maxPixels: MAX_PIXELS });
