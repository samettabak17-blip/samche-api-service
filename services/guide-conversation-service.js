import crypto from 'node:crypto';

const MAX_TEXT = 2000;
const MAX_ACTIONS = 6;
const SESSION_TTL_MS = Math.min(Math.max(Number(process.env.GUIDE_SESSION_RETENTION_HOURS || 72) * 60 * 60 * 1000, 60 * 60 * 1000), 30 * 24 * 60 * 60 * 1000);
const MODULES = new Set(['ROADMAP', 'ASSISTANT']);
const UNSAFE = /<\s*\/?(?:script|style|iframe|object|embed)|on\w+\s*=/i;

export class GuideConversationError extends Error {
  constructor(code = 'GUIDE_CONVERSATION_INVALID') { super('Guide conversation is unavailable.'); this.code = code; }
}

const clean = (value, max = MAX_TEXT) => {
  if (typeof value !== 'string') throw new GuideConversationError();
  const normalized = value.replace(/\r/g, '').trim();
  if (!normalized || normalized.length > max || UNSAFE.test(normalized)) throw new GuideConversationError();
  return normalized;
};

export function normalizeGuideConversationRequest({ module, text }) {
  const normalizedModule = String(module || '').trim().toUpperCase();
  if (!MODULES.has(normalizedModule)) throw new GuideConversationError();
  return { module: normalizedModule, text: clean(text) };
}

function safeInline(value) {
  return clean(value, 800).replace(/\*{1,3}|`|^\s*#{1,6}\s*/g, '').replace(/\s+/g, ' ').trim();
}

export function canonicalGuideResponseEvents(content, { nextActions = [] } = {}) {
  const source = clean(content);
  const events = [{ type: 'MESSAGE_START' }, { type: 'THINKING' }];
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  let paragraph = [];
  const flush = () => { if (paragraph.length) { events.push({ type: 'TEXT_DELTA', text: safeInline(paragraph.join(' ')) }); paragraph = []; } };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (heading) { flush(); events.push({ type: 'SECTION', title: safeInline(heading[1]) }); continue; }
    if (bullet) {
      flush();
      const items = [safeInline(bullet[1])];
      while (index + 1 < lines.length && /^(?:[-*]|\d+[.)])\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(safeInline(lines[index].replace(/^(?:[-*]|\d+[.)])\s+/, '')));
      }
      events.push({ type: 'LIST', items });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  const actions = Array.isArray(nextActions) ? nextActions.map((value) => safeInline(value)).filter(Boolean).slice(0, MAX_ACTIONS) : [];
  if (actions.length) events.push({ type: 'ACTION', actions });
  events.push({ type: 'MESSAGE_COMPLETE' });
  return events;
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const opaqueToken = () => crypto.randomBytes(32).toString('base64url');
const validScope = (scope) => ['domain_id', 'tenant_id', 'assistant_id', 'channel_id'].every((key) => typeof scope?.[key] === 'string' && scope[key]);

export async function issueGuideResumeSession({ database, scope, experienceVersion, previewMode, now = Date.now() }) {
  if (!database || !validScope(scope) || !Number.isInteger(experienceVersion)) throw new GuideConversationError('GUIDE_SESSION_INVALID');
  const token = opaqueToken(); const sessionId = crypto.randomUUID(); const expiresAt = new Date(now + SESSION_TTL_MS);
  await database.query(
    `INSERT INTO guide_public_sessions (token_hash, session_id, tenant_id, assistant_id, channel_id, domain_id, experience_version, preview_mode, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [hash(token), sessionId, scope.tenant_id, scope.assistant_id, scope.channel_id, scope.domain_id, experienceVersion, Boolean(previewMode), expiresAt],
  );
  return { token, sessionId, expiresAt: expiresAt.toISOString() };
}

export async function resolveGuideResumeSession({ database, token, scope, experienceVersion, previewMode, now = Date.now() }) {
  if (!database || typeof token !== 'string' || token.length < 32 || !validScope(scope) || !Number.isInteger(experienceVersion)) return null;
  const result = await database.query(
    `SELECT session_id, expires_at FROM guide_public_sessions
      WHERE token_hash=$1 AND tenant_id=$2 AND assistant_id=$3 AND channel_id=$4 AND domain_id=$5
        AND experience_version=$6 AND preview_mode=$7 AND expires_at > $8
      LIMIT 1`,
    [hash(token), scope.tenant_id, scope.assistant_id, scope.channel_id, scope.domain_id, experienceVersion, Boolean(previewMode), new Date(now)],
  );
  if (!result.rowCount) return null;
  await database.query('UPDATE guide_public_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=$1', [hash(token)]);
  return { token, sessionId: result.rows[0].session_id, expiresAt: new Date(result.rows[0].expires_at).toISOString() };
}

export async function saveGuideResumeState({ database, token, scope, experienceVersion, previewMode, state }) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new GuideConversationError('GUIDE_SESSION_STATE_INVALID');
  const resolved = await resolveGuideResumeSession({ database, token, scope, experienceVersion, previewMode });
  if (!resolved) throw new GuideConversationError('GUIDE_SESSION_NOT_FOUND');
  await database.query('UPDATE guide_public_sessions SET state=$2::jsonb, last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=$1', [hash(token), JSON.stringify(state)]);
  return state;
}

export async function loadGuideResumeState({ database, token, scope, experienceVersion, previewMode }) {
  if (!database || typeof token !== 'string' || !validScope(scope) || !Number.isInteger(experienceVersion)) return null;
  const result = await database.query(
    `SELECT state FROM guide_public_sessions
      WHERE token_hash=$1 AND tenant_id=$2 AND assistant_id=$3 AND channel_id=$4 AND domain_id=$5
        AND experience_version=$6 AND preview_mode=$7 AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1`,
    [hash(token), scope.tenant_id, scope.assistant_id, scope.channel_id, scope.domain_id, experienceVersion, Boolean(previewMode)],
  );
  return result.rowCount ? (result.rows[0].state || {}) : null;
}
