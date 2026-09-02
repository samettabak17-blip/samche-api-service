import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');

test('Recommendation and Configuration generation are accepted as durable jobs with scoped terminal-status endpoints', () => {
  assert.match(source, /const prepared = await prepareAssistantRecommendationGeneration[\s\S]*?enqueueAssistantRecommendationGenerationJob[\s\S]*?res\.status\(202\)\.json\(\{ job, reused: job\.status === 'READY' \}\)/);
  assert.match(source, /recommendation-generation-jobs\/:jobId[\s\S]*?getAssistantRecommendationGenerationJob[\s\S]*?res\.json\(\{ job \}\)/);
  assert.match(source, /const prepared = await prepareAssistantConfigurationGeneration[\s\S]*?enqueueAssistantConfigurationGenerationJob[\s\S]*?res\.status\(202\)\.json\(\{ job, reused: job\.status === 'READY' \}\)/);
  assert.match(source, /configuration-generation-jobs\/:jobId[\s\S]*?getAssistantConfigurationGenerationJob[\s\S]*?res\.json\(\{ job \}\)/);
});
