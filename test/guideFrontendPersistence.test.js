import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');

test('1. Roadmap selected category is restored from persisted state', () => {
  assert.match(source, /roadmap_category/);
  assert.match(source, /guideState\.roadmap_category = rm\.category/);
});

test('2. Roadmap goal/input is restored', () => {
  assert.match(source, /roadmap_goal/);
  assert.match(source, /guideState\.roadmap_goal = rm\.initialGoal/);
});

test('3. generated Roadmap result is restored', () => {
  assert.match(source, /roadmap_result/);
  assert.match(source, /guideState\.roadmap_result = rm\.generatedAnalysis/);
});

test('4. Roadmap follow-up history is restored', () => {
  assert.match(source, /roadmap_messages/);
  assert.match(source, /guideState\.roadmap_messages = rm\.messages/);
});

test('5. Roadmap result remains visible while follow-up conversation continues', () => {
  assert.match(source, /guide-roadmap-result/);
  assert.match(source, /guide-roadmap-result__title/);
  assert.match(source, /Generated Roadmap Strategy/);
});

test('6. Roadmap -> Planning -> Assistant -> Roadmap does not reset Roadmap', () => {
  assert.match(source, /persistState\(\)/);
  assert.match(source, /loadState\(\)/);
  assert.match(source, /renderActiveModule\(\)/);
});

test('7. refresh/bootstrap reconstructs Roadmap from persisted state', () => {
  assert.match(source, /resumeGuideSession/);
  assert.match(source, /\/guide\/session-context/);
});

test('8. Roadmap follow-up messages do NOT enter Assistant visible history', () => {
  assert.match(source, /renderAssistant/);
  assert.match(source, /renderConversationalRoadmap/);
  assert.doesNotMatch(source, /guideState\.roadmap_messages\.push.*messages\.push/);
});

test('9. Assistant existing visible thread remains independent', () => {
  assert.match(source, /messages = history\.messages/);
  assert.match(source, /preservedAssistantChat/);
});

test('10. Roadmap save/restore uses current Guide session scope', () => {
  assert.match(source, /'X-Samcheguide-Session': session/);
  assert.match(source, /previewToken/);
});

test('11. failed save does not erase currently visible Roadmap state', () => {
  assert.match(source, /The guide is temporarily unavailable\. Please try again\./);
  assert.doesNotMatch(source, /catch[^{]*guideState\.roadmap_result = null/);
});

test('12. duplicate Analyze/follow-up submission is guarded where applicable', () => {
  assert.match(source, /if \(form\.dataset\.submitting\) return/);
  assert.match(source, /dataset\.submitting/);
});

test('13. a failed Guide delivery retries with the same idempotency key', () => {
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /pendingIdempotencyKey/);
  assert.match(source, /onFailure/);
});
