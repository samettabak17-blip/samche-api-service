import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';

/**
 * Derives a deterministic 32-byte encryption key from the environment.
 * Prefers WHATSAPP_TOKEN_ENCRYPTION_KEY, falling back to WHATSAPP_APP_SECRET
 * or JWT_SECRET using SHA-256 key derivation.
 */
export function deriveWhatsAppEncryptionKey(env = process.env) {
  const configured = String(
    env?.WHATSAPP_TOKEN_ENCRYPTION_KEY ||
    env?.WHATSAPP_APP_SECRET ||
    env?.JWT_SECRET ||
    ''
  ).trim();

  if (!configured) {
    throw new Error('WHATSAPP_ENCRYPTION_KEY_UNAVAILABLE: No encryption key or secret configured');
  }

  // If provided as a 64-char hex or 44-char base64 32-byte key:
  if (/^[0-9a-fA-F]{64}$/.test(configured)) {
    return Buffer.from(configured, 'hex');
  }
  if (/^[A-Za-z0-9+/=]{44}$/.test(configured)) {
    const buf = Buffer.from(configured, 'base64');
    if (buf.length === 32) return buf;
  }

  // Derive a 32-byte key via SHA-256
  return crypto.createHash('sha256').update(`samche-whatsapp-cred:${configured}`).digest();
}

/**
 * Encrypts a WhatsApp access token using AES-256-GCM.
 * Never logs or exposes the raw token.
 */
export function encryptWhatsAppCredential(plainToken, { key = null, env = process.env } = {}) {
  const token = String(plainToken ?? '').trim();
  if (!token) {
    throw new Error('WHATSAPP_CREDENTIAL_EMPTY: Cannot encrypt an empty token');
  }

  const encryptionKey = key || deriveWhatsAppEncryptionKey(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);

  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: authTag.toString('base64url'),
    version: KEY_VERSION,
  };
}

/**
 * Decrypts an encrypted WhatsApp credential envelope.
 * Returns null if envelope is invalid or decryption fails, without throwing
 * or leaking cryptographic details.
 */
export function decryptWhatsAppCredential(envelope, { key = null, env = process.env } = {}) {
  if (!envelope || typeof envelope !== 'object') return null;
  const { ciphertext, iv, authTag, version } = envelope;
  if (!ciphertext || !iv || !authTag || version !== KEY_VERSION) return null;

  try {
    const encryptionKey = key || deriveWhatsAppEncryptionKey(env);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      encryptionKey,
      Buffer.from(iv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    return decrypted.trim() || null;
  } catch (error) {
    console.error('WHATSAPP_CREDENTIAL_DECRYPTION_FAILED');
    return null;
  }
}
