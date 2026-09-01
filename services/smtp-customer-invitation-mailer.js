import nodemailer from 'nodemailer';
import { buildInvitationMessage, buildPasswordResetMessage } from './customer-invitation-mailer.js';

export class CustomerInvitationSmtpError extends Error {
  constructor(code) {
    super('SMTP delivery was not accepted');
    this.code = code;
  }
}

export function classifySafeSmtpFailure(error) {
  if (error?.code === 'SMTP_RECIPIENT_REJECTED') return 'SMTP_RECIPIENT_REJECTED';
  const command = String(error?.command ?? '').toUpperCase();
  const code = String(error?.code ?? '').toUpperCase();
  const message = String(error?.message ?? '').toUpperCase();

  if (code === 'ETIMEDOUT' || message.includes('TIMED OUT')) {
    if (message.includes('TLS') || message.includes('HANDSHAKE')) return 'SMTP_TLS_HANDSHAKE_TIMEOUT';
    if (message.includes('GREETING')) return 'SMTP_GREETING_TIMEOUT';
    if (command.includes('AUTH')) return 'SMTP_AUTH_TIMEOUT';
    if (command.includes('MAIL FROM')) return 'SMTP_MAIL_FROM_TIMEOUT';
    if (command.includes('RCPT TO')) return 'SMTP_RCPT_TO_TIMEOUT';
    if (command.includes('DATA')) return 'SMTP_DATA_TIMEOUT';
    if (command === 'CONN') return 'SMTP_TCP_CONNECT_TIMEOUT';
    return 'SMTP_OTHER_TIMEOUT';
  }

  if (command.includes('MAIL FROM')) return 'SMTP_FROM_REJECTED';
  if (command.includes('RCPT TO')) return 'SMTP_RECIPIENT_REJECTED';
  if (code === 'EAUTH' || command.includes('AUTH') || message.includes('AUTHENTICATION')) return 'SMTP_AUTH_FAILED';
  if (message.includes('TLS') || message.includes('CERTIFICATE') || code.startsWith('ERR_TLS')) return 'SMTP_TLS_FAILED';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return 'SMTP_CONNECTION_FAILED';
  if (code === 'EENVELOPE' || command) return 'SMTP_PROVIDER_REJECTED';
  return 'SMTP_DELIVERY_FAILED';
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
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  const sendAccepted = async (message, recipient) => {
    const info = await transport.sendMail(message);
    if (!acceptedByRecipient(info, recipient)) throw new CustomerInvitationSmtpError('SMTP_RECIPIENT_REJECTED');
    return { providerCode: 'SMTP_ACCEPTED' };
  };

  return {
    async verifyConnection() {
      await transport.verify();
      return { providerCode: 'SMTP_READY' };
    },
    async sendInvitation({ companyName, email, token, expiresAt }) {
      const message = buildInvitationMessage({ config, companyName, email, token, expiresAt });
      return sendAccepted(message, email);
    },
    async sendPasswordReset({ email, token, expiresAt }) {
      return sendAccepted(buildPasswordResetMessage({ config, email, token, expiresAt }), email);
    },
  };
}
