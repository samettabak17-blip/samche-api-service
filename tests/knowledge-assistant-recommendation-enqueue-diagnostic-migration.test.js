import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('enqueue failure diagnostics persist only safe identifiers and database metadata', () => {
  const sql = fs.readFileSync(new URL('../migrations/053_assistant_recommendation_enqueue_failure_diagnostics.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS knowledge_assistant_recommendation_enqueue_failure_diagnostics/i);
  assert.match(sql, /request_id UUID NOT NULL/i);
  assert.match(sql, /database_code VARCHAR\(16\)/i);
  assert.doesNotMatch(sql, /prompt|profile_data|evidence|token/i);
});
