import test from 'node:test';
import assert from 'node:assert/strict';
import { redactConversationCandidate } from '../services/knowledge-intelligence-service.js';

test('conversation candidate redaction removes customer email and phone before it can be reviewed', () => {
  const value = redactConversationCandidate('Contact Ayşe at ayse@example.com or +90 555 123 45 67 for the account policy.');
  assert.doesNotMatch(value, /ayse@example\.com/i);
  assert.doesNotMatch(value, /555/);
  assert.match(value, /\[redacted email\]/);
  assert.match(value, /\[redacted phone\]/);
});
