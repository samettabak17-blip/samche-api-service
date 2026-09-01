import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validatePasswordResetInput } from '../services/password-reset-service.js';

test('password reset tokens retain the bounded hash-only token contract', () => {
  assert.equal(validatePasswordResetInput('a'.repeat(43)), true);
  assert.equal(validatePasswordResetInput('bad token'), false);
});

test('password reset migration has one pending authority per user and reuses the encrypted outbox', async () => {
  const migration = await readFile(new URL('../migrations/040_password_reset_tokens.sql', import.meta.url), 'utf8');
  assert.match(migration, /token_hash CHAR\(64\) NOT NULL UNIQUE/);
  assert.match(migration, /uq_password_reset_pending_user/);
  assert.match(migration, /password_reset_token_id/);
});

test('password routes expose change, forgot, validation and atomic consume without LLM providers', async () => {
  const routes = await readFile(new URL('../routes/authRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /\/change-password/);
  assert.match(routes, /\/forgot-password/);
  assert.match(routes, /\/password-resets\/validate/);
  assert.match(routes, /\/password-resets\/consume/);
  assert.doesNotMatch(routes, /gemini|openai/i);
});
