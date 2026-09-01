import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvitationMessage, validateInvitationMailConfiguration } from '../services/customer-invitation-mailer.js';

const validConfig = {
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'mailer', SMTP_PASSWORD: 'secret',
  SMTP_FROM_EMAIL: 'support@samchecompany.com', SMTP_FROM_NAME: 'SamChe Support',
  PUBLIC_INVITATION_BASE_URL: 'https://dashboard.example.test',
  INVITATION_ENVELOPE_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'),
};

test('mail preflight rejects incomplete SMTP configuration without returning secret values', () => {
  assert.throws(() => validateInvitationMailConfiguration({ ...validConfig, SMTP_PASSWORD: '' }), /not configured/i);
  assert.throws(() => validateInvitationMailConfiguration({ ...validConfig, PUBLIC_INVITATION_BASE_URL: 'http://staging.example.test' }), /HTTPS/i);
});

test('deterministic invitation message includes account context without password or internal identifiers', () => {
  const message = buildInvitationMessage({
    config: validateInvitationMailConfiguration(validConfig),
    companyName: 'Example Company',
    email: 'customer@example.test',
    token: 'a'.repeat(43),
    expiresAt: new Date('2026-09-04T00:00:00.000Z'),
  });
  assert.equal(message.from, 'SamChe Support <support@samchecompany.com>');
  assert.match(message.subject, /Example Company/);
  assert.match(message.text, /customer@example\.test/);
  assert.equal(message.text.includes('password:'), false);
  assert.equal(message.text.includes('invitation_id'), false);
});
