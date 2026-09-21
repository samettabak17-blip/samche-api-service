import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVisualAIError,
  createDeterministicMockVisualProvider,
  createVisualAIProvider,
  DETERMINISTIC_MOCK_PNG,
  validateVisualGenerationInput,
  VisualAIProviderError,
  VisualAISafetyError,
  VisualAIValidationError,
} from '../services/visual-ai-provider-adapter.js';

test('validateVisualGenerationInput rejects missing target image buffer', () => {
  assert.throws(
    () => validateVisualGenerationInput({ instruction: 'Make this Scandinavian' }),
    (err) => err instanceof VisualAIValidationError && err.code === 'TARGET_IMAGE_REQUIRED'
  );
});

test('validateVisualGenerationInput rejects unsupported target MIME type', () => {
  assert.throws(
    () => validateVisualGenerationInput({
      targetImage: { buffer: Buffer.from('data'), mimeType: 'image/gif' },
      instruction: 'Make this Scandinavian',
    }),
    (err) => err instanceof VisualAIValidationError && err.code === 'TARGET_IMAGE_MIME_UNSUPPORTED'
  );
});

test('validateVisualGenerationInput rejects empty instruction', () => {
  assert.throws(
    () => validateVisualGenerationInput({
      targetImage: { buffer: Buffer.from('data'), mimeType: 'image/jpeg' },
      instruction: '   ',
    }),
    (err) => err instanceof VisualAIValidationError && err.code === 'INSTRUCTION_REQUIRED'
  );
});

test('validateVisualGenerationInput accepts valid target and reference images', () => {
  const result = validateVisualGenerationInput({
    targetImage: { buffer: Buffer.from('target'), mimeType: 'image/jpeg' },
    referenceImage: { buffer: Buffer.from('reference'), mimeType: 'image/png' },
    instruction: 'Redesign this room in minimalist style',
    groundingContext: { style: 'minimalist' },
  });

  assert.equal(result.targetImage.mimeType, 'image/jpeg');
  assert.equal(result.referenceImage.mimeType, 'image/png');
  assert.equal(result.instruction, 'Redesign this room in minimalist style');
  assert.deepEqual(result.groundingContext, { style: 'minimalist' });
});

test('createDeterministicMockVisualProvider generates zero-cost mock PNG without network calls', async () => {
  const provider = createDeterministicMockVisualProvider();
  const result = await provider.generateConcept({
    targetImage: { buffer: Buffer.from('target-room'), mimeType: 'image/jpeg' },
    instruction: 'Add modern wood furniture',
  });

  assert.equal(result.finishReason, 'SUCCESS');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.imageBuffer.length, DETERMINISTIC_MOCK_PNG.length);
  assert.equal(result.costMetadata.computeUnits, 0);
  assert.equal(result.costMetadata.inputTokens, 0);
  assert.equal(result.costMetadata.outputTokens, 0);
  assert.match(result.providerRequestId, /^mock-req-/);
});

test('createDeterministicMockVisualProvider supports simulated errors for worker testing', async () => {
  const safetyProvider = createDeterministicMockVisualProvider({ simulateError: 'SAFETY' });
  await assert.rejects(
    () => safetyProvider.generateConcept({
      targetImage: { buffer: Buffer.from('target'), mimeType: 'image/jpeg' },
      instruction: 'Make unsafe content',
    }),
    (err) => err instanceof VisualAISafetyError && err.code === 'VISUAL_AI_SAFETY_BLOCKED'
  );

  const rateLimitProvider = createDeterministicMockVisualProvider({ simulateError: 'RATE_LIMIT' });
  await assert.rejects(
    () => rateLimitProvider.generateConcept({
      targetImage: { buffer: Buffer.from('target'), mimeType: 'image/jpeg' },
      instruction: 'Generate fast',
    }),
    (err) => err instanceof VisualAIProviderError && err.retryable === true && err.code === 'VISUAL_AI_RATE_LIMITED'
  );
});

test('classifyVisualAIError distinguishes retryable vs terminal errors', () => {
  assert.deepEqual(classifyVisualAIError(new VisualAISafetyError()), { retryable: false, code: 'VISUAL_AI_SAFETY_BLOCKED' });
  assert.deepEqual(classifyVisualAIError(new VisualAIValidationError('TEST', 'Test')), { retryable: false, code: 'TEST' });
  assert.deepEqual(classifyVisualAIError({ status: 429 }), { retryable: true, code: 'VISUAL_AI_RATE_LIMITED' });
  assert.deepEqual(classifyVisualAIError({ status: 503 }), { retryable: true, code: 'VISUAL_AI_PROVIDER_UNAVAILABLE' });
  assert.deepEqual(classifyVisualAIError({ code: 'ETIMEDOUT' }), { retryable: true, code: 'VISUAL_AI_PROVIDER_UNAVAILABLE' });
});

test('createVisualAIProvider supports GOOGLE_GENAI as an explicit Google selection alias', () => {
  const provider = createVisualAIProvider({
    providerType: 'GOOGLE_GENAI',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({ interactions: { create: async () => ({}) } }),
  });
  assert.equal(provider.getProviderIdentity().provider, 'GOOGLE');
});

test('createVisualAIProvider fails closed by default while explicit mock reports editing capabilities', async () => {
  const unavailable = createVisualAIProvider({ env: {} });
  assert.deepEqual(unavailable.getCapabilities(), {
    textToImage: false,
    imageConditionedGeneration: false,
    referenceImages: false,
  });
  await assert.rejects(
    () => unavailable.generateConcept({
      targetImage: { buffer: Buffer.from('target'), mimeType: 'image/jpeg' },
      instruction: 'Generate room',
    }),
    (err) => err instanceof VisualAIProviderError && err.code === 'VISUAL_AI_PROVIDER_UNAVAILABLE'
  );

  const mock = createVisualAIProvider({ providerType: 'MOCK', env: {} });
  assert.deepEqual(mock.getCapabilities(), {
    textToImage: true,
    imageConditionedGeneration: true,
    referenceImages: true,
  });
  const result = await mock.generateConcept({
    targetImage: { buffer: Buffer.from('target'), mimeType: 'image/jpeg' },
    instruction: 'Generate room',
  });
  assert.equal(result.provider, 'MOCK');
});

test('createVisualAIProvider selects Google only explicitly and resolves the Visual AI Gemini image default', () => {
  const unavailable = createVisualAIProvider({
    env: { GEMINI_API_KEY: 'credentials-must-not-select-provider' },
  });
  assert.equal(unavailable.getProviderIdentity().provider, 'UNAVAILABLE');

  const provider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: {
      GOOGLE_GENAI_MODE: 'developer',
      GEMINI_API_KEY: 'test-key',
    },
    googleClientFactory: () => ({ interactions: { create: async () => ({}) } }),
  });

  assert.deepEqual(provider.getProviderIdentity(), {
    provider: 'GOOGLE',
    model: 'gemini-3.1-flash-image',
  });
  assert.deepEqual(provider.getCapabilities(), {
    textToImage: true,
    imageConditionedGeneration: true,
    imageEditing: true,
    referenceImages: true,
  });
});
