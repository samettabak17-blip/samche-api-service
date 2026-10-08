import test from 'node:test';
import assert from 'node:assert/strict';
import * as resilience from '../services/shared-ai-provider-resilience.js';

const {
  AI_PROVIDER_CAPABILITIES,
  AllAiProvidersFailedError,
  ProviderCircuitBreaker,
  ProviderCircuitBreakerRegistry,
  executeAiProviderFailover,
  providerCircuitKey,
} = resilience;

function providerError(message, { status, code, name } = {}) {
  const error = new Error(message);
  if (status !== undefined) error.status = status;
  if (code !== undefined) error.code = code;
  if (name !== undefined) error.name = name;
  return error;
}

function execution(overrides = {}) {
  return executeAiProviderFailover({
    operation: 'TEST_STRUCTURED_OPERATION',
    capability: AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT,
    correlationId: 'tenant-safe-correlation',
    primaryProvider: 'VERTEX',
    primaryModel: 'gemini-test',
    secondaryProvider: 'OPENAI',
    secondaryModel: 'openai-test',
    primaryTimeoutMs: 50,
    secondaryTimeoutMs: 50,
    totalTimeoutMs: 120,
    failoverEnabled: true,
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
  });
}

test('exports the shared provider capability, circuit, and execution contracts', () => {
  assert.equal(typeof providerCircuitKey, 'function');
  assert.equal(typeof ProviderCircuitBreakerRegistry, 'function');
  assert.equal(typeof executeAiProviderFailover, 'function');
  assert.equal(AI_PROVIDER_CAPABILITIES.STRUCTURED_TEXT, 'STRUCTURED_TEXT');
});

