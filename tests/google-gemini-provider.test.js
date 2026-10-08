import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GoogleGeminiProviderError,
  createGoogleGeminiProvider,
  getGoogleGeminiConfig,
  resolveGoogleGeminiRuntimeModel,
  resolveGcpCredentials,
  resolveGcpProject,
} from '../services/google-gemini-provider.js';

function fakeResponse(text = 'ok') {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

test('runtime model is resolved at the platform provider boundary, never from tenant input', () => {
  assert.equal(resolveGoogleGeminiRuntimeModel({ GOOGLE_GEMINI_RUNTIME_MODEL: 'platform-model' }), 'platform-model');
  assert.equal(resolveGoogleGeminiRuntimeModel({ WHATSAPP_GEMINI_MODEL: 'legacy-platform-model' }), 'legacy-platform-model');
  assert.equal(resolveGoogleGeminiRuntimeModel({}), 'gemini-3.7-flash');
});

test('developer mode creates a Gemini Developer API client with the API key', () => {
  let options;
  const provider = createGoogleGeminiProvider({
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'developer-key' },
    clientFactory: (clientOptions) => {
      options = clientOptions;
      return { models: { generateContent: async () => fakeResponse() } };
    },
  });

  assert.equal(provider.mode, 'developer');
  assert.deepEqual(options, { apiKey: 'developer-key' });
});

test('vertex mode creates a Vertex client without requiring a Gemini API key', () => {
  let options;
  const provider = createGoogleGeminiProvider({
    env: {
      GOOGLE_GENAI_MODE: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'samche-test',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
    },
    clientFactory: (clientOptions) => {
      options = clientOptions;
      return { models: { generateContent: async () => fakeResponse() } };
    },
  });

  assert.equal(provider.mode, 'vertex');
  assert.deepEqual(options, { vertexai: true, project: 'samche-test', location: 'us-central1' });
});

test('developer mode requires GEMINI_API_KEY', () => {
  assert.throws(
    () => createGoogleGeminiProvider({ env: { GOOGLE_GENAI_MODE: 'developer' }, clientFactory: () => null }),
    (error) => error instanceof GoogleGeminiProviderError && error.code === 'GOOGLE_GEMINI_API_KEY_REQUIRED',
  );
});

test('vertex mode uses platform defaults when project and location are omitted', () => {
  const config = getGoogleGeminiConfig({ GOOGLE_GENAI_MODE: 'vertex' });
  assert.equal(config.project, 'samche-ai-development-2');
  assert.equal(config.location, 'global');
});

test('adapter normalizes text and multimodal requests without exposing SDK response types', async () => {
  let request;
  const provider = createGoogleGeminiProvider({
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'developer-key' },
    clientFactory: () => ({
      models: {
        generateContent: async (params) => {
          request = params;
          return fakeResponse('normalized');
        },
      },
    }),
  });

  const result = await provider.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ role: 'user', parts: [{ text: 'hello' }, { inline_data: { mime_type: 'image/png', data: 'abc' } }] }],
    generationConfig: { temperature: 0 },
    systemInstruction: { parts: [{ text: 'system' }] },
  });

  assert.equal(result.candidates[0].content.parts[0].text, 'normalized');
  assert.equal(request.model, 'gemini-3-flash-preview');
  assert.equal(request.config.systemInstruction.parts[0].text, 'system');
  assert.deepEqual(request.contents[0].parts[1].inlineData, { mimeType: 'image/png', data: 'abc' });
  assert.equal(request.generationConfig, undefined);
});

test('adapter passes caller signal as config.abortSignal and preserves request config', async () => {
  let request;
  const signal = new AbortController().signal;
  const provider = createGoogleGeminiProvider({
    env: { GEMINI_API_KEY: 'developer-key' },
    clientFactory: () => ({
      models: {
        generateContent: async (params) => {
          request = params;
          return fakeResponse();
        },
      },
    }),
  });

  await provider.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    generationConfig: {
      temperature: 0,
      safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }],
      httpOptions: { timeout: 60000, headers: { 'x-test': 'preserve' } },
    },
    systemInstruction: { parts: [{ text: 'system' }] },
    signal,
  });

  assert.equal(request.config.abortSignal, signal);
  assert.equal(request.config.temperature, 0);
  assert.deepEqual(request.config.safetySettings, [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }]);
  assert.deepEqual(request.config.httpOptions, { timeout: 60000, headers: { 'x-test': 'preserve' } });
  assert.equal(request.signal, undefined);
});

