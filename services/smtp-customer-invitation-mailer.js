import nodemailer from 'nodemailer';
import { buildInvitationMessage, buildPasswordResetMessage } from './customer-invitation-mailer.js';

export class CustomerInvitationSmtpError extends Error {
  constructor(code) {
    super('SMTP delivery was not accepted');
    this.code = code;
  }
}

function acceptedByRecipient(info, email) {
  if (!Array.isArray(info?.accepted)) return false;
  const expected = String(email).trim().toLowerCase();
  return info.accepted.some((recipient) => String(recipient).trim().toLowerCase() === expected);
}

export function createSmtpCustomerInvitationMailer({ config, createTransport = nodemailer.createTransport }) {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  const sendAccepted = async (message, recipient) => {
    const info = await transport.sendMail(message);
    if (!acceptedByRecipient(info, recipient)) throw new CustomerInvitationSmtpError('SMTP_RECIPIENT_REJECTED');
    return { providerCode: 'SMTP_ACCEPTED' };
  };

  return {
    async sendInvitation({ companyName, email, token, expiresAt }) {
      const message = buildInvitationMessage({ config, companyName, email, token, expiresAt });
      return sendAccepted(message, email);
    },
    async sendPasswordReset({ email, token, expiresAt }) {
      return sendAccepted(buildPasswordResetMessage({ config, email, token, expiresAt }), email);
    },
  };
}
