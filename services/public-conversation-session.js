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

function normalizeScope(scope) {
  if (!scope) return null;
  const fields = ['domainId', 'tenantId', 'assistantId', 'channelId'];
  if (!fields.every((field) => typeof scope[field] === 'string' && scope[field].trim())) {
    throw new PublicConversationSessionError('PUBLIC_SESSION_SCOPE_INVALID');
  }
  return Object.fromEntries(fields.map((field) => [field, scope[field]]));
}

function sameScope(left, right) {
  return Boolean(left && right) && ['domainId', 'tenantId', 'assistantId', 'channelId'].every((field) => left[field] === right[field]);
}

export function issuePublicConversationSession({ secret, now = Math.floor(Date.now() / 1000), ttlSeconds = 86400, scope = null }) {
  if (!secret) throw new PublicConversationSessionError('PUBLIC_SESSION_CONFIGURATION');
  const sessionId = crypto.randomUUID();
  const normalizedScope = normalizeScope(scope);
  const payload = encode(JSON.stringify({ v: normalizedScope ? 2 : 1, sid: sessionId, iat: now, exp: now + ttlSeconds, ...(normalizedScope ? { scope: normalizedScope } : {}) }));
  return { sessionId, token: `${payload}.${sign(payload, secret)}` };
}

export function verifyPublicConversationSession(token, { secret, now = Math.floor(Date.now() / 1000), expectedScope = null }) {
  if (typeof token !== 'string' || !secret) throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  const [payload, received, ...rest] = token.split('.');
  if (!payload || !received || rest.length) throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  const expected = sign(payload, secret);
  if (Buffer.byteLength(received) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  }
  let claims;
  try { claims = JSON.parse(decode(payload)); } catch { throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID'); }
  if (![1, 2].includes(claims?.v) || typeof claims.sid !== 'string' || !claims.sid || !Number.isInteger(claims.exp)) {
    throw new PublicConversationSessionError('PUBLIC_SESSION_INVALID');
  }
  if (claims.exp < now) throw new PublicConversationSessionError('PUBLIC_SESSION_EXPIRED');
  const normalizedExpectedScope = normalizeScope(expectedScope);
  if (normalizedExpectedScope && (claims.v !== 2 || !sameScope(claims.scope, normalizedExpectedScope))) {
    throw new PublicConversationSessionError('PUBLIC_SESSION_SCOPE_MISMATCH');
  }
  return { sessionId: claims.sid };
}
