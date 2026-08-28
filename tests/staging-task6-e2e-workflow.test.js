import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Task 6 staging E2E workflow is manual, staging-only, least privilege, and always cleans up', async () => {
  const yaml = await readFile(new URL('../.github/workflows/staging-task6-e2e.yml', import.meta.url), 'utf8');
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /\n\s+(push|pull_request|schedule):/);
  assert.match(yaml, /permissions:\s*\n\s+contents: read/);
  assert.match(yaml, /github\.ref == 'refs\/heads\/staging'/);
  assert.match(yaml, /STAGING_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/);
  assert.match(yaml, /STAGING_WHATSAPP_APP_SECRET: \$\{\{ secrets\.STAGING_WHATSAPP_APP_SECRET \}\}/);
  assert.match(yaml, /STAGING_WHATSAPP_E2E_RECIPIENT: \$\{\{ secrets\.STAGING_WHATSAPP_E2E_RECIPIENT \}\}/);
  assert.match(yaml, /if: always\(\)/);
  assert.match(yaml, /cleanup_staging_task6_e2e\.js/);
  assert.doesNotMatch(yaml, /PRODUCTION|main\b|rejectUnauthorized\s*:\s*false/i);
});
