import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GoogleGeminiProviderError,
  createGoogleGeminiProvider,
  getGoogleGeminiConfig,
} from '../services/google-gemini-provider.js';

function fakeResponse(text = 'ok') {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

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

test('vertex mode requires project and location', () => {
  assert.throws(
    () => getGoogleGeminiConfig({ GOOGLE_GENAI_MODE: 'vertex', GOOGLE_CLOUD_LOCATION: 'us-central1' }),
    (error) => error instanceof GoogleGeminiProviderError && error.code === 'GOOGLE_CLOUD_PROJECT_REQUIRED',
  );
  assert.throws(
    () => getGoogleGeminiConfig({ GOOGLE_GENAI_MODE: 'vertex', GOOGLE_CLOUD_PROJECT: 'samche-test' }),
    (error) => error instanceof GoogleGeminiProviderError && error.code === 'GOOGLE_CLOUD_LOCATION_REQUIRED',
  );
});

test('adapter normalizes text and multimodal requests without exposing SDK response types', async () => {
  let request;
  const provider = createGoogleGeminiProvider({
    env: { GEMINI_API_KEY: 'developer-key' },
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
  assert.match(appSource, /SAMCHE_GOOGLE_GEMINI_ERROR mode=\$\{googleGeminiProvider\.mode\} model=gemini-3-flash-preview code=\$\{safeCode\}/);
  assert.match(appSource, /upstreamError\.code = safeCode/);
  assert.match(appSource, /console\.error\(`SAMCHE_GOOGLE_GEMINI_ERROR mode=\$\{googleGeminiProvider\.mode\} model=gemini-3-flash-preview code=\$\{safeCode\}`\)/);
  assert.doesNotMatch(appSource, /console\.error\(`SAMCHE_GOOGLE_GEMINI_ERROR[^\n]*(?:cause|prompt|request|tenant|credential|headers|url)/i);
});

test('/chat emits safe stage diagnostics without changing its response paths', async () => {
  const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const chatSource = appSource.slice(appSource.indexOf('app.post("/chat"'));
  const requestReceived = chatSource.indexOf('CHAT_REQUEST_RECEIVED');
  const sessionResolution = chatSource.indexOf('issueOrResolvePublicConversationSession(req)');
  const geminiStarted = chatSource.indexOf('CHAT_GEMINI_STARTED');
  const geminiInvocation = chatSource.indexOf('requestGemini({', geminiStarted);
  const geminiFailed = chatSource.indexOf('CHAT_GEMINI_FAILED code=');
  const geminiCatch = chatSource.indexOf('catch (error)', geminiStarted);

  assert.ok(requestReceived >= 0 && requestReceived < sessionResolution);
  assert.ok(geminiStarted >= 0 && geminiStarted < geminiInvocation);
  assert.ok(geminiFailed >= 0 && geminiFailed > geminiCatch);
  assert.match(chatSource, /CHAT_RESPONSE_503 stage=PUBLIC_SESSION_CONFIGURATION/);
  assert.match(chatSource, /CHAT_RESPONSE_503 stage=TENANT_PERSONA_UNAVAILABLE/);
  assert.match(chatSource, /CHAT_RESPONSE_503 stage=RUNTIME_CONTEXT_UNAVAILABLE/);
  assert.match(chatSource, /CHAT_RESPONSE_503 stage=OUTER_HANDLER_ERROR/);
  assert.match(chatSource, /return res\.status\(503\)\.json\(\{\s*error: "AI Guide assistant configuration is temporarily unavailable\."/);
  assert.match(chatSource, /return res\.status\(err\.status \|\| 500\)\.json\(\{ error: "Could not generate chat response\." \}\)/);

  const diagnosticMessages = [...chatSource.matchAll(/['"`](CHAT_(?:REQUEST_RECEIVED|GEMINI_STARTED|GEMINI_FAILED|RESPONSE_503)[^'"`]*)['"`]/g)].map((match) => match[1]);
  assert.ok(diagnosticMessages.length >= 7);
  for (const message of diagnosticMessages) {
    assert.doesNotMatch(message, /prompt|header|body|credential|private|secret|url|cause|stack|raw|message/i);
  }
});
