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
