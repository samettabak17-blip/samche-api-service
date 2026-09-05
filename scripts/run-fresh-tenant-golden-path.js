import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isSafeTestDatabaseUrl } from './test-database-safety.js';
import { buildNpmInvocation } from './npm-invocation.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  console.error('FRESH_TENANT_GOLDEN_PATH=BLOCKED TEST_DATABASE_URL is required');
  process.exit(2);
}

if (!isSafeTestDatabaseUrl(connectionString)) {
  console.error('FRESH_TENANT_GOLDEN_PATH=BLOCKED refusing a non-isolated test database');
  process.exit(2);
}

const repositoryRoot = process.cwd();
const childEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: connectionString,
  DATABASE_SSL: 'strict',
  JWT_SECRET: process.env.JWT_SECRET || 'fresh-golden-path-test-only-secret',
  CUSTOMER_INVITATION_ENVELOPE_KEY: process.env.CUSTOMER_INVITATION_ENVELOPE_KEY || Buffer.alloc(32, 7).toString('base64'),
};

function run(label, command, args, cwd = repositoryRoot, { shell = false } = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, { cwd, env: childEnvironment, stdio: 'inherit', shell });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`FRESH_TENANT_GOLDEN_PATH=FAIL stage=${label}`);
    process.exit(result.status ?? 1);
  }
}

const rootTests = ['test', 'tests'].flatMap((directory) =>
  readdirSync(path.join(repositoryRoot, directory))
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => path.join(directory, file)),
);
const dashboardTests = buildNpmInvocation(['test']);
const dashboardBuild = buildNpmInvocation(['run', 'build']);

run('MIGRATIONS', process.execPath, ['scripts/migrate.js']);
run('TASKS_1_TO_7_AND_FRESH_TENANT_TESTS', process.execPath, ['--test', '--test-concurrency=1', ...rootTests]);
run('DASHBOARD_TESTS', dashboardTests.command, dashboardTests.args, path.join(repositoryRoot, 'dashboard'), dashboardTests);
run('DASHBOARD_BUILD', dashboardBuild.command, dashboardBuild.args, path.join(repositoryRoot, 'dashboard'), dashboardBuild);
console.log('\nFRESH_TENANT_GOLDEN_PATH=PASS');
