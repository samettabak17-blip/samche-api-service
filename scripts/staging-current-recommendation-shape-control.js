import { buildRecommendationResponseSchema } from '../services/knowledge-generation-provider.js';

const key = process.env.STAGING_GEMINI_API_KEY;
const schema = buildRecommendationResponseSchema();
const prefix = 'Create an AI recommendation with schema_version 2 for a fictional generic tenant Assistant using only the supplied fictional active business profile. Never use another business as a default. Recommendations are proposals; mark unsupported behavior as evidence gaps. Assistant display name: Generic Assistant. ACTIVE factual Business Profile: ';
const prompt = `${prefix}${'placeholder factual profile entry. '.repeat(120)}`.slice(0, 2808);
const body = {
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' } },
};
const shape = {
  top_level_keys: Object.keys(body),
  contents_count: body.contents.length,
  parts_count: body.contents[0].parts.length,
  prompt_character_count: prompt.length,
  generation_config_keys: Object.keys(body.generationConfig),
  response_schema_keys: Object.keys(schema),
  schema_property_count: Object.keys(schema.properties).length,
  schema_serialized_character_count: JSON.stringify(schema).length,
  request_byte_count: Buffer.byteLength(JSON.stringify(body)),
};
if (!key) {
  console.log(JSON.stringify({ request_count: 0, classification: 'SECRET_NOT_AVAILABLE', shape }));
  process.exit(0);
}
const started = Date.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30000);
try {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: controller.signal, body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null);
  console.log(JSON.stringify({ request_count: 1, http_status: response.status, response_received: true, structured_response: Boolean(parsed?.candidates?.[0]?.content?.parts?.length), elapsed_ms: Date.now() - started, classification: response.ok ? 'SUCCESS' : 'HTTP_ERROR', shape }));
} catch (error) {
  console.log(JSON.stringify({ request_count: 1, http_status: null, response_received: false, structured_response: false, elapsed_ms: Date.now() - started, classification: controller.signal.aborted ? 'ABORT_TIMEOUT' : 'NETWORK_ERROR', shape }));
} finally { clearTimeout(timer); }
