import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('Guide session handoff saves only server-scoped context without invoking the provider', () => {
  const start = source.indexOf('app.post("/guide/session-context"');
  const end = source.indexOf('app.post("/chat"', start);
  assert.ok(start >= 0, 'expected a Guide session handoff route');
  const route = source.slice(start, end);
  assert.match(route, /resolveGuideRuntimeScope/);
  assert.match(route, /saveGuideSessionContext/);
  assert.match(route, /issueOrResolvePublicConversationSession/);
  assert.doesNotMatch(route, /requestGemini|resolveChannelAssistantRuntime/);
});

test('Guide runtime routes use opaque scoped resume sessions and canonical response events', () => {
  assert.match(source, /issueGuideResumeSession/);
  assert.match(source, /resolveGuideResumeSession/);
  assert.match(source, /canonicalGuideResponseEvents/);
  assert.match(source, /guide_events/);
  assert.match(source, /\/guide\/session-context/);
  assert.doesNotMatch(source, /X-Samcheguide-Session.*sessionStorage/);
  assert.ok(source.indexOf('let publishedExperience;') < source.indexOf('publishedExperience = await resolveGuideExperienceForScope'));
});
