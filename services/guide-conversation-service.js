import crypto from 'node:crypto';

const MAX_TEXT = 2000;
const MAX_ACTIONS = 6;
const SESSION_TTL_MS = Math.min(Math.max(Number(process.env.GUIDE_SESSION_RETENTION_HOURS || 72) * 60 * 60 * 1000, 60 * 60 * 1000), 30 * 24 * 60 * 60 * 1000);
const MODULES = new Set(['ROADMAP', 'INTERACTIVE_TOOL', 'AI_ASSISTANT']);
const UNSAFE = /<\s*\/?(?:script|style|iframe|object|embed|link|meta|base)|<[^>]*\b(?:on\w+|style|srcdoc)\s*=|<[^>]*\b(?:href|src)\s*=\s*["']?\s*(?:javascript|data):/i;

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
  let normalizedModule = String(module || '').trim().toUpperCase();
  if (normalizedModule === 'ASSISTANT') normalizedModule = 'AI_ASSISTANT';
  if (!MODULES.has(normalizedModule)) throw new GuideConversationError();
  return { module: normalizedModule, text: clean(text) };
}

function normalizedThread(value) {
  const thread = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { ...thread, messages: Array.isArray(thread.messages) ? thread.messages : [] };
}

// Historical sessions may predate a module thread. Normalize only the
// canonical collection shape, retaining every other persisted field.
export function normalizeGuideConversationState(state) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  return {
    ...source,
    roadmapState: normalizedThread(source.roadmapState),
    assistantConversation: normalizedThread(source.assistantConversation),
  };
}

export function appendGuideModuleMessage(state, module, message) {
  const normalized = normalizeGuideConversationState(state);
  const key = module === 'ROADMAP' ? 'roadmapState' : module === 'AI_ASSISTANT' ? 'assistantConversation' : null;
  if (!key) return normalized;
  return {
    ...normalized,
    [key]: { ...normalized[key], messages: [...normalized[key].messages, message] },
  };
}

