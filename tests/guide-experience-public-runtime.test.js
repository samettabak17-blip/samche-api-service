import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public Guide bootstrap resolves presentation from the canonical Guide integration, never browser tenant input', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(source, /app\.get\("\/guide\/bootstrap"/);
  assert.match(source, /resolveSamcheguideRuntimeIntegration\(\{ database: pool \}\)/);
  assert.match(source, /resolvePublishedGuideExperience\(\{[\s\S]*tenantId: integration\.tenant_id[\s\S]*assistantId: integration\.assistant_id/);
  assert.doesNotMatch(source, /req\.query\.tenant_id/);
});

test('shared Guide shell is data driven and contains no tenant-specific presentation branches', () => {
  const html = fs.readFileSync(new URL('../public-guide/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');
  assert.match(html, /id="guide-root"/);
  assert.match(script, /applyExperience/);
  assert.match(script, /\/guide\/bootstrap/);
  assert.doesNotMatch(script, /Blue Dune|Meridian|tenant\s*===/i);
});
