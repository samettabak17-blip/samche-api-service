import crypto from 'node:crypto';

export class VisualAIProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'VisualAIProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? (this.retryable ? 503 : 400);
  }
}

export class VisualAIValidationError extends VisualAIProviderError {
  constructor(code, message) {
    super(code, message, { retryable: false, status: 400 });
    this.name = 'VisualAIValidationError';
  }
}

export class VisualAISafetyError extends VisualAIProviderError {
  constructor(code = 'VISUAL_AI_SAFETY_BLOCKED', message = 'Visual generation blocked by safety policy.') {
    super(code, message, { retryable: false, status: 422 });
    this.name = 'VisualAISafetyError';
  }
}

const SUPPORTED_INPUT_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 45000;

export const DETERMINISTIC_MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

export function validateVisualGenerationInput(input) {
  if (!input || typeof input !== 'object') throw new VisualAIValidationError('VISUAL_INPUT_REQUIRED', 'Input required');
  const { targetImage, referenceImage, instruction } = input;
  if (!targetImage || !Buffer.isBuffer(targetImage.buffer) || targetImage.buffer.length === 0) {
    throw new VisualAIValidationError('TARGET_IMAGE_REQUIRED', 'Target image required');
  }
  const targetMime = String(targetImage.mimeType || '').toLowerCase().trim();
  if (!SUPPORTED_INPUT_MIME_TYPES.includes(targetMime)) {
    throw new VisualAIValidationError('TARGET_IMAGE_MIME_UNSUPPORTED', `Target image MIME type "${targetMime}" is not supported.`);
  }
  if (targetImage.buffer.length > MAX_IMAGE_BYTES) throw new VisualAIValidationError('TARGET_IMAGE_TOO_LARGE', 'Target too large');

  if (referenceImage) {
    if (!Buffer.isBuffer(referenceImage.buffer) || referenceImage.buffer.length === 0) {
      throw new VisualAIValidationError('REFERENCE_IMAGE_MALFORMED', 'Reference image malformed');
    }
    const refMime = String(referenceImage.mimeType || '').toLowerCase().trim();
    if (!SUPPORTED_INPUT_MIME_TYPES.includes(refMime)) {
      throw new VisualAIValidationError('REFERENCE_IMAGE_MIME_UNSUPPORTED', `Reference image MIME type "${refMime}" is not supported.`);
    }
    if (referenceImage.buffer.length > MAX_IMAGE_BYTES) throw new VisualAIValidationError('REFERENCE_IMAGE_TOO_LARGE', 'Reference too large');
  }

  const normalizedInstruction = String(instruction || '').trim();
  if (!normalizedInstruction) throw new VisualAIValidationError('INSTRUCTION_REQUIRED', 'Instruction required');
  if (normalizedInstruction.length > 2000) throw new VisualAIValidationError('INSTRUCTION_TOO_LONG', 'Instruction too long');

  return {
    targetImage: { buffer: targetImage.buffer, mimeType: targetMime, originalFilename: targetImage.originalFilename || 'target_image' },
    referenceImage: referenceImage ? { buffer: referenceImage.buffer, mimeType: String(referenceImage.mimeType).toLowerCase().trim(), originalFilename: referenceImage.originalFilename || 'reference_image' } : null,
    instruction: normalizedInstruction,
    groundingContext: input.groundingContext && typeof input.groundingContext === 'object' ? input.groundingContext : {},
    aspectRatio: input.aspectRatio || '1:1',
    outputFormat: input.outputFormat || 'image/png',
    timeoutMs: Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

export function classifyVisualAIError(error) {
  if (error instanceof VisualAIValidationError || error instanceof VisualAISafetyError) {
    return { retryable: false, code: error.code || 'VALIDATION_ERROR' };
  }
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || error?.httpStatus);

  if (status === 429 || code === 'RESOURCE_EXHAUSTED' || message.includes('rate limit') || message.includes('quota')) {
    return { retryable: true, code: 'VISUAL_AI_RATE_LIMITED' };
  }
  if (status === 503 || status === 502 || status === 504 || code.includes('TIMEOUT') || code.includes('ETIMEDOUT') || code.includes('ECONN') || message.includes('timeout') || message.includes('econnreset')) {
    return { retryable: true, code: 'VISUAL_AI_PROVIDER_UNAVAILABLE' };
  }
  if (status === 400 || message.includes('safety') || message.includes('blocked') || message.includes('policy')) {
    return { retryable: false, code: 'VISUAL_AI_SAFETY_BLOCKED' };
  }
  return { retryable: false, code: error?.code || code || 'VISUAL_AI_PROVIDER_ERROR' };
}

export function createDeterministicMockVisualProvider(options = {}) {
  const providerName = options.providerName || 'MOCK';
  const modelName = options.modelName || 'mock-visual-v1';
  return Object.freeze({
    provider: providerName,
    model: modelName,
    async generateConcept(request) {
      const validated = validateVisualGenerationInput(request);
      if (options.simulateError === 'SAFETY') throw new VisualAISafetyError('VISUAL_AI_SAFETY_BLOCKED', 'Simulated safety rejection.');
      if (options.simulateError === 'RATE_LIMIT') throw new VisualAIProviderError('VISUAL_AI_RATE_LIMITED', 'Simulated 429 Rate Limit.', { retryable: true, status: 429 });
      if (options.simulateError === 'TIMEOUT') throw new VisualAIProviderError('VISUAL_AI_TIMEOUT', 'Simulated generation timeout.', { retryable: true, status: 504 });
      if (options.simulateError) throw new VisualAIProviderError('VISUAL_AI_MOCK_ERROR', 'Simulated unhandled error.', { retryable: false });

      const hashSeed = crypto.createHash('sha256').update(validated.targetImage.buffer).update(validated.instruction).digest('hex').slice(0, 16);
      return Object.freeze({
        imageBuffer: DETERMINISTIC_MOCK_PNG,
        mimeType: 'image/png',
        provider: providerName,
        model: modelName,
        providerRequestId: `mock-req-${hashSeed}`,
        finishReason: 'SUCCESS',
        costMetadata: Object.freeze({ provider: providerName, model: modelName, durationMs: options.simulatedLatencyMs ?? 5, computeUnits: 0, inputTokens: 0, outputTokens: 0 }),
      });
    },
    getProviderIdentity() { return { provider: providerName, model: modelName }; },
  });
}

export function createVisualAIProvider(options = {}) {
  const providerType = String(options.providerType || process.env.VISUAL_AI_PROVIDER || 'MOCK').toUpperCase();
  if (providerType === 'MOCK' || providerType === 'DETERMINISTIC') return createDeterministicMockVisualProvider(options.mockOptions);
  if (providerType === 'GOOGLE_GENAI' || providerType === 'GEMINI') {
    const model = String(process.env.VISUAL_AI_GOOGLE_IMAGE_MODEL || 'imagen-3.0-generate-002');
    return Object.freeze({
      provider: 'GOOGLE_GENAI',
      model,
      async generateConcept(request) {
        validateVisualGenerationInput(request);
        throw new VisualAIProviderError('VISUAL_AI_LIVE_CALLS_DISABLED_IN_PHASE1', 'Live image generation API calls are prohibited in Phase 1. Use the deterministic mock provider.', { retryable: false });
      },
      getProviderIdentity() { return { provider: 'GOOGLE_GENAI', model }; },
    });
  }
  throw new VisualAIProviderError('VISUAL_AI_PROVIDER_UNSUPPORTED', `Visual AI provider "${providerType}" is not supported.`);
}

