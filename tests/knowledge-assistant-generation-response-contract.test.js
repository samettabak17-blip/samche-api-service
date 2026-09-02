import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');

test('Recommendation generation is accepted as a durable job while configuration remains an explicit envelope', () => {
  assert.match(source, /const prepared = await prepareAssistantRecommendationGeneration[\s\S]*?enqueueAssistantRecommendationGenerationJob[\s\S]*?res\.status\(202\)\.json\(\{ job, reused: job\.status === 'READY' \}\)/);
  assert.match(source, /recommendation-generation-jobs\/:jobId[\s\S]*?getAssistantRecommendationGenerationJob[\s\S]*?res\.json\(\{ job \}\)/);
  assert.match(source, /const result = await generateAssistantConfigurationVersion[\s\S]*?res\.status\(result\.reused \? 200 : 201\)\.json\(result\)/);
});
