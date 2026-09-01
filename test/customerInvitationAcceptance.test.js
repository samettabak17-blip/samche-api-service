import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInvitationPassword, validatePublicInvitationBody } from '../services/customer-invitation-acceptance-service.js';

test('invitation password validation enforces the approved 8–256 character bounds', () => {
  assert.equal(validateInvitationPassword('correct horse', 'correct horse'), true);
  assert.equal(validateInvitationPassword('short', 'short'), false);
  assert.equal(validateInvitationPassword('a'.repeat(257), 'a'.repeat(257)), false);
  assert.equal(validateInvitationPassword('correct horse', 'different horse'), false);
});

test('public invitation bodies are bounded to 4 KiB before password processing', () => {
  assert.equal(validatePublicInvitationBody(Buffer.from(JSON.stringify({ token: 'a'.repeat(43), password: 'correct horse', confirmPassword: 'correct horse' }))), true);
  assert.equal(validatePublicInvitationBody(Buffer.alloc(4097, 1)), false);
});
