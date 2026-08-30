const fields = [
  'schema_version', 'assistant_identity', 'role_and_purpose', 'company_context',
  'assistant_instructions', 'tone', 'greeting', 'customer_handling', 'faq_guidance',
  'qualification_guidance', 'fallback_guidance', 'escalation_guidance', 'sales_guidance',
  'prohibited_claims', 'follow_up_behavior', 'scheduled_messaging_behavior',
  'supported_languages', 'language_selection_policy', 'unsupported_claim_behavior',
  'terminology', 'operating_rules', 'channel_adaptations', 'recommendation_rationale',
  'evidence_gaps',
];
const responseSchema = {
  type: 'OBJECT',
  properties: Object.fromEntries(fields.map((field) => [field, field === 'schema_version'
    ? { type: 'INTEGER' }
    : { anyOf: [{ type: 'STRING' }, { type: 'ARRAY', items: { type: 'STRING' } }] }])),
};

const started = Date.now();
const key = process.env.STAGING_GEMINI_API_KEY;
if (!key) {
  console.log(JSON.stringify({ request_count: 0, http_status: null, response_received: false, structured_response_present: false, schema_valid: false, elapsed_ms: 0, classification: 'NETWORK_ERROR' }));
  process.exit(0);
}
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30000);
try {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: controller.signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Return a concise valid assistant recommendation for a fictional generic business.' }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema, thinkingConfig: { thinkingLevel: 'low' } },
    }),
  });
  const body = await response.json().catch(() => null);
  const text = body?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim() || '';
  let value = null;
  try { value = JSON.parse(text); } catch {}
  const schemaValid = value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([field, item]) => fields.includes(field)
      && (field === 'schema_version' ? item === 2 : (typeof item === 'string' || (Array.isArray(item) && item.every((entry) => typeof entry === 'string')))));
  console.log(JSON.stringify({ request_count: 1, http_status: response.status, response_received: true, structured_response_present: Boolean(value), schema_valid: Boolean(schemaValid), elapsed_ms: Date.now() - started, classification: !response.ok ? 'HTTP_ERROR' : schemaValid ? 'SUCCESS' : 'SCHEMA_VALIDATION_FAILED' }));
} catch (error) {
  console.log(JSON.stringify({ request_count: 1, http_status: null, response_received: false, structured_response_present: false, schema_valid: false, elapsed_ms: Date.now() - started, classification: controller.signal.aborted ? 'ABORT_TIMEOUT' : 'NETWORK_ERROR' }));
} finally {
  clearTimeout(timer);
}
