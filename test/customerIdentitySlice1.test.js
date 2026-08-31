import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { isValidEmail, normalizeEmail } from '../middleware/validators.js';

test('normalizeEmail canonicalizes whitespace and case', () => {
  assert.equal(normalizeEmail(' User@Example.COM '), 'user@example.com');
});

test('canonical email remains valid for login and registration lookups', () => {
  const email = normalizeEmail(' User@Example.COM ');
  assert.equal(email, 'user@example.com');
  assert.equal(isValidEmail(email), true);
});

test('Slice 1 migration defines statuses, password invariant, names, and canonical email uniqueness', async () => {
  const sql = await readFile(new URL('../migrations/035_customer_identity_and_email.sql', import.meta.url), 'utf8');
  assert.match(sql, /INVITED/);
  assert.match(sql, /ACTIVE/);
  assert.match(sql, /DISABLED/);
  assert.match(sql, /password_hash[\s\S]*CHECK/i);
  assert.match(sql, /first_name/i);
  assert.match(sql, /last_name/i);
  assert.match(sql, /email_normalized/i);
  assert.match(sql, /UNIQUE INDEX/i);
  assert.match(sql, /RAISE EXCEPTION/i);
});

test('auth routes use canonical email and reject non-active users', async () => {
  const source = await readFile(new URL('../routes/authRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /normalizeEmail/);
  assert.match(source, /email_normalized/);
  assert.match(source, /status\s*=\s*\$2/);
  assert.match(source, /['"]ACTIVE['"]/);
});

test('migration documents collision fail-closed behavior without merging rows', async () => {
  const sql = await readFile(new URL('../migrations/035_customer_identity_and_email.sql', import.meta.url), 'utf8');
  assert.match(sql, /collision|duplicate/i);
  assert.doesNotMatch(sql, /DELETE FROM users/i);
});
