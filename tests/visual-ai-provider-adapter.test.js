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
    googleClientFactory: () => ({ models: { generateContent: async () => ({}) } }),
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
    googleClientFactory: () => ({ models: { generateContent: async () => ({}) } }),
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

test('Google Visual AI maps canonical source and reference image collections into Gemini generateContent and normalizes its output', async () => {
  const requests = [];
  const generatedBytes = Buffer.from('generated-image-bytes');
  const provider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key', VISUAL_AI_GOOGLE_IMAGE_MODEL: 'gemini-3.1-flash-image' },
    googleClientFactory: () => ({
      models: {
        generateContent: async (request) => {
          requests.push(request);
          return {
            id: 'interaction-safe-123',
            model: 'gemini-3.1-flash-image',
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: generatedBytes.toString('base64'),
                        mimeType: 'image/webp',
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
            unsafe_raw_payload: { credential: 'must-not-leak' },
          };
        },
      },
    }),
  });

  const result = await provider.generateConcept({
    instruction: 'Place the catalog material onto the supplied room wall.',
    sourceImages: [{ buffer: Buffer.from('room'), mimeType: 'image/jpeg', originalFilename: 'room.jpg' }],
    referenceImages: [
      { buffer: Buffer.from('material-a'), mimeType: 'image/png', originalFilename: 'material-a.png' },
      { buffer: Buffer.from('material-b'), mimeType: 'image/webp', originalFilename: 'material-b.webp' },
    ],
    outputOptions: { aspectRatio: '16:9', imageSize: '2K', mimeType: 'image/webp' },
    metadata: { requestPurpose: 'tenant-visual-concept' },
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    model: 'gemini-3.1-flash-image',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: Buffer.from('room').toString('base64') } },
          { inlineData: { mimeType: 'image/png', data: Buffer.from('material-a').toString('base64') } },
          { inlineData: { mimeType: 'image/webp', data: Buffer.from('material-b').toString('base64') } },
          { text: 'Place the catalog material onto the supplied room wall.' },
        ],
      },
    ],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '16:9',
        imageSize: '2K',
      },
    },
  });
  assert.deepEqual(result, {
    imageBuffer: generatedBytes,
    mimeType: 'image/webp',
    provider: 'GOOGLE',
    model: 'gemini-3.1-flash-image',
    providerRequestId: 'interaction-safe-123',
    finishReason: 'STOP',
    costMetadata: { provider: 'GOOGLE', model: 'gemini-3.1-flash-image', inputTokens: 12, outputTokens: 34 },
  });
  assert.equal(result.unsafe_raw_payload, undefined);
});

test('Google Visual AI supports canonical text-to-image requests without weakening legacy target-image validation', async () => {
  const provider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({
      models: {
        generateContent: async () => ({
          candidates: [{ content: { parts: [{ inlineData: { data: DETERMINISTIC_MOCK_PNG.toString('base64'), mimeType: 'image/png' } }] } }],
        }),
      },
    }),
  });
  const result = await provider.generateConcept({
    instruction: 'Create a safe generic product concept.',
    sourceImages: [],
    referenceImages: [],
  });
  assert.equal(result.mimeType, 'image/png');
  assert.throws(
    () => validateVisualGenerationInput({ instruction: 'Legacy visual request without a target.' }),
    (err) => err instanceof VisualAIValidationError && err.code === 'TARGET_IMAGE_REQUIRED'
  );
});

test('Google Visual AI normalizes provider failures and rejects responses that contain no image', async () => {
  const makeProvider = (failure) => createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({
      models: {
        generateContent: async () => {
          if (failure instanceof Error) throw failure;
          return failure;
        },
      },
    }),
  });
  const request = { instruction: 'Transform safely.', sourceImages: [{ buffer: Buffer.from('source'), mimeType: 'image/jpeg' }] };

  await assert.rejects(() => makeProvider({ candidates: [{ content: { parts: [{ text: 'No image.' }] } }] }).generateConcept(request), (err) => err instanceof VisualAIProviderError && err.code === 'VISUAL_AI_PROVIDER_RESPONSE_INVALID' && !err.retryable);
  for (const [status, code, retryable] of [[401, 'VISUAL_AI_AUTHENTICATION_FAILED', false], [429, 'VISUAL_AI_RATE_LIMITED', true], [503, 'VISUAL_AI_PROVIDER_UNAVAILABLE', true], [400, 'VISUAL_AI_SAFETY_BLOCKED', false]]) {
    const error = new Error(status === 400 ? 'safety policy blocked output' : 'provider failure');
    error.status = status;
    await assert.rejects(() => makeProvider(error).generateConcept(request), (err) => err instanceof VisualAIProviderError && err.code === code && err.retryable === retryable);
  }
});

