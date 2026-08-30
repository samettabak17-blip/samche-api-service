import { buildRecommendationResponseSchema } from '../services/knowledge-generation-provider.js';

const key = process.env.STAGING_GEMINI_API_KEY;
const schema = buildRecommendationResponseSchema();
const prompts = [
  { name: 'SYNTHETIC_PROMPT_SHAPE', text: 'Create an AI recommendation with schema_version 2 for the current tenant Assistant using only the ACTIVE factual Business Profile below. Never use a platform persona or another tenant. Recommendations are proposals, not source-derived facts. Mark unsupported behavior in evidence_gaps instead of inventing policy. Assistant display name: Generic Assistant. ACTIVE factual Business Profile: {"company_identity":"Fictional Example","services":["Consulting"]}.' },
  { name: 'SYNTHETIC_CONTEXT_SIZE', text: `Create an AI recommendation with schema_version 2 for a fictional generic business. Use only the supplied fictional profile and return concise proposal fields. Fictional profile context: ${'placeholder business fact '.repeat(90)}` },
  { name: 'SYNTHETIC_PROFILE_SHAPE', text: `Create an AI recommendation with schema_version 2 for a fictional generic business. Never use platform or tenant-specific defaults. ACTIVE factual Business Profile: ${JSON.stringify({ schema_version: 2, company_identity: 'Fictional Example LLC', company_display_name: 'Fictional Example', company_summary: 'Generic placeholder business.', industry: 'Professional services', business_type: 'Service provider', products: ['Example product'], services: ['Example service'], packages: ['Example package'], faq_themes: ['General support'], pricing_information: ['Pricing is not specified.'], policies: ['Use documented policies only.'], procedures: ['Use documented procedures only.'], operating_information: ['Generic operating information.'], sales_information: ['No unsupported claims.'], support_escalation_rules: ['Escalate when information is unavailable.'], tone: 'Professional', communication_style: 'Clear', customer_handling: 'Ask clarifying questions.', terminology: ['Example'], supported_languages: ['English'], unsupported_claims: ['Do not invent facts.'] })}` },
];

if (!key) {
  console.log(JSON.stringify({ classification: 'SECRET_NOT_AVAILABLE', results: [] }));
  process.exit(0);
}
const results = [];
for (const experiment of prompts) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: controller.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: experiment.text }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingLevel: 'low' } } }),
    });
    const body = await response.json().catch(() => null);
    results.push({ experiment: experiment.name, http_status: response.status, response_received: true, structured_response: Boolean(body?.candidates?.[0]?.content?.parts?.length), elapsed_ms: Date.now() - started, classification: response.ok ? 'SUCCESS' : 'HTTP_ERROR' });
  } catch (error) {
    results.push({ experiment: experiment.name, http_status: null, response_received: false, structured_response: false, elapsed_ms: Date.now() - started, classification: controller.signal.aborted ? 'ABORT_TIMEOUT' : 'NETWORK_ERROR' });
  } finally {
    clearTimeout(timer);
  }
}
console.log(JSON.stringify({ request_count: results.length, results }));
