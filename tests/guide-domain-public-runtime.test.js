import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public Guide bootstrap derives scope from the trusted request hostname rather than a static integration or browser query', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(source, /resolveGuideRuntimeScopeFromRequest/);
  assert.match(source, /resolveGuideRuntimeScopeFromRequest/);
  assert.doesNotMatch(source, /app\.get\("\/guide\/bootstrap", async \(_req, res\) =>[\s\S]{0,900}resolveSamcheguideRuntimeIntegration/);
  assert.doesNotMatch(source, /req\.query\.(?:tenant|tenant_id|assistant|assistant_id)/);
  assert.match(source, /app\.use\('\/guide', async \(req, res, next\) =>[\s\S]{0,350}return res\.sendStatus\(404\)/);
});

test('the shared public Guide shell bootstraps from its own trusted host with no tenant-specific rendering branch', () => {
  const script = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');
  assert.match(script, /fetch\('\/guide\/bootstrap'/);
  assert.doesNotMatch(script, /Blue Dune|Meridian|tenant\s*===/i);
});
