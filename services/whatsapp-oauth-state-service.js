import crypto from 'node:crypto';

const STATE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

function base64UrlEncode(data) {
  return Buffer.from(data).toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function resolveStateSecret(secret, env = process.env) {
  const resolved = String(
    secret ||
    env?.JWT_SECRET ||
    env?.WHATSAPP_APP_SECRET ||
    env?.APP_SECRET ||
    'samche-default-oauth-state-signing-key'
  ).trim();
  return resolved;
}

/**
 * Generates a cryptographically signed OAuth state token for WhatsApp Embedded Signup.
 * Contains tenantId, userId, expiration timestamp, and random nonce.
 */
export function generateWhatsAppOAuthState({
  tenantId,
  userId,
  expiresInMs = STATE_MAX_AGE_MS,
  secret = null,
  env = process.env,
}) {
  if (!tenantId || !userId) {
    throw new Error('WHATSAPP_OAUTH_STATE_INVALID_INPUT: tenantId and userId are required');
  }

  const signingKey = resolveStateSecret(secret, env);
  const now = Date.now();
  const payload = {
    tenantId: String(tenantId),
    userId: String(userId),
    iat: now,
    exp: now + expiresInMs,
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  const payloadString = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadString);

  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

/**
 * Validates a signed OAuth state token.
 * Ensures signature matches, token has not expired, and matches expected tenantId and userId.
 */
export function verifyWhatsAppOAuthState(stateToken, {
  tenantId,
  userId,
  secret = null,
  env = process.env,
}) {
  if (!stateToken || typeof stateToken !== 'string') {
    return { valid: false, error: 'STATE_TOKEN_MISSING' };
  }

  const parts = stateToken.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'STATE_TOKEN_MALFORMED' };
  }

  const [encodedPayload, receivedSignature] = parts;
  const signingKey = resolveStateSecret(secret, env);

  const expectedSignature = crypto
    .createHmac('sha256', signingKey)
    .update(encodedPayload)
    .digest('base64url');

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(receivedSignature);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return { valid: false, error: 'STATE_SIGNATURE_MISMATCH' };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return { valid: false, error: 'STATE_PAYLOAD_INVALID' };
  }

  if (Date.now() > payload.exp) {
    return { valid: false, error: 'STATE_TOKEN_EXPIRED' };
  }

  if (tenantId && String(payload.tenantId) !== String(tenantId)) {
    return { valid: false, error: 'STATE_TENANT_MISMATCH' };
  }

  if (userId && String(payload.userId) !== String(userId)) {
    return { valid: false, error: 'STATE_USER_MISMATCH' };
  }

  return {
    valid: true,
    payload,
  };
}
