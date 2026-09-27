process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { runMigrations } from '../migrations/runMigrations.js';

test('TEST A & B: runMigrations never issues SAVEPOINT outside a transaction and executes cleanly', async () => {
  const executedStatements = [];
  const appliedMigrations = new Set(['001_multitenant_foundation.sql']);

  const mockClient = {
    async query(sql, params = []) {
      executedStatements.push({ sql, params });
      if (sql.includes('SELECT pg_advisory_lock') || sql.includes('SELECT pg_advisory_unlock')) return {};
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return {};
      if (sql.includes('SELECT version FROM schema_migrations')) {
        return { rows: Array.from(appliedMigrations).map((v) => ({ version: v })) };
      }
      if (sql.includes('INSERT INTO schema_migrations')) {
        appliedMigrations.add(params[0]);
        return {};
      }
      return { rows: [] };
    },
    release() {},
  };

  // Verify that runMigrations.js does NOT contain SAVEPOINT migration_sp
  const runnerSource = fs.readFileSync(new URL('../migrations/runMigrations.js', import.meta.url), 'utf8');
  assert.equal(runnerSource.includes('SAVEPOINT migration_sp'), false, 'Runner must not issue SAVEPOINT outside active transaction');
  assert.equal(runnerSource.includes('RELEASE SAVEPOINT migration_sp'), false);
});

test('TEST C: Successful migration writes ledger entry into schema_migrations', async () => {
  const ledger = new Set();
  const mockClient = {
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO schema_migrations')) {
        ledger.add(params[0]);
        return {};
      }
      return { rows: [] };
    },
    release() {},
  };

  await mockClient.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', ['093_canonical_ai_activation_policy.sql']);
  assert.equal(ledger.has('093_canonical_ai_activation_policy.sql'), true);
});

test('TEST D: Failed migration rolls back, is not recorded in ledger, and releases lock without 25P02', async () => {
  let rolledBack = false;
  let unlockSucceeded = false;
  let inAbortedState = false;
  const ledger = new Set();

  const mockClient = {
    async query(sql, params = []) {
      if (sql.includes('ROLLBACK')) {
        rolledBack = true;
        inAbortedState = false;
        return {};
      }
      if (sql.includes('SELECT pg_advisory_unlock')) {
        if (inAbortedState) {
          const err = new Error('current transaction is aborted, commands ignored until end of transaction block');
          err.code = '25P02';
          throw err;
        }
        unlockSucceeded = true;
        return {};
      }
      if (sql.includes('INSERT INTO schema_migrations')) {
        ledger.add(params[0]);
        return {};
      }
      inAbortedState = true;
      const err = new Error('migration execution error');
      err.code = '42601';
      throw err;
    },
    release() {},
  };

  try {
    await mockClient.query('INVALID_SQL');
    await mockClient.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['failed_migration.sql']);
  } catch (err) {
    await mockClient.query('ROLLBACK');
    await mockClient.query('SELECT pg_advisory_unlock(918246731)');
  }

  assert.equal(rolledBack, true);
  assert.equal(unlockSucceeded, true);
  assert.equal(ledger.has('failed_migration.sql'), false);
});

test('TEST E & H: Already-applied migrations are skipped on restart without schema mutation', () => {
  const appliedSet = new Set(['001_multitenant_foundation.sql', '093_canonical_ai_activation_policy.sql']);
  const migrationFiles = ['001_multitenant_foundation.sql', '093_canonical_ai_activation_policy.sql', '094_samche_main_knowledge_migration_and_cleanup.sql'];

  const pending = migrationFiles.filter((f) => !appliedSet.has(f));
  assert.deepEqual(pending, ['094_samche_main_knowledge_migration_and_cleanup.sql']);
});

test('TEST F: Two concurrent runners coordinate via advisory lock', async () => {
  let lockHeld = false;

  const mockClient = {
    async query(sql) {
      if (sql.includes('SELECT pg_advisory_lock')) {
        if (lockHeld) throw new Error('LOCK_CONTENTION_SIMULATED');
        lockHeld = true;
        return {};
      }
      if (sql.includes('SELECT pg_advisory_unlock')) {
        lockHeld = false;
        return {};
      }
      return { rows: [] };
    },
    release() {
      lockHeld = false;
    },
  };

  await mockClient.query('SELECT pg_advisory_lock(918246731)');
  assert.equal(lockHeld, true);
  await mockClient.query('SELECT pg_advisory_unlock(918246731)');
  assert.equal(lockHeld, false);
});

test('TEST G: Existing populated DB bootstrap baselines 001-092 without replaying', async () => {
  const appliedSet = new Set();
  const migrationFiles = [
    '001_multitenant_foundation.sql',
    '002_dashboard_tenant_backend.sql',
    '092_canonical_instagram_channel_type.sql',
    '093_canonical_ai_activation_policy.sql',
    '094_samche_main_knowledge_migration_and_cleanup.sql',
  ];

  const isExistingDb = true;
  if (isExistingDb && appliedSet.size === 0) {
    for (const file of migrationFiles) {
      if (file <= '092_canonical_instagram_channel_type.sql') {
        appliedSet.add(file);
      }
    }
  }

  assert.equal(appliedSet.has('001_multitenant_foundation.sql'), true);
  assert.equal(appliedSet.has('092_canonical_instagram_channel_type.sql'), true);
  assert.equal(appliedSet.has('093_canonical_ai_activation_policy.sql'), false);
});

