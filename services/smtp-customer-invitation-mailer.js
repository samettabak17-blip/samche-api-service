import nodemailer from 'nodemailer';
import { buildInvitationMessage } from './customer-invitation-mailer.js';

export function createSmtpCustomerInvitationMailer({ config, createTransport = nodemailer.createTransport }) {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  return {
    async sendInvitation({ companyName, email, token, expiresAt }) {
      const message = buildInvitationMessage({ config, companyName, email, token, expiresAt });
      await transport.sendMail(message);
    },
  };
}
