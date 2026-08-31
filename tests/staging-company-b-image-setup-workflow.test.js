import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Company B image setup is manual, staging-only, and stops before candidate approval', async () => {
  const workflow = await readFile(new URL('../.github/workflows/staging-company-b-image-setup.yml', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/staging-company-b-image-setup.js', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|schedule):/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/staging'/);
  assert.match(workflow, /STAGING_OWNER_TOKEN: \$\{\{ secrets\.STAGING_OWNER_TOKEN \}\}/);
  assert.match(workflow, /STAGING_ADMIN_TOKEN: \$\{\{ secrets\.STAGING_ADMIN_TOKEN \}\}/);
  assert.match(workflow, /STAGING_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /set -x|printenv|env\s*\||PRODUCTION|main\b/i);
  assert.match(script, /candidates\/generate/);
  assert.doesNotMatch(script, /candidates\/\$\{[^}]+\}\/approve|\/activate/);
});
