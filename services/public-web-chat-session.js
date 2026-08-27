import crypto from 'node:crypto';

export class PublicWebChatSessionError extends Error {
  constructor(code) {
    super('Public web chat session is invalid.');
    this.code = code;
  }
}

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function configuredPublicWebChatSessionSecret() {
  return process.env.WEB_CHAT_PUBLIC_SESSION_SECRET || '';
}

export function issuePublicWebChatSession({ secret, widgetKey, now = Math.floor(Date.now() / 1000), ttlSeconds = 86400 }) {
  if (!secret || typeof widgetKey !== 'string' || !widgetKey.trim()) {
    throw new PublicWebChatSessionError('WEB_CHAT_SESSION_CONFIGURATION');
  }
  const sessionId = crypto.randomUUID();
  const payload = encode(JSON.stringify({ v: 1, sid: sessionId, widget_key: widgetKey, iat: now, exp: now + ttlSeconds }));
  return { sessionId, token: `${payload}.${sign(payload, secret)}` };
}

export function verifyPublicWebChatSession(token, { secret, now = Math.floor(Date.now() / 1000) }) {
  if (typeof token !== 'string' || !secret) throw new PublicWebChatSessionError('WEB_CHAT_SESSION_INVALID');
  const [payload, received, ...rest] = token.split('.');
  if (!payload || !received || rest.length) throw new PublicWebChatSessionError('WEB_CHAT_SESSION_INVALID');
  const expected = sign(payload, secret);
  if (Buffer.byteLength(received) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    throw new PublicWebChatSessionError('WEB_CHAT_SESSION_INVALID');
  }
  let claims;
  try { claims = JSON.parse(decode(payload)); } catch { throw new PublicWebChatSessionError('WEB_CHAT_SESSION_INVALID'); }
  if (claims?.v !== 1 || typeof claims.sid !== 'string' || !claims.sid || typeof claims.widget_key !== 'string' || !claims.widget_key || !Number.isInteger(claims.exp)) {
    throw new PublicWebChatSessionError('WEB_CHAT_SESSION_INVALID');
  }
  if (claims.exp < now) throw new PublicWebChatSessionError('WEB_CHAT_SESSION_EXPIRED');
  return { sessionId: claims.sid, widgetKey: claims.widget_key };
}

