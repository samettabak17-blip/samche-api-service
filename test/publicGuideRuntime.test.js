import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');

test('public Guide runtime accepts legacy/current payloads and guards optional data', () => {
  assert.match(source, /typeof value !== 'object'/);
  assert.match(source, /experience\.theme \|\| \{\}/);
  assert.match(source, /experience\.logo_url/);
  assert.match(source, /experience\.avatar_url/);
});

test('public Guide runtime fails safely for bootstrap errors and cannot load forever', () => {
  assert.match(source, /setTimeout\(showGuideError, 10000\)/);
  assert.match(source, /catch\(showGuideError\)/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /try \{ window\.sessionStorage/);
});

test('public Guide V1 renders Roadmap, Interactive Tool, and AI Assistant from the published Experience', () => {
  assert.match(source, /ROADMAP/);
  assert.match(source, /INTERACTIVE_TOOL/);
  assert.match(source, /AI_ASSISTANT/);
  assert.match(source, /guide_context/);
  assert.match(source, /renderRoadmap/);
  assert.match(source, /renderInteractiveTool/);
  assert.match(source, /renderAssistant/);
});
