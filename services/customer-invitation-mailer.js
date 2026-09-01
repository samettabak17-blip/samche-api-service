import { validateInvitationEnvelopeKey } from './customer-invitation-crypto.js';

function requiredString(environment, name) {
  const value = environment?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error('Customer invitation mail is not configured');
  return value.trim();
}

export function validateInvitationMailConfiguration(environment = process.env) {
  const host = requiredString(environment, 'SMTP_HOST');
  const port = Number(requiredString(environment, 'SMTP_PORT'));
  const secureRaw = requiredString(environment, 'SMTP_SECURE').toLowerCase();
  const secure = secureRaw === 'true';
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['true', 'false'].includes(secureRaw)) {
    throw new Error('Customer invitation mail configuration is invalid');
  }
  const fromEmail = requiredString(environment, 'SMTP_FROM_EMAIL').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) throw new Error('Customer invitation mail configuration is invalid');
  const baseUrl = requiredString(environment, 'PUBLIC_INVITATION_BASE_URL').replace(/\/$/, '');
  const isLocalTest = environment?.NODE_ENV === 'test' || environment?.NODE_ENV === 'development';
  if (!isLocalTest && !baseUrl.startsWith('https://')) throw new Error('Customer invitation URL must use HTTPS');
  try { new URL(baseUrl); } catch { throw new Error('Customer invitation mail configuration is invalid'); }
  validateInvitationEnvelopeKey(requiredString(environment, 'INVITATION_ENVELOPE_ENCRYPTION_KEY'));
  return {
    host,
    port,
    secure,
    auth: { user: requiredString(environment, 'SMTP_USER'), pass: requiredString(environment, 'SMTP_PASSWORD') },
    fromEmail,
    fromName: requiredString(environment, 'SMTP_FROM_NAME'),
    publicInvitationBaseUrl: baseUrl,
  };
}

export function buildInvitationMessage({ config, companyName, email, token, expiresAt }) {
  const url = new URL('/accept-invitation', `${config.publicInvitationBaseUrl}/`);
  url.searchParams.set('token', token);
  const expiry = new Date(expiresAt).toISOString();
  const text = [
    `You have been invited to manage ${companyName} in SamChe.`,
    `Account email: ${email}`,
    `Set up your account securely: ${url.toString()}`,
    `This invitation expires at ${expiry}.`,
  ].join('\n\n');
  return {
    from: `${config.fromName} <${config.fromEmail}>`,
    to: email,
    subject: `Set up your SamChe account for ${companyName}`,
    text,
  };
}