function safeInline(value) {
  return clean(value, Number.MAX_SAFE_INTEGER).replace(/\*{1,3}|`|^\s*#{1,6}\s*/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeProviderRichText(value) {
  return value
    .replace(/<h[1-6]\b[^>]*>/gi, '\n## ')
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<(?:p|div|section|article|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|blockquote)\s*>/gi, '\n')
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(?:strong|b|em|i|span|code)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function boundedTextSegments(value, limit = 800) {
  const source = String(value ?? '');
  if (!source) return [];
  const segments = [];
  let current = '';
  for (const word of source.split(/\s+/)) {
    if (!word) continue;
    if (word.length > limit) {
      if (current) segments.push(current);
      for (let index = 0; index < word.length; index += limit) segments.push(word.slice(index, index + limit));
      current = '';
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > limit) {
      segments.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) segments.push(current);
  return segments;
}

export function canonicalGuideResponseEvents(content, { nextActions = [] } = {}) {
  const source = normalizeProviderRichText(clean(content, Number.MAX_SAFE_INTEGER));
  const events = [{ type: 'MESSAGE_START' }, { type: 'THINKING' }];
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) {
      for (const text of boundedTextSegments(safeInline(paragraph.join(' ')))) events.push({ type: 'TEXT_DELTA', text });
      paragraph = [];
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (heading) {
      flush();
      const titleSegments = boundedTextSegments(safeInline(heading[1]));
      if (titleSegments.length === 1) events.push({ type: 'SECTION', title: titleSegments[0] });
      else for (const text of titleSegments) events.push({ type: 'TEXT_DELTA', text });
      continue;
    }
    if (bullet) {
      flush();
      const items = [safeInline(bullet[1])];
      while (index + 1 < lines.length && /^(?:[-*]|\d+[.)])\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(safeInline(lines[index].replace(/^(?:[-*]|\d+[.)])\s+/, '')));
      }
      events.push({ type: 'LIST', items: items.flatMap((item) => boundedTextSegments(item)) });
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

export function canonicalGuideResponseText(content) {
  return canonicalGuideResponseEvents(content)
    .flatMap((event) => {
      if (event.type === 'SECTION') return [event.title];
      if (event.type === 'TEXT_DELTA') return [event.text];
      if (event.type === 'LIST') return event.items.map((item) => `- ${item}`);
      return [];
    })
    .filter(Boolean)
    .join('\n');
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const opaqueToken = () => crypto.randomBytes(32).toString('base64url');
const validScope = (scope) => ['domain_id', 'tenant_id', 'assistant_id', 'channel_id'].every((key) => typeof scope?.[key] === 'string' && scope[key]);

export async function issueGuideResumeSession({ database, scope, experienceVersion, experienceVersionId = null, previewMode, now = Date.now() }) {
  if (!database || !validScope(scope) || !Number.isInteger(experienceVersion)) throw new GuideConversationError('GUIDE_SESSION_INVALID');
  const token = opaqueToken(); const sessionId = crypto.randomUUID(); const expiresAt = new Date(now + SESSION_TTL_MS);
  await database.query(
    `INSERT INTO guide_public_sessions (token_hash, session_id, tenant_id, assistant_id, channel_id, domain_id, experience_version, preview_mode, expires_at, experience_version_id, authorization_source, session_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE')`,
    [hash(token), sessionId, scope.tenant_id, scope.assistant_id, scope.channel_id, scope.domain_id, experienceVersion, Boolean(previewMode), expiresAt, experienceVersionId, previewMode ? 'PRIVATE_PREVIEW' : 'PUBLIC'],
  );
  return { token, sessionId, expiresAt: expiresAt.toISOString() };
}

export async function resolveGuideResumeSession({ database, token, scope, experienceVersion, previewMode, now = Date.now() }) {
  if (!database || typeof token !== 'string' || token.length < 32 || !validScope(scope) || !Number.isInteger(experienceVersion)) return null;
  const result = await database.query(
    `SELECT session_id, expires_at FROM guide_public_sessions
      WHERE token_hash=$1 AND tenant_id=$2 AND assistant_id=$3 AND channel_id=$4 AND domain_id=$5
        AND experience_version=$6 AND preview_mode=$7 AND session_status='ACTIVE' AND expires_at > $8
      LIMIT 1`,
    [hash(token), scope.tenant_id, scope.assistant_id, scope.channel_id, scope.domain_id, experienceVersion, Boolean(previewMode), new Date(now)],
  );
  if (!result.rowCount) return null;
  await database.query('UPDATE guide_public_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=$1', [hash(token)]);
  return { token, sessionId: result.rows[0].session_id, expiresAt: new Date(result.rows[0].expires_at).toISOString() };
}

// A successfully bootstrapped preview is represented by the opaque, hashed
// session token from this point forward.  Its short-lived preview ticket is
// deliberately not re-used as durable conversation identity.
export async function resolveGuideResumeSessionByToken({ database, token, scope, now = Date.now() }) {
  if (!database || typeof token !== 'string' || token.length < 32 || !validScope(scope)) return null;
  const result = await database.query(
    `SELECT session_id, experience_version, experience_version_id, preview_mode, expires_at FROM guide_public_sessions
      WHERE token_hash=$1 AND tenant_id=$2 AND assistant_id=$3 AND channel_id=$4 AND domain_id=$5
        AND session_status='ACTIVE' AND expires_at > $6
      LIMIT 1`,
    [hash(token), scope.tenant_id, scope.assistant_id, scope.channel_id, scope.domain_id, new Date(now)],
  );
  if (!result.rowCount) return null;
  await database.query('UPDATE guide_public_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=$1', [hash(token)]);
  const row = result.rows[0];
  return {
    token,
    sessionId: row.session_id,
    experienceVersion: Number(row.experience_version),
    experienceVersionId: row.experience_version_id ?? null,
    previewMode: row.preview_mode === true,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function saveGuideResumeState({ database, token, scope, experienceVersion, previewMode, state }) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new GuideConversationError('GUIDE_SESSION_STATE_INVALID');
  const resolved = await resolveGuideResumeSession({ database, token, scope, experienceVersion, previewMode });
  if (!resolved) throw new GuideConversationError('GUIDE_SESSION_NOT_FOUND');
  await database.query('UPDATE guide_public_sessions SET state=$2::jsonb, last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=$1', [hash(token), JSON.stringify(state)]);
  return state;
}

function mergeCanonicalState(current, patch) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new GuideConversationError('GUIDE_SESSION_STATE_INVALID');
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!['active_module', 'sharedContext', 'roadmapState', 'planningState', 'assistantConversation', 'reminderDismissedState', 'tool_result'].includes(key)) {
      throw new GuideConversationError('GUIDE_SESSION_STATE_INVALID');
    }
    if (key === 'active_module') {
      if (typeof value !== 'string' || !MODULES.has(value)) throw new GuideConversationError('GUIDE_SESSION_STATE_INVALID');
      next[key] = value;
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GuideConversationError('GUIDE_SESSION_STATE_INVALID');
    next[key] = { ...(base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? base[key] : {}), ...value };
  }
  return next;
}

