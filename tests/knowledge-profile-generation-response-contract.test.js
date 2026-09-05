import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');

test('Business Profile generation returns a durable accepted-job contract', () => {
  assert.match(source, /const prepared = await prepareBusinessProfileGeneration/);
  assert.match(source, /const job = await enqueueBusinessProfileGenerationJob/);
  assert.match(source, /res\.status\(202\)\.json\(\{ job, reused: job\.status === 'READY' \}\)/);
  assert.match(source, /profiles\/generation-jobs\/:jobId/);
  assert.doesNotMatch(source, /const result = await generateBusinessProfileVersion/);
});