test('adapter applies a 20-second SDK timeout when no caller signal is supplied', async () => {
  let request;
  const provider = createGoogleGeminiProvider({
    env: { GEMINI_API_KEY: 'developer-key' },
    clientFactory: () => ({
      models: {
        generateContent: async (params) => {
          request = params;
          return fakeResponse();
        },
      },
    }),
  });

  await provider.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    generationConfig: { temperature: 0 },
  });

  assert.equal(request.config.httpOptions.timeout, 20000);
  assert.equal(request.config.abortSignal, undefined);
});

test('adapter preserves an SDK abort as GOOGLE_GEMINI_TIMEOUT', async () => {
  const provider = createGoogleGeminiProvider({
    env: { GEMINI_API_KEY: 'developer-key' },
    clientFactory: () => ({
      models: {
        generateContent: async () => {
          const error = new Error('request aborted');
          error.name = 'AbortError';
          throw error;
        },
      },
    }),
  });

  await assert.rejects(
    provider.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    }),
    (error) => error instanceof GoogleGeminiProviderError && error.code === 'GOOGLE_GEMINI_TIMEOUT',
  );
});

test('adapter retains safe HTTP rejection metadata without retaining provider response content', async () => {
  const provider = createGoogleGeminiProvider({
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'developer-key' },
    clientFactory: () => ({
      models: {
        generateContent: async () => {
          const error = new Error('provider rejected a request body that must remain private');
          error.status = 400;
          throw error;
        },
      },
    }),
  });

  await assert.rejects(
    provider.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    }),
    (error) => {
      assert.ok(error instanceof GoogleGeminiProviderError);
      assert.equal(error.code, 'GOOGLE_GEMINI_HTTP_4XX');
      assert.deepEqual(error.safeMetadata, {
        provider: 'GOOGLE_GEMINI',
        mode: 'developer',
        model: 'gemini-3-flash-preview',
        endpoint_class: 'GEMINI_DEVELOPER_GENERATE_CONTENT',
        http_status: 400,
      });
      assert.doesNotMatch(JSON.stringify(error.safeMetadata), /private|body|response/i);
      return true;
    },
  );
});

test('adapter logs only normalized provider metadata and never raw upstream content', async () => {
  const logEntries = [];
  const originalError = console.error;
  console.error = (...args) => logEntries.push(args);
  try {
    const provider = createGoogleGeminiProvider({
      env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'developer-key' },
      clientFactory: () => ({
        models: {
          generateContent: async () => {
            const error = new Error('private customer message must never be logged');
            error.status = 403;
            error.response = { data: { error: { message: 'secret upstream response' } } };
            throw error;
          },
        },
      }),
    });

    await assert.rejects(
      provider.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'private prompt' }] }],
      }),
      (error) => error instanceof GoogleGeminiProviderError && error.code === 'GOOGLE_GEMINI_AUTH_FAILED',
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(logEntries.length, 1);
  assert.equal(logEntries[0][0], 'GOOGLE_GEMINI_REQUEST_FAILED');
  assert.deepEqual(logEntries[0][1], {
    provider: 'GOOGLE_GEMINI',
    mode: 'developer',
    model: 'gemini-3-flash-preview',
    endpoint_class: 'GEMINI_DEVELOPER_GENERATE_CONTENT',
    http_status: 403,
    code: 'GOOGLE_GEMINI_AUTH_FAILED',
  });
  assert.doesNotMatch(JSON.stringify(logEntries), /private|secret|response|prompt/i);
});

test('requested runtime callers route through the centralized adapter', async () => {
  const sources = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../services/knowledge-generation-provider.js', import.meta.url), 'utf8'),
    readFile(new URL('../services/image-knowledge-gemini-extractor.js', import.meta.url), 'utf8'),
    readFile(new URL('../services/lead-qualification-runner.js', import.meta.url), 'utf8'),
  ]);

  assert.match(sources[0], /createGoogleGeminiProvider/);
  assert.match(sources[1], /createGoogleGeminiProvider/);
  assert.match(sources[2], /createGoogleGeminiProvider/);
  assert.match(sources[3], /createGoogleGeminiProvider/);
  for (const source of sources) assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/);
});