test('Google Visual AI supports Vertex mode configuration and custom image model override', () => {
  let capturedOptions = null;
  const provider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: {
      GOOGLE_GENAI_MODE: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'samche-staging',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
      VISUAL_AI_GOOGLE_IMAGE_MODEL: 'gemini-3.1-flash-image-custom',
    },
    googleClientFactory: (options) => {
      capturedOptions = options;
      return { models: { generateContent: async () => ({}) } };
    },
  });

  assert.deepEqual(capturedOptions, {
    vertexai: true,
    project: 'samche-staging',
    location: 'us-central1',
  });
  assert.deepEqual(provider.getProviderIdentity(), {
    provider: 'GOOGLE',
    model: 'gemini-3.1-flash-image-custom',
  });
});

test('Google Visual AI rejects invalid configuration and invalid model identifiers', () => {
  assert.throws(
    () => createVisualAIProvider({
      providerType: 'GOOGLE',
      env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: '' },
    }),
    (err) => err instanceof VisualAIProviderError && err.code === 'VISUAL_AI_PROVIDER_CONFIGURATION_INVALID'
  );

  assert.throws(
    () => createVisualAIProvider({
      providerType: 'GOOGLE',
      env: { GOOGLE_GENAI_MODE: 'vertex', GOOGLE_CLOUD_PROJECT: 'proj' }, // missing location
    }),
    (err) => err instanceof VisualAIProviderError && err.code === 'VISUAL_AI_PROVIDER_CONFIGURATION_INVALID'
  );

  assert.throws(
    () => createVisualAIProvider({
      providerType: 'GOOGLE',
      env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test', VISUAL_AI_GOOGLE_IMAGE_MODEL: '$$$invalid-model$$$' },
    }),
    (err) => err instanceof VisualAIProviderError && err.code === 'VISUAL_AI_PROVIDER_CONFIGURATION_INVALID'
  );
});

test('Google Visual AI validates image inputs, sizes, and MIME types strictly', async () => {
  const provider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({ models: { generateContent: async () => ({}) } }),
  });

  await assert.rejects(
    () => provider.generateConcept({ instruction: '' }),
    (err) => err instanceof VisualAIValidationError && err.code === 'INSTRUCTION_REQUIRED'
  );

  await assert.rejects(
    () => provider.generateConcept({
      instruction: 'Test',
      sourceImages: [{ buffer: Buffer.from('data'), mimeType: 'image/gif' }],
    }),
    (err) => err instanceof VisualAIValidationError && err.code === 'SOURCE_IMAGE_MIME_UNSUPPORTED'
  );

  await assert.rejects(
    () => provider.generateConcept({
      instruction: 'Test',
      referenceImages: [{ buffer: Buffer.alloc(11 * 1024 * 1024), mimeType: 'image/jpeg' }],
    }),
    (err) => err instanceof VisualAIValidationError && err.code === 'REFERENCE_IMAGE_TOO_LARGE'
  );
});

test('Google Visual AI exclusively calls models.generateContent and never calls interactions.create', async () => {
  let generateContentCalled = 0;
  let interactionsCreateCalled = 0;
  const provider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({
      models: {
        generateContent: async () => {
          generateContentCalled += 1;
          return {
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { data: DETERMINISTIC_MOCK_PNG.toString('base64'), mimeType: 'image/png' } }],
                },
              },
            ],
          };
        },
      },
      interactions: {
        create: async () => {
          interactionsCreateCalled += 1;
          throw new Error('interactions.create must never be called');
        },
      },
    }),
  });

  const result = await provider.generateConcept({
    instruction: 'Create concept',
    sourceImages: [{ buffer: Buffer.from('img'), mimeType: 'image/jpeg' }],
  });

  assert.equal(generateContentCalled, 1);
  assert.equal(interactionsCreateCalled, 0);
  assert.equal(result.mimeType, 'image/png');
});
