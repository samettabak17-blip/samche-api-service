import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../scripts/staging-assistant-generation-audit.js', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/staging-assistant-generation-audit.yml', import.meta.url), 'utf8');

test('Assistant generation audit is manual, staging-only, strict-TLS and read-only', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/staging'/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /secrets\.STAGING_DATABASE_URL/);
  assert.doesNotMatch(workflow, /PRODUCTION/i);
  assert.match(script, /assertVerifiedTls/);
  assert.match(script, /SET TRANSACTION READ ONLY/);
  assert.match(script, /ROLLBACK/);
  assert.doesNotMatch(script, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
});
