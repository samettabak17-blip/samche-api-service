import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiImageKnowledgeExtractor } from '../services/image-knowledge-gemini-extractor.js';

const png = (width = 1, height = 2) => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};
const jpeg = () => Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
  0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0xff, 0xd9,
]);

function response(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return { candidates: [{ content: { parts: [{ text }] } }] }; } };
}

const output = JSON.stringify({
  text: 'Question and answer.', extractionConfidence: 0.9,
  segments: [
    { order: 0, text: 'Can we pay on the event day?', role: 'CUSTOMER', confidence: 0.8 },
    { order: 1, text: 'Payment is due before the event.', role: 'BUSINESS', confidence: 0.95 },
    { order: 2, text: 'Forwarded message', role: 'UNKNOWN', confidence: 0.3 },
  ],
});

test('sends one safe structured Gemini image request and converts roles canonically', async () => {
  const requests = [];
  const extractor = createGeminiImageKnowledgeExtractor({
    env: { GEMINI_API_KEY: 'secret-key', KNOWLEDGE_GENERATION_MODEL: 'gemini-3-flash-preview' },
    fetchImpl: async (url, request) => { requests.push({ url, request, body: JSON.parse(request.body) }); return response(output); },
  });
  const result = await extractor.extract({ bytes: png(), mimeType: 'image/png', sourceHash: 'a'.repeat(64) });
  assert.deepEqual(result.segments.map(({ role }) => role), ['CUSTOMER', 'BUSINESS', 'UNKNOWN']);
  assert.equal(result.sourceHash, 'a'.repeat(64));
  assert.equal(result.extractionMethod, 'GEMINI_VISION');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(requests[0].body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(requests[0].request.headers['x-goog-api-key'], 'secret-key');
});

test('accepts JPEG input and preserves its canonical MIME type', async () => {
  const extractor = createGeminiImageKnowledgeExtractor({
    env: { GEMINI_API_KEY: 'key' },
    fetchImpl: async () => response(output),
  });
  const result = await extractor.extract({ bytes: jpeg(), mimeType: 'image/jpeg', sourceHash: 'a'.repeat(64) });
  assert.equal(result.mimeType, 'image/jpeg');
});

test('rejects malformed JSON, empty output, and provider HTTP failures safely', async () => {
  const make = (fetchImpl) => createGeminiImageKnowledgeExtractor({ env: { GEMINI_API_KEY: 'key' }, fetchImpl });
  await assert.rejects(() => make(async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: '{bad' }] } }] }; } })).extract({ bytes: png(), mimeType: 'image/png', sourceHash: 'b'.repeat(64) }), { code: 'IMAGE_PROVIDER_JSON_INVALID' });
  await assert.rejects(() => make(async () => response(JSON.stringify({ text: '', segments: [] }), 200)).extract({ bytes: png(), mimeType: 'image/png', sourceHash: 'b'.repeat(64) }), { code: 'IMAGE_EXTRACTION_CANONICAL_INVALID' });
  await assert.rejects(() => make(async () => response('', 400)).extract({ bytes: png(), mimeType: 'image/png', sourceHash: 'c'.repeat(64) }), { code: 'IMAGE_PROVIDER_HTTP_4XX' });
});

test('maps timeout and missing configuration without exposing provider details', async () => {
  const extractor = createGeminiImageKnowledgeExtractor({ env: { GEMINI_API_KEY: 'key', IMAGE_KNOWLEDGE_EXTRACTION_TIMEOUT_MS: '1000' }, fetchImpl: (_url, request) => new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })))) });
  await assert.rejects(() => extractor.extract({ bytes: png(), mimeType: 'image/png', sourceHash: 'd'.repeat(64) }), { code: 'IMAGE_PROVIDER_TIMEOUT' });
  await assert.rejects(() => createGeminiImageKnowledgeExtractor({ env: {} }).extract({ bytes: png(), mimeType: 'image/png', sourceHash: 'e'.repeat(64) }), { code: 'IMAGE_PROVIDER_UNAVAILABLE' });
});

test('rejects pathological decoded dimensions before any provider request', async () => {
  let requests = 0;
  const extractor = createGeminiImageKnowledgeExtractor({ env: { GEMINI_API_KEY: 'key' }, fetchImpl: async () => { requests += 1; return response(output); } });
  await assert.rejects(() => extractor.extract({ bytes: png(10000, 10000), mimeType: 'image/png', sourceHash: 'f'.repeat(64) }), { code: 'IMAGE_DIMENSIONS_INVALID' });
  assert.equal(requests, 0);
});
