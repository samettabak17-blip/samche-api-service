import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmtpCustomerInvitationMailer } from '../services/smtp-customer-invitation-mailer.js';

test('SMTP adapter passes only validated standard SMTP configuration and deterministic message to its transport', async () => {
  const calls = [];
  const mailer = createSmtpCustomerInvitationMailer({
    config: {
      host: 'smtp.example.test', port: 465, secure: true, auth: { user: 'mailer', pass: 'secret' },
      fromEmail: 'support@samchecompany.com', fromName: 'SamChe Support', publicInvitationBaseUrl: 'https://dashboard.example.test',
    },
    createTransport: (options) => ({ sendMail: async (message) => { calls.push({ options, message }); return { response: '250 accepted' }; } }),
  });
  await mailer.sendInvitation({ companyName: 'Example', email: 'customer@example.test', token: 'a'.repeat(43), expiresAt: new Date('2026-09-04T00:00:00.000Z') });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.host, 'smtp.example.test');
  assert.equal(calls[0].message.from, 'SamChe Support <support@samchecompany.com>');
});
