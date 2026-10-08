import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('semantic worker starts only after database migrations complete', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const migration = source.indexOf('await runMigrations()');
  const workerBootstrap = source.lastIndexOf('startKnowledgeWorkers();');
  assert.ok(migration >= 0);
  assert.ok(workerBootstrap > migration);
});

test('durable generation worker is enabled by the configured provider rather than a Gemini-only gate', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(source, /knowledgeGenerationEnabled/);
  assert.match(source, /KNOWLEDGE_GENERATION_PROVIDER/);
  assert.doesNotMatch(source, /if \(googleGeminiEnabled && process\.env\.KNOWLEDGE_PROCESSING_ENABLED/);
});

test('Dashboard structured failover can enable only the semantic generation worker with OpenAI configured', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(source, /getDashboardAiProviderPolicy\('BUSINESS_PROFILE', process\.env\)/);
  assert.match(source, /dashboardStructuredFailoverEnabled && Boolean\(process\.env\.OPENAI_API_KEY\)/);
  assert.match(source, /const knowledgeGenerationEnabled = legacyKnowledgeGenerationEnabled \|\| dashboardFailoverGenerationEnabled/);
  assert.doesNotMatch(source, /DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED[\s\S]{0,200}(?:canonicalSharedAiRuntime|generateAiResponse)/);
});

test('Dashboard multimodal failover wires the capability-checked image extractor independently', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(source, /getDashboardAiProviderPolicy\('IMAGE_KNOWLEDGE_EXTRACTION', process\.env\)/);
  assert.match(source, /dashboardMultimodalFailoverEnabled && Boolean\(process\.env\.OPENAI_API_KEY\)/);
  assert.match(source, /createImageKnowledgeExtractor\(\)/);
});
