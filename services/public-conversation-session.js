import crypto from 'node:crypto';

export class PublicConversationSessionError extends Error {
  constructor(code) {
    super('Public conversation session is invalid.');
    this.code = code;
  }
}

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function configuredPublicConversationSessionSecret() {
  return process.env.SAMCHEGUIDE_PUBLIC_SESSION_SECRET || '';
}

export function issuePublicConversationSession({ secret, now = Math.floor(Date.now() / 1000), ttlSeconds = 86400 }) {
  if (!secret) throw new PublicConversationSessionError('PUBLIC_SESSION_CONFIGURATION');
  const sessionId = crypto.randomUUID();
  const payload = encode(JSON.stringify({ v: 1, sid: sessionId, iat: now, exp: now + ttlSeconds }));
  return { sessionId, token: `${payload}.${sign(payload, secret)}` };
}

export function verifyPublicConversationSession(token, { secret, now = Math.floor(Date.now() / 1000) }) {
  if (typeof token !== 'string' || !secret) throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  const [payload, received, ...rest] = token.split('.');
  if (!payload || !received || rest.length) throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  const expected = sign(payload, secret);
  if (Buffer.byteLength(received) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  }
  let claims;
  try { claims = JSON.parse(decode(payload)); } catch { throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID'); }
  if (claims?.v !== 1 || typeof claims.sid !== 'string' || !claims.sid || !Number.isInteger(claims.exp)) {
    throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  }
  if (claims.exp < now) throw new PublicConversationSessionError('PUBLIC_SESSION_EXPIRED');
  return { sessionId: claims.sid };
}