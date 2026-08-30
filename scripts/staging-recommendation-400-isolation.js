import { buildRecommendationResponseSchema } from '../services/knowledge-generation-provider.js';

const key = process.env.STAGING_GEMINI_API_KEY;
const current = buildRecommendationResponseSchema();
const withoutEnum = { ...current, properties: { ...current.properties, schema_version: { type: 'INTEGER' } } };
const cases = [{ name: 'CURRENT_ENUM', schema: current }, { name: 'WITHOUT_ENUM', schema: withoutEnum }];
const safeMessage = (value) => String(value ?? '').replace(/https?:\/\/\S+/gi, '[url]').replace(/[^a-zA-Z0-9 _.,:;()\-]/g, '').slice(0, 160);
const results = [];
if (!key) {
  console.log(JSON.stringify({ request_count: 0, results: [], classification: 'SECRET_NOT_AVAILABLE' }));
  process.exit(0);
}
for (const item of cases) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: controller.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Return one concise recommendation field for a fictional business.' }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: item.schema, thinkingConfig: { thinkingLevel: 'low' } } }),
    });
    const body = await response.json().catch(() => null);
    results.push({ experiment: item.name, http_status: response.status, response_received: true, elapsed_ms: Date.now() - started, provider_error: response.ok ? null : { status: safeMessage(body?.error?.status), code: Number.isInteger(body?.error?.code) ? body.error.code : null, message: safeMessage(body?.error?.message) } });
  } catch (error) {
    results.push({ experiment: item.name, http_status: null, response_received: false, elapsed_ms: Date.now() - started, provider_error: { status: controller.signal.aborted ? 'ABORT_TIMEOUT' : 'NETWORK_ERROR', code: null, message: null } });
  } finally { clearTimeout(timer); }
}
console.log(JSON.stringify({ request_count: results.length, results }));