export async function patchGuideResumeState({ database, token, scope, experienceVersion, previewMode, patch }) {
  const current = await loadGuideResumeState({ database, token, scope, experienceVersion, previewMode });
  if (current === null) throw new GuideConversationError('GUIDE_SESSION_NOT_FOUND');
  const state = mergeCanonicalState(current, patch);
  await saveGuideResumeState({ database, token, scope, experienceVersion, previewMode, state });
  return state;
}

export async function loadGuideResumeState({ database, token, scope, experienceVersion, previewMode }) {
  if (!database || typeof token !== 'string' || !validScope(scope) || !Number.isInteger(experienceVersion)) return null;
  const result = await database.query(
    `SELECT state FROM guide_public_sessions
      WHERE token_hash=$1 AND tenant_id=$2 AND assistant_id=$3 AND channel_id=$4 AND domain_id=$5
        AND experience_version=$6 AND preview_mode=$7 AND session_status='ACTIVE' AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1`,
    [hash(token), scope.tenant_id, scope.assistant_id, scope.channel_id, scope.domain_id, experienceVersion, Boolean(previewMode)],
  );
  return result.rowCount ? (result.rows[0].state || {}) : null;
}

// State section constants and helpers for roadmap, planning, shared context, and assistant
export const GUIDE_STATE_KEYS = Object.freeze({
  ROADMAP: 'roadmapState',
  PLANNING: 'planningState',
  ASSISTANT: 'assistantConversation',
  SHARED_CONTEXT: 'sharedContext',
});

export function getRoadmapState(sessionState) {
  return sessionState?.roadmapState || { messages: [] };
}

export function setRoadmapState(sessionState, roadmap) {
  return { ...sessionState, roadmapState: { ...(sessionState?.roadmapState || {}), ...roadmap } };
}

export function addRoadmapMessage(sessionState, message) {
  const current = sessionState?.roadmapState?.messages || [];
  return {
    ...sessionState,
    roadmapState: {
      ...(sessionState?.roadmapState || {}),
      messages: [...current, message],
    },
  };
}

export function getAssistantState(sessionState) {
  return sessionState?.assistantConversation || { messages: [] };
}

export function setAssistantState(sessionState, assistant) {
  return { ...sessionState, assistantConversation: { ...(sessionState?.assistantConversation || {}), ...assistant } };
}

export function addAssistantMessage(sessionState, message) {
  const current = sessionState?.assistantConversation?.messages || [];
  return {
    ...sessionState,
    assistantConversation: {
      ...(sessionState?.assistantConversation || {}),
      messages: [...current, message],
    },
  };
}

export function getPlanningState(sessionState) {
  return sessionState?.planningState || {};
}

export function setPlanningState(sessionState, planning) {
  return { ...sessionState, planningState: { ...(sessionState?.planningState || {}), ...planning } };
}

export function getSharedGuideContext(sessionState) {
  return sessionState?.sharedContext || {};
}

export function setSharedGuideContext(sessionState, context) {
  return { ...sessionState, sharedContext: { ...(sessionState?.sharedContext || {}), ...context } };
}
