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
