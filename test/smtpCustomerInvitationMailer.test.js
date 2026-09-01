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
    createTransport: (options) => ({ verify: async () => undefined, sendMail: async (message) => { calls.push({ options, message }); return { accepted: ['customer@example.test'], response: '250 accepted' }; } }),
  });
  await mailer.sendInvitation({ companyName: 'Example', email: 'customer@example.test', token: 'a'.repeat(43), expiresAt: new Date('2026-09-04T00:00:00.000Z') });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.host, 'smtp.example.test');
  assert.equal(calls[0].options.port, 465);
  assert.equal(calls[0].options.secure, true);
  assert.equal(calls[0].options.connectionTimeout, 15_000);
  assert.equal(calls[0].options.greetingTimeout, 15_000);
  assert.equal(calls[0].options.socketTimeout, 30_000);
  assert.equal(calls[0].message.from, 'SamChe Support <support@samchecompany.com>');
});

test('SMTP adapter preflight verifies TCP/TLS/greeting/auth without sending a message', async () => {
  let verifyCalls = 0;
  let sendCalls = 0;
  const mailer = createSmtpCustomerInvitationMailer({
    config: { host: 'smtp.example.test', port: 465, secure: true, auth: { user: 'mailer', pass: 'secret' }, fromEmail: 'support@samchecompany.com', fromName: 'SamChe Support', publicInvitationBaseUrl: 'https://dashboard.example.test' },
    createTransport: () => ({ verify: async () => { verifyCalls += 1; }, sendMail: async () => { sendCalls += 1; } }),
  });
  await mailer.verifyConnection();
  assert.equal(verifyCalls, 1);
  assert.equal(sendCalls, 0);
});

test('SMTP adapter fails closed when the recipient is not accepted by the SMTP server', async () => {
  const mailer = createSmtpCustomerInvitationMailer({
    config: {
      host: 'smtp.example.test', port: 465, secure: true, auth: { user: 'mailer', pass: 'secret' },
      fromEmail: 'support@samchecompany.com', fromName: 'SamChe Support', publicInvitationBaseUrl: 'https://dashboard.example.test',
    },
    createTransport: () => ({ verify: async () => undefined, sendMail: async () => ({ accepted: [], rejected: ['customer@example.test'], response: '550 rejected' }) }),
  });

  await assert.rejects(
    () => mailer.sendInvitation({ companyName: 'Example', email: 'customer@example.test', token: 'a'.repeat(43), expiresAt: new Date('2026-09-04T00:00:00.000Z') }),
    (error) => error?.code === 'SMTP_RECIPIENT_REJECTED',
  );
});