test('/chat preserves a safe normalized provider code and logs only mode, model, and code', async () => {
  const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(appSource, /SAMCHE_GOOGLE_GEMINI_ERROR mode=\$\{\(provider \|\| googleGeminiProvider\)\.mode\} model=\$\{runtimeModel\} code=\$\{safeCode\}/);
  assert.match(appSource, /upstreamError\.code = safeCode/);
  assert.match(appSource, /console\.error\(`SAMCHE_GOOGLE_GEMINI_ERROR mode=\$\{\(provider \|\| googleGeminiProvider\)\.mode\} model=\$\{runtimeModel\} code=\$\{safeCode\}`\)/);
  assert.doesNotMatch(appSource, /console\.error\(`SAMCHE_GOOGLE_GEMINI_ERROR[^\n]*(?:cause|prompt|request|tenant|credential|headers|url)/i);
});

test('/chat emits safe stage diagnostics through the shared public failure boundary', async () => {
  const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const chatSource = appSource.slice(appSource.indexOf('app.post("/chat"'));
  const requestReceived = chatSource.indexOf('CHAT_REQUEST_RECEIVED');
  const sessionResolution = chatSource.indexOf('issueOrResolvePublicConversationSession(req, guideRuntimeIntegration');
  const geminiStarted = chatSource.indexOf('CHAT_GEMINI_STARTED');
  const geminiInvocation = chatSource.indexOf('requestGemini({', geminiStarted);
  const geminiFailed = chatSource.indexOf('CHAT_GEMINI_FAILED code=');
  const geminiCatch = chatSource.indexOf('catch (error)', geminiStarted);

  assert.ok(requestReceived >= 0 && requestReceived < sessionResolution);
  assert.ok(geminiStarted >= 0 && geminiStarted < geminiInvocation);
  assert.ok(geminiFailed >= 0 && geminiFailed > geminiCatch);
  assert.match(chatSource, /logPublicChatFailure\(\{[\s\S]*?route: '\/chat',[\s\S]*?stage: 'outer_handler'/);
  assert.match(chatSource, /return res\.status\(503\)\.json\(buildPublicChatFailure\(\{/);
  assert.doesNotMatch(chatSource, /safeMessage|safeStack|Could not generate chat response/);
});

test('resolveGcpCredentials parses service account JSON and normalizes escaped newlines', () => {
  const jsonCreds = JSON.stringify({
    type: 'service_account',
    project_id: 'gen-lang-client-0739267616',
    client_email: 'sa@gen-lang-client-0739267616.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3\\n-----END PRIVATE KEY-----\\n',
  });
  const resolved = resolveGcpCredentials({ GOOGLE_APPLICATION_CREDENTIALS: jsonCreds });
  assert.ok(resolved?.credentials);
  assert.equal(resolved.credentials.project_id, 'gen-lang-client-0739267616');
  assert.ok(resolved.credentials.private_key.includes('\n'));
  assert.ok(!resolved.credentials.private_key.includes('\\n'));
});

test('resolveGcpProject prioritizes dedicated service account project over legacy gen-lang-client', () => {
  const jsonCreds = JSON.stringify({
    type: 'service_account',
    project_id: 'samche-ai-development-2',
    client_email: 'sa@samche-ai-development-2.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
  });
  const resolved = resolveGcpProject({
    GOOGLE_CLOUD_PROJECT: 'gen-lang-client-0739267616',
    GOOGLE_APPLICATION_CREDENTIALS: jsonCreds,
  });
  assert.equal(resolved, 'samche-ai-development-2');
});

test('vertex mode wires googleAuthOptions when service account credentials are present', () => {
  let options;
  const jsonCreds = JSON.stringify({
    type: 'service_account',
    project_id: 'gen-lang-client-0739267616',
    client_email: 'sa@gen-lang-client-0739267616.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
  });
  const provider = createGoogleGeminiProvider({
    env: {
      GOOGLE_GENAI_MODE: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'gen-lang-client-0739267616',
      GOOGLE_CLOUD_LOCATION: 'global',
      GOOGLE_APPLICATION_CREDENTIALS: jsonCreds,
    },
    clientFactory: (clientOptions) => {
      options = clientOptions;
      return { models: { generateContent: async () => fakeResponse() } };
    },
  });

  assert.equal(provider.mode, 'vertex');
  assert.equal(options.vertexai, true);
  assert.equal(options.project, 'gen-lang-client-0739267616');
  assert.equal(options.location, 'global');
  assert.ok(options.googleAuthOptions);
  assert.equal(options.googleAuthOptions.credentials.client_email, 'sa@gen-lang-client-0739267616.iam.gserviceaccount.com');
});

test('vertex mode retries with default model when primary model fails', async () => {
  const modelsCalled = [];
  const provider = createGoogleGeminiProvider({
    env: {
      GOOGLE_GENAI_MODE: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'samche-test',
      GOOGLE_CLOUD_LOCATION: 'global',
      GOOGLE_GEMINI_RUNTIME_MODEL: 'gemini-3.7-flash',
    },
    clientFactory: () => ({
      models: {
        generateContent: async ({ model }) => {
          modelsCalled.push(model);
          if (model === 'gemini-2.5-pro') {
            const err = new Error('model unavailable');
            err.status = 404;
            throw err;
          }
          return fakeResponse('retry-success');
        },
      },
    }),
  });

  const res = await provider.generateContent({
    model: 'gemini-2.5-pro',
    contents: [{ role: 'user', parts: [{ text: 'test' }] }],
  });

  assert.deepEqual(modelsCalled, ['gemini-2.5-pro', 'gemini-3.7-flash']);
  assert.equal(res.structured_text, 'retry-success');
});

test('vertex permission failure does not retry another model', async () => {
  const modelsCalled = [];
  const provider = createGoogleGeminiProvider({
    env: {
      GOOGLE_GENAI_MODE: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'samche-test',
      GOOGLE_CLOUD_LOCATION: 'global',
      GOOGLE_GEMINI_RUNTIME_MODEL: 'gemini-3.7-flash',
    },
    clientFactory: () => ({
      models: {
        generateContent: async ({ model }) => {
          modelsCalled.push(model);
          const error = new Error('Permission denied');
          error.status = 403;
          throw error;
        },
      },
    }),
  });

  await assert.rejects(
    () => provider.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
    }),
    (error) => {
      assert.equal(error.code, 'GOOGLE_VERTEX_PERMISSION_DENIED');
      assert.equal(error.safeMetadata.model, 'gemini-3-flash-preview');
      assert.equal(error.safeMetadata.http_status, 403);
      return true;
    },
  );
  assert.deepEqual(modelsCalled, ['gemini-3-flash-preview']);
});

test('vertex timeout with an aborted signal does not retry another model', async () => {
  const modelsCalled = [];
  const controller = new AbortController();
  const provider = createGoogleGeminiProvider({
    env: {
      GOOGLE_GENAI_MODE: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'samche-test',
      GOOGLE_CLOUD_LOCATION: 'global',
      GOOGLE_GEMINI_RUNTIME_MODEL: 'gemini-3.7-flash',
    },
    clientFactory: () => ({
      models: {
        generateContent: async ({ model }) => {
          modelsCalled.push(model);
          controller.abort();
          const error = new Error('request aborted');
          error.name = 'AbortError';
          throw error;
        },
      },
    }),
  });

  await assert.rejects(
    () => provider.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      signal: controller.signal,
    }),
    (error) => {
      assert.equal(error.code, 'GOOGLE_GEMINI_TIMEOUT');
      assert.equal(error.safeMetadata.model, 'gemini-3-flash-preview');
      return true;
    },
  );
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(modelsCalled, ['gemini-3-flash-preview']);
});

test('normalizeRequestError correctly distinguishes 404 model unavailable from permission denied', async () => {
  const provider = createGoogleGeminiProvider({
    env: {
      GOOGLE_GENAI_MODE: 'vertex',
      GOOGLE_CLOUD_PROJECT: 'samche-test',
      GOOGLE_CLOUD_LOCATION: 'global',
    },
    clientFactory: () => ({
      models: {
        generateContent: async () => {
          const err = new Error('This model is no longer available to new users. Please update your code to use models/gemini-3.8-flash');
          err.status = 404;
          throw err;
        },
      },
    }),
  });

  await assert.rejects(
    () => provider.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'test' }] }],
    }),
    (err) => {
      assert.equal(err.code, 'GOOGLE_GEMINI_MODEL_UNAVAILABLE');
      assert.equal(err.safeMetadata.http_status, 404);
      return true;
    },
  );
});

