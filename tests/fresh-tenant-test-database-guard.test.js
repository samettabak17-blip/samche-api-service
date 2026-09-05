import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { buildNpmInvocation } from '../scripts/npm-invocation.js';

test('Golden Path invokes npm through Node on Windows without a cmd shim', () => {
  assert.deepEqual(
    buildNpmInvocation(['test'], {
      platform: 'win32',
      execPath: 'C:\\node.exe',
      npmExecPath: 'C:\\npm-cli.js',
    }),
    {
      command: 'C:\\node.exe',
      args: ['C:\\npm-cli.js', 'test'],
      shell: false,
    },
  );
});

test('Golden Path strict database mode verifies the remote TLS certificate', () => {
  assert.deepEqual(
    resolvePostgresSsl({
      connectionString: 'postgresql://fixture:fixture@db.example.test:5432/workflow_test_a7c9',
      databaseSsl: 'strict',
      nodeEnv: 'test',
    }),
    { rejectUnauthorized: true, servername: 'db.example.test' },
  );
});

test('Golden Path accepts explicit and Render-suffixed test database names', () => {
  assert.equal(
    isSafeTestDatabaseUrl('postgresql://fixture:fixture@127.0.0.1:1/workflow_test'),
    true,
  );
  assert.equal(
    isSafeTestDatabaseUrl('postgresql://fixture:fixture@127.0.0.1:1/workflow_test_a7c9'),
    true,
  );
  assert.equal(
    isSafeTestDatabaseUrl('postgresql://fixture:fixture@127.0.0.1:1/golden-path-testing_42'),
    true,
  );
});

test('Golden Path rejects staging, production, shared, and ambiguous database names', () => {
  for (const databaseName of [
    'samche-staging-db',
    'workflow_staging_test',
    'workflow_production_test',
    'customer_shared',
    'workflow',
  ]) {
    assert.equal(
      isSafeTestDatabaseUrl(`postgresql://fixture:fixture@127.0.0.1:1/${databaseName}`),
      false,
      databaseName,
    );
  }
});

test('Golden Path refuses a shared staging database before any migration is attempted', () => {
  const username = 'guard-secret-username';
  const password = 'guard-secret-password';
  const hostname = 'guard-secret-host.invalid';
  const result = spawnSync(process.execPath, ['scripts/run-fresh-tenant-golden-path.js'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_DATABASE_URL: `postgresql://${username}:${password}@${hostname}:1/samche-staging-db`,
    },
  });

  assert.equal(result.status, 2);
  assert.match(`${result.stdout}\n${result.stderr}`, /refusing a non-isolated test database/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /=== MIGRATIONS ===/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(username));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(password));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(hostname.replaceAll('.', '\\.')));
});
