import crypto from 'node:crypto';

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 10 * 60;

export class GuidePreviewError extends Error {
  constructor(code = 'GUIDE_PREVIEW_INVALID') {
    super('Guide preview is unavailable.');
    this.code = code;
  }
}

function secret() {
  return process.env.SAMCHEGUIDE_PREVIEW_SECRET || process.env.JWT_SECRET || '';
}

function encode(value) { return Buffer.from(value).toString('base64url'); }
function decode(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function signature(payload, key) { return crypto.createHmac('sha256', key).update(payload).digest('base64url'); }
function validId(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export function issueGuidePreviewToken({ tenantId, assistantId, versionId, actorUserId, now = Math.floor(Date.now() / 1000), ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const key = secret();
  if (!key || !validId(tenantId) || !validId(assistantId) || !validId(versionId) || !validId(actorUserId)) throw new GuidePreviewError('GUIDE_PREVIEW_CONFIGURATION');
  const payload = encode(JSON.stringify({ v: TOKEN_VERSION, purpose: 'GUIDE_DRAFT_PREVIEW', tenant_id: tenantId, assistant_id: assistantId, version_id: versionId, actor_user_id: actorUserId, iat: now, exp: now + Math.min(Math.max(Number(ttlSeconds) || DEFAULT_TTL_SECONDS, 60), DEFAULT_TTL_SECONDS) }));
  return `${payload}.${signature(payload, key)}`;
}

export function verifyGuidePreviewToken(token, { now = Math.floor(Date.now() / 1000) } = {}) {
  const key = secret();
  if (!key || typeof token !== 'string') throw new GuidePreviewError();
  const [payload, received, ...rest] = token.split('.');
  if (!payload || !received || rest.length) throw new GuidePreviewError();
  const expected = signature(payload, key);
  if (received.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) throw new GuidePreviewError();
  let claims;
  try { claims = JSON.parse(decode(payload)); } catch { throw new GuidePreviewError(); }
  if (claims?.v !== TOKEN_VERSION || claims?.purpose !== 'GUIDE_DRAFT_PREVIEW' || !Number.isInteger(claims.exp) || claims.exp < now || !validId(claims.tenant_id) || !validId(claims.assistant_id) || !validId(claims.version_id)) throw new GuidePreviewError();
  return claims;
}
