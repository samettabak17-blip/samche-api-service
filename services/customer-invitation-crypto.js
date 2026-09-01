import crypto from 'node:crypto';

const envelopeAlgorithm = 'aes-256-gcm';
const envelopeVersion = 'v1';

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url');
}

export function validateInvitationEnvelopeKey(value) {
  if (typeof value !== 'string' || value.length < 40) {
    throw new Error('Invitation envelope encryption is not configured');
  }
  let key;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new Error('Invitation envelope encryption key is invalid');
  }
  if (key.length !== 32) throw new Error('Invitation envelope encryption key is invalid');
  return key;
}

export function createInvitationToken() {
  return base64Url(crypto.randomBytes(32));
}

export function hashInvitationToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export function encryptInvitationEnvelope(token, configuredKey) {
  const key = validateInvitationEnvelopeKey(configuredKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(envelopeAlgorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return {
    ciphertext: base64Url(ciphertext),
    iv: base64Url(iv),
    authTag: base64Url(cipher.getAuthTag()),
    keyVersion: envelopeVersion,
  };
}

export function decryptInvitationEnvelope(envelope, configuredKey) {
  if (!envelope || envelope.keyVersion !== envelopeVersion) throw new Error('Invitation delivery envelope is invalid');
  const key = validateInvitationEnvelopeKey(configuredKey);
  try {
    const decipher = crypto.createDecipheriv(envelopeAlgorithm, key, fromBase64Url(envelope.iv));
    decipher.setAuthTag(fromBase64Url(envelope.authTag));
    return Buffer.concat([decipher.update(fromBase64Url(envelope.ciphertext)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Invitation delivery envelope cannot be decrypted');
  }
}
