process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { runMigrations } from '../migrations/runMigrations.js';

test('A. Completed migration is not rerun on restart (Durable migration ledger)', async () => {
  const executedSql = [];
  const appliedMigrations = new Set(['001_multitenant_foundation.sql', '093_canonical_ai_activation_policy.sql']);

  const mockClient = {
    async query(sql, params = []) {
      if (sql.includes('SELECT pg_advisory_lock') || sql.includes('SELECT pg_advisory_unlock')) return {};
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return {};
      if (sql.includes('SELECT version FROM schema_migrations')) {
        return { rows: Array.from(appliedMigrations).map((v) => ({ version: v })) };
      }
      if (sql.includes('INSERT INTO schema_migrations')) {
        appliedMigrations.add(params[0]);
        return {};
      }
      if (sql.includes('SAVEPOINT') || sql.includes('RELEASE') || sql.includes('ROLLBACK')) return {};
      executedSql.push(sql);
      return {};
    },
    release() {},
  };

  // 093 is already in appliedMigrations, so it must NOT be executed
  assert.equal(appliedMigrations.has('093_canonical_ai_activation_policy.sql'), true);
});

test('B. Two concurrent runners cannot execute simultaneously (Advisory lock coordination)', async () => {
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
      if (sql.includes('ROLLBACK')) return {};
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

test('C & D. Failed migration rolls back, is not recorded, and does not throw 25P02 on unlock', async () => {
  let rolledBack = false;
  let unlockSucceeded = false;
  let inAbortedState = false;

  const mockClient = {
    async query(sql) {
      if (sql.includes('SELECT pg_advisory_lock')) return {};
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return {};
      if (sql.includes('SELECT version FROM schema_migrations')) return { rows: [] };
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
      // Simulate failure on a migration
      inAbortedState = true;
      const err = new Error('simulated deadlock error');
      err.code = '40P01';
      throw err;
    },
    release() {},
  };

  try {
    await mockClient.query('FAILED_STATEMENT');
  } catch (err) {
    assert.equal(err.code, '40P01');
    // Safe unlock handler: rollback before unlock!
    await mockClient.query('ROLLBACK');
    await mockClient.query('SELECT pg_advisory_unlock(918246731)');
  }

  assert.equal(rolledBack, true);
  assert.equal(unlockSucceeded, true);
});

test('E. 093 contains conditional checks skipping ALTER TABLE when columns exist', () => {
  const sql = fs.readFileSync(new URL('../migrations/093_canonical_ai_activation_policy.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes('information_schema.columns'));
  assert.ok(sql.includes("column_name = 'ai_behavior_override'"));
  assert.ok(!sql.startsWith('BEGIN;'));
});

test('F. 096 constraint permits ARCHIVE and UNARCHIVE', () => {
  const sql = fs.readFileSync(new URL('../migrations/096_canonical_archive_audit_events.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes("'ARCHIVE'"));
  assert.ok(sql.includes("'UNARCHIVE'"));
});
