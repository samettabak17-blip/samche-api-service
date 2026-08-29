import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');

test('Business Profile generation returns the explicit new/reused response contract', () => {
  assert.match(source, /const result = await generateBusinessProfileVersion/);
  assert.match(source, /res\.status\(result\.reused \? 200 : 201\)\.json\(result\)/);
});
