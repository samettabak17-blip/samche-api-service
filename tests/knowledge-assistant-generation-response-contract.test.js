import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');

test('Recommendation and Configuration generation return explicit new/reused envelopes', () => {
  assert.match(source, /const result = await generateAssistantRecommendation[\s\S]*?res\.status\(result\.reused \? 200 : 201\)\.json\(result\)/);
  assert.match(source, /const result = await generateAssistantConfigurationVersion[\s\S]*?res\.status\(result\.reused \? 200 : 201\)\.json\(result\)/);
});
