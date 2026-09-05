import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('all coding agents enter through the single AGENTS.md contract', async () => {
  const [agents, clineRules] = await Promise.all([
    readRepositoryFile('AGENTS.md'),
    readRepositoryFile('.clinerules'),
  ]);

  for (const agent of ['Codex', 'Cline', 'Aider', 'future coding agents']) {
    assert.match(agents, new RegExp(agent, 'i'));
  }
  assert.match(agents, /single authoritative cross-agent engineering contract/i);
  assert.match(clineRules, /repository-root `AGENTS\.md`/);
  assert.match(clineRules, /Do not duplicate that contract here/);
  assert.doesNotMatch(clineRules, /## 1\. Strict execution and scope/);
});

test('machine release gate retains cumulative tenant continuity contracts', async () => {
  const [agents, packageJson, runner, goldenPath] = await Promise.all([
    readRepositoryFile('AGENTS.md'),
    readRepositoryFile('package.json'),
    readRepositoryFile('scripts/run-fresh-tenant-golden-path.js'),
    readRepositoryFile('tests/fresh-tenant-golden-path.test.js'),
  ]);

  const scripts = JSON.parse(packageJson).scripts;
  assert.equal(scripts['test:fresh-tenant-golden-path'], 'node scripts/run-fresh-tenant-golden-path.js');
  assert.match(runner, /\['test', 'tests'\]/);
  assert.match(runner, /file\.endsWith\('\.test\.js'\)/);
  assert.match(goldenPath, /old-tenant and two-fresh-tenant/i);
  assert.match(goldenPath, /repairTenantPlatformCapabilities/);
  assert.match(goldenPath, /onboardCustomer/);
  assert.match(goldenPath, /crossTenant/);
  assert.match(agents, /retain the prior Golden Path and add/i);
  assert.match(agents, /screen-level customer-visible error is a release/i);
});
