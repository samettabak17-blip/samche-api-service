import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyStagingTask8Demo } from '../scripts/verify_staging_task8_demo.js';

test('Task 8 demo staging workflow is properly configured and guarded', async () => {
  const yaml = await readFile(new URL('../.github/workflows/staging-task8-demo.yml', import.meta.url), 'utf8');

  // Verify triggers
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /branches:\s*\[staging\]/);
  assert.match(yaml, /public\/task8-demo\/\*\*/);

  // Verify least privilege
  assert.match(yaml, /permissions:\s*\n\s+contents:\s*read/);

  // Verify staging branch isolation
  assert.match(yaml, /github\.ref == 'refs\/heads\/staging'/);

  // Verify secrets and parameters
  assert.match(yaml, /STAGING_DATABASE_URL:\s*\$\{\{\s*secrets\.STAGING_DATABASE_URL\s*\}\}/);
  assert.match(yaml, /wch_staging_task8_demo/);
  assert.match(yaml, /tests\/permanence-multi-tenant-contract\.test\.js/);
  assert.match(yaml, /scripts\/bootstrap_task8_demo\.js/);
  assert.match(yaml, /scripts\/verify_staging_task8_demo\.js/);
});

test('scripts/verify_staging_task8_demo.js exports verification function', () => {
  assert.equal(typeof verifyStagingTask8Demo, 'function');
});
