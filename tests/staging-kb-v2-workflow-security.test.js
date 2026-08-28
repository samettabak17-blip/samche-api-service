import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/staging-kb-v2-preflight.yml', import.meta.url);

test('staging auth role audit is manual-only and uses verified TLS with a read-only transaction', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  assert.match(workflow, /auth_role_audit:\s*\n\s*description:/);
  assert.match(workflow, /type:\s*boolean/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/staging'/);
  assert.doesNotMatch(workflow, /rejectUnauthorized:\s*false/);
  assert.match(workflow, /rejectUnauthorized:\s*true/);
  assert.match(workflow, /servername:\s*databaseUrl\.hostname/);
  assert.match(workflow, /stream\.encrypted !== true \|\| stream\.authorized !== true/);

  const auditStep = workflow.match(/- name: Verify staging authentication roles[\s\S]*?\n\s+NODE/)?.[0] ?? '';
  assert.ok(auditStep, 'auth-role audit step must exist');
  assert.match(auditStep, /STAGING_DATABASE_URL:\s*\$\{\{ secrets\.STAGING_DATABASE_URL \}\}/);
  assert.match(auditStep, /await client\.query\('BEGIN'\)/);
  assert.match(auditStep, /await client\.query\('SET TRANSACTION READ ONLY'\)/);
  assert.match(auditStep, /WHERE system_role = 'OWNER'/);
  assert.match(auditStep, /WHERE email = 'dashboard-e2e-admin-20260822@samche-staging\.test'/);
  assert.match(auditStep, /await client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(auditStep, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|MIGRAT(?:E|ION))\b/i);
});
