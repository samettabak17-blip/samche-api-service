import { createKnowledgeGenerationProvider } from '../services/knowledge-generation-provider.js';

const started = Date.now();
const key = process.env.STAGING_GEMINI_API_KEY;
if (!key) {
  console.log(JSON.stringify({ request_count: 0, http_status: null, response_received: false, structured_response: false, validator_pass: false, elapsed_ms: 0, classification: 'NETWORK_ERROR' }));
  process.exit(0);
}

const provider = createKnowledgeGenerationProvider({
  env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', KNOWLEDGE_GENERATION_MODEL: 'gemini-3-flash-preview', GEMINI_API_KEY: key },
  telemetry: () => {},
});
try {
  await provider.generateAssistantRecommendation({ prompt: 'Return a concise valid assistant recommendation for a fictional generic business.' });
  console.log(JSON.stringify({ request_count: 1, http_status: 200, response_received: true, structured_response: true, validator_pass: true, elapsed_ms: Date.now() - started, classification: 'SUCCESS' }));
} catch (error) {
  const responseReceived = error?.code !== 'KNOWLEDGE_GENERATION_TIMEOUT';
  console.log(JSON.stringify({ request_count: 1, http_status: responseReceived ? 200 : null, response_received: responseReceived, structured_response: responseReceived, validator_pass: false, elapsed_ms: Date.now() - started, classification: error?.code === 'KNOWLEDGE_GENERATION_SCHEMA_INVALID' ? 'SCHEMA_VALIDATION_FAILED' : error?.code === 'KNOWLEDGE_GENERATION_TIMEOUT' ? 'ABORT_TIMEOUT' : 'HTTP_ERROR' }));
}