test('provider circuit keys isolate provider, model, and capability but not tenants', () => {
  const structured = providerCircuitKey({ provider: ' vertex ', model: ' Gemini-Test ', capability: 'structured_text' });
  const samePlatformBoundary = providerCircuitKey({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' });
  const multimodal = providerCircuitKey({ provider: 'VERTEX', model: 'gemini-test', capability: 'IMAGE_UNDERSTANDING_STRUCTURED' });
  assert.equal(structured, 'VERTEX:gemini-test:STRUCTURED_TEXT');
  assert.equal(samePlatformBoundary, structured);
  assert.notEqual(multimodal, structured);
});

test('circuit registry shares an exact platform boundary and isolates different boundaries', () => {
  const registry = new ProviderCircuitBreakerRegistry();
  const first = registry.get({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' });
  const same = registry.get({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' });
  const secondary = registry.get({ provider: 'OPENAI', model: 'openai-test', capability: 'STRUCTURED_TEXT' });
  assert.equal(first, same);
  assert.notEqual(first, secondary);
});

test('Vertex success returns provider-native output without calling OpenAI', async () => {
  let secondaryCalls = 0;
  const result = await execution({
    primary: async () => ({ value: 'primary' }),
    secondary: async () => { secondaryCalls += 1; return { value: 'secondary' }; },
  });
  assert.deepEqual(result.output, { value: 'primary' });
  assert.equal(result.provider, 'VERTEX');
  assert.equal(result.fallbackUsed, false);
  assert.equal(secondaryCalls, 0);
});

test('permission failure opens the primary circuit immediately and falls back with a fresh signal', async () => {
  const registry = new ProviderCircuitBreakerRegistry({
    createBreaker: () => new ProviderCircuitBreaker({ failureThreshold: 10, logger: { info() {}, warn() {} } }),
  });
  let primarySignal;
  let secondarySignal;
  const result = await execution({
    circuitRegistry: registry,
    primary: async ({ signal }) => { primarySignal = signal; throw providerError('project suspended', { status: 403 }); },
    secondary: async ({ signal }) => { secondarySignal = signal; return 'fallback'; },
  });
  assert.equal(result.output, 'fallback');
  assert.equal(result.provider, 'OPENAI');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.failoverReason, 'PROVIDER_PERMISSION_DENIED');
  assert.notEqual(primarySignal, secondarySignal);
  assert.equal(secondarySignal.aborted, false);
  assert.equal(registry.get({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' }).getState(), 'OPEN');
});

test('authentication failure opens the exact primary circuit immediately', async () => {
  const registry = new ProviderCircuitBreakerRegistry({
    createBreaker: () => new ProviderCircuitBreaker({ failureThreshold: 10, logger: { info() {}, warn() {} } }),
  });
  await execution({
    circuitRegistry: registry,
    primary: async () => { throw providerError('unauthenticated', { status: 401 }); },
    secondary: async () => 'fallback',
  });
  assert.equal(registry.get({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' }).getState(), 'OPEN');
  assert.equal(registry.get({ provider: 'OPENAI', model: 'openai-test', capability: 'STRUCTURED_TEXT' }).getState(), 'CLOSED');
});

test('transient failures open only after the configured threshold and then skip Vertex', async () => {
  const registry = new ProviderCircuitBreakerRegistry({
    createBreaker: () => new ProviderCircuitBreaker({ failureThreshold: 2, logger: { info() {}, warn() {} } }),
  });
  let primaryCalls = 0;
  const options = {
    circuitRegistry: registry,
    primary: async () => { primaryCalls += 1; throw providerError('socket reset', { code: 'ECONNRESET' }); },
    secondary: async () => 'fallback',
  };
  await execution(options);
  assert.equal(registry.get({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' }).getState(), 'CLOSED');
  await execution(options);
  assert.equal(registry.get({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' }).getState(), 'OPEN');
  const result = await execution(options);
  assert.equal(primaryCalls, 2);
  assert.equal(result.failoverReason, 'CIRCUIT_BREAKER_OPEN');
});

test('caller cancellation does not invoke either provider or fallback', async () => {
  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  let calls = 0;
  await assert.rejects(
    execution({
      signal: controller.signal,
      primary: async () => { calls += 1; return 'primary'; },
      secondary: async () => { calls += 1; return 'secondary'; },
    }),
    (error) => error.name === 'AbortError',
  );
  assert.equal(calls, 0);
});

test('application schema errors do not fall back or affect the shared circuit', async () => {
  const registry = new ProviderCircuitBreakerRegistry();
  const schemaError = providerError('invalid structured output', { code: 'KNOWLEDGE_GENERATION_SCHEMA_INVALID' });
  let secondaryCalls = 0;
  await assert.rejects(
    execution({
      circuitRegistry: registry,
      primary: async () => { throw schemaError; },
      secondary: async () => { secondaryCalls += 1; return 'secondary'; },
    }),
    (error) => error === schemaError,
  );
  assert.equal(secondaryCalls, 0);
  assert.equal(registry.get({ provider: 'VERTEX', model: 'gemini-test', capability: 'STRUCTURED_TEXT' }).getState(), 'CLOSED');
});

test('a provider that ignores abort still settles at the hard deadline and uses OpenAI', async () => {
  const startedAt = Date.now();
  const result = await execution({
    primaryTimeoutMs: 10,
    secondaryTimeoutMs: 20,
    totalTimeoutMs: 60,
    primary: async () => new Promise(() => {}),
    secondary: async ({ signal }) => {
      assert.equal(signal.aborted, false);
      return 'fallback-after-timeout';
    },
  });
  assert.equal(result.output, 'fallback-after-timeout');
  assert.equal(result.failoverReason, 'PROVIDER_TIMEOUT');
  assert.ok(Date.now() - startedAt < 60);
});

test('both providers unavailable returns one bounded actionable failure with safe telemetry', async () => {
  const events = [];
  await assert.rejects(
    execution({
      telemetry: (event) => events.push(event),
      primary: async () => { throw providerError('private primary detail', { status: 503 }); },
      secondary: async () => { throw providerError('private secondary detail', { code: 'ECONNRESET' }); },
    }),
    (error) => {
      assert.ok(error instanceof AllAiProvidersFailedError);
      assert.equal(error.code, 'ALL_AI_PROVIDERS_FAILED');
      assert.equal(error.safeMetadata.primaryClassification, 'PROVIDER_CAPACITY_UNAVAILABLE');
      assert.equal(error.safeMetadata.secondaryClassification, 'PROVIDER_NETWORK_ERROR');
      return true;
    },
  );
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /private primary|private secondary/i);
  assert.match(serialized, /fallback_failed/);
});
