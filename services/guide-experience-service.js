const COLOR = /^#[0-9A-Fa-f]{6}$/;
const SAFE_URL = /^https:\/\/[^\s]+$/i;
const GUIDE_ASSET_URL = /^\/guide\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_MARKUP = /<\s*\/?\s*(?:script|style|iframe|object|embed|svg|img|a\b)/i;
const PRESETS = new Set(['PROFESSIONAL', 'PREMIUM', 'MINIMAL', 'CONVERSATIONAL', 'COMMERCE', 'SERVICE']);
const FONTS = new Set(['SYSTEM', 'INTER', 'MANROPE', 'SERIF']);
const LAUNCHERS = new Set(['PILL', 'CIRCLE', 'PANEL']);

export class GuideExperienceError extends Error {
  constructor(code, message = 'Guide experience is unavailable.') {
    super(message);
    this.code = code;
  }
}

const neutral = Object.freeze({
  brand_name: 'AI Guide',
  assistant_display_name: 'AI Guide',
  assistant_status_label: 'Online',
  welcome_title: 'How can we help?',
  welcome_message: 'Ask a question to get started.',
  input_placeholder: 'Type your message',
  launcher_label: 'Open guide',
  empty_state_copy: 'Start a conversation when you are ready.',
  logo_url: null,
  avatar_url: null,
  favicon_url: null,
  theme: {
    primary_color: '#1F4B99', accent_color: '#4F7FD8', background_color: '#F7F8FA', foreground_color: '#18212F', surface_color: '#FFFFFF', border_color: '#D9E0EA', font_family: 'SYSTEM', corner_radius: 'MEDIUM', density: 'COMFORTABLE',
  },
  layout: { preset: 'PROFESSIONAL', launcher_style: 'PILL', header_style: 'STANDARD', panel_style: 'CARD' },
  modules: { chat: true, guide: true, calculator: false, ctas: true },
});

function text(value, key, max = 240, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  const normalized = value.trim();
  if (normalized.length > max || UNSAFE_MARKUP.test(normalized)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  return normalized || fallback;
}

function asset(value, key) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = text(value, key, 1024);
  if ((!SAFE_URL.test(normalized) && !GUIDE_ASSET_URL.test(normalized)) || /\.(?:svg)(?:[?#]|$)/i.test(normalized) || /^data:/i.test(normalized)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  return normalized;
}

function color(value, key, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !COLOR.test(value)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  return value.toUpperCase();
}

function bounded(value, allowed, key, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).toUpperCase();
  if (!allowed.has(normalized)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  return normalized;
}

export function normalizeGuideExperience(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
  const theme = input.theme && typeof input.theme === 'object' && !Array.isArray(input.theme) ? input.theme : {};
  const layout = input.layout && typeof input.layout === 'object' && !Array.isArray(input.layout) ? input.layout : {};
  const modules = input.modules && typeof input.modules === 'object' && !Array.isArray(input.modules) ? input.modules : {};
  for (const forbidden of ['provider', 'model', 'thinking_level', 'system_prompt', 'html', 'javascript']) {
    if (forbidden in input || forbidden in theme || forbidden in layout || forbidden in modules) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
  }
  return {
    brand_name: text(input.brand_name, 'brand_name', 120, neutral.brand_name),
    assistant_display_name: text(input.assistant_display_name, 'assistant_display_name', 120, neutral.assistant_display_name),
    assistant_status_label: text(input.assistant_status_label, 'assistant_status_label', 80, neutral.assistant_status_label),
    welcome_title: text(input.welcome_title, 'welcome_title', 160, neutral.welcome_title),
    welcome_message: text(input.welcome_message, 'welcome_message', 800, neutral.welcome_message),
    input_placeholder: text(input.input_placeholder, 'input_placeholder', 120, neutral.input_placeholder),
    launcher_label: text(input.launcher_label, 'launcher_label', 80, neutral.launcher_label),
    empty_state_copy: text(input.empty_state_copy, 'empty_state_copy', 240, neutral.empty_state_copy),
    logo_url: asset(input.logo_url, 'logo_url'),
    avatar_url: asset(input.avatar_url, 'avatar_url'),
    favicon_url: asset(input.favicon_url, 'favicon_url'),
    theme: {
      primary_color: color(theme.primary_color, 'primary_color', neutral.theme.primary_color),
      accent_color: color(theme.accent_color, 'accent_color', neutral.theme.accent_color),
      background_color: color(theme.background_color, 'background_color', neutral.theme.background_color),
      foreground_color: color(theme.foreground_color, 'foreground_color', neutral.theme.foreground_color),
      surface_color: color(theme.surface_color, 'surface_color', neutral.theme.surface_color),
      border_color: color(theme.border_color, 'border_color', neutral.theme.border_color),
      font_family: bounded(theme.font_family, FONTS, 'font_family', neutral.theme.font_family),
      corner_radius: bounded(theme.corner_radius, new Set(['SMALL', 'MEDIUM', 'LARGE']), 'corner_radius', neutral.theme.corner_radius),
      density: bounded(theme.density, new Set(['COMPACT', 'COMFORTABLE']), 'density', neutral.theme.density),
    },
    layout: {
      preset: bounded(layout.preset, PRESETS, 'preset', neutral.layout.preset),
      launcher_style: bounded(layout.launcher_style, LAUNCHERS, 'launcher_style', neutral.layout.launcher_style),
      header_style: bounded(layout.header_style, new Set(['STANDARD', 'COMPACT']), 'header_style', neutral.layout.header_style),
      panel_style: bounded(layout.panel_style, new Set(['CARD', 'FLAT']), 'panel_style', neutral.layout.panel_style),
    },
    modules: {
      chat: modules.chat !== false,
      guide: modules.guide !== false,
      calculator: modules.calculator === true,
      ctas: modules.ctas !== false,
    },
  };
}

export function neutralGuideExperience() { return structuredClone(neutral); }

export function guideExperienceCacheKey({ tenantId, assistantId, version }) {
  return `guide-experience:${tenantId}:${assistantId}:${version}`;
}

function serialize(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    assistant_id: row.assistant_id,
    version: row.version,
    status: row.status,
    experience: normalizeGuideExperience(row.experience),
    created_at: row.created_at,
    published_at: row.published_at,
  };
}

export async function resolvePublishedGuideExperience({ database, tenantId, assistantId }) {
  const result = await database.query(
    `SELECT id, tenant_id, assistant_id, version, status, experience, created_at, published_at
       FROM guide_experience_versions
      WHERE tenant_id = $1 AND assistant_id = $2 AND status = 'PUBLISHED'
      ORDER BY version DESC LIMIT 1`,
    [tenantId, assistantId],
  );
  if (!result.rowCount) return { source: 'NEUTRAL_FALLBACK', experience: { ...neutralGuideExperience(), version: 0 }, cache_key: guideExperienceCacheKey({ tenantId, assistantId, version: 0 }) };
  const version = serialize(result.rows[0]);
  return { source: 'PUBLISHED', version, experience: { ...version.experience, version: version.version }, cache_key: guideExperienceCacheKey({ tenantId, assistantId, version: version.version }) };
}

export async function listGuideExperienceVersions({ database, tenantId, assistantId }) {
  const result = await database.query(`SELECT id, tenant_id, assistant_id, version, status, experience, created_at, published_at FROM guide_experience_versions WHERE tenant_id=$1 AND assistant_id=$2 ORDER BY version DESC`, [tenantId, assistantId]);
  return result.rows.map(serialize);
}

export async function createGuideExperienceDraft({ database, tenantId, assistantId, actorUserId, experience }) {
  const normalized = normalizeGuideExperience(experience);
  const result = await database.query(
    `WITH next_version AS (SELECT COALESCE(MAX(version), 0) + 1 AS value FROM guide_experience_versions WHERE tenant_id=$1 AND assistant_id=$2)
     INSERT INTO guide_experience_versions (tenant_id, assistant_id, version, status, experience, created_by)
     SELECT $1,$2,next_version.value,'DRAFT',$3::jsonb,$4 FROM next_version
     RETURNING id, tenant_id, assistant_id, version, status, experience, created_at, published_at`,
    [tenantId, assistantId, JSON.stringify(normalized), actorUserId],
  );
  const draft = serialize(result.rows[0]);
  await database.query(`INSERT INTO guide_experience_audit_events (tenant_id, assistant_id, experience_version_id, actor_user_id, event_type) VALUES ($1,$2,$3,$4,'CREATED')`, [tenantId, assistantId, draft.id, actorUserId]);
  return draft;
}

export async function updateGuideExperienceDraft({ database, tenantId, assistantId, versionId, actorUserId, experience }) {
  const normalized = normalizeGuideExperience(experience);
  const result = await database.query(`UPDATE guide_experience_versions SET experience=$1::jsonb, updated_at=CURRENT_TIMESTAMP, updated_by=$2 WHERE id=$3 AND tenant_id=$4 AND assistant_id=$5 AND status='DRAFT' RETURNING id, tenant_id, assistant_id, version, status, experience, created_at, published_at`, [JSON.stringify(normalized), actorUserId, versionId, tenantId, assistantId]);
  if (!result.rowCount) throw new GuideExperienceError('GUIDE_EXPERIENCE_DRAFT_NOT_FOUND');
  const draft = serialize(result.rows[0]);
  await database.query(`INSERT INTO guide_experience_audit_events (tenant_id, assistant_id, experience_version_id, actor_user_id, event_type) VALUES ($1,$2,$3,$4,'UPDATED')`, [tenantId, assistantId, draft.id, actorUserId]);
  return draft;
}

export async function publishGuideExperience({ client, tenantId, assistantId, versionId, actorUserId }) {
  const candidate = await client.query(`SELECT id, tenant_id, assistant_id, version, status, experience, created_at, published_at FROM guide_experience_versions WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 FOR UPDATE`, [versionId, tenantId, assistantId]);
  if (!candidate.rowCount || candidate.rows[0].status !== 'DRAFT') throw new GuideExperienceError('GUIDE_EXPERIENCE_DRAFT_NOT_FOUND');
  await client.query(`UPDATE guide_experience_versions SET status='ARCHIVED', updated_at=CURRENT_TIMESTAMP, updated_by=$3 WHERE tenant_id=$1 AND assistant_id=$2 AND status='PUBLISHED'`, [tenantId, assistantId, actorUserId]);
  const published = await client.query(`UPDATE guide_experience_versions SET status='PUBLISHED', published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, updated_by=$4 WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 AND status='DRAFT' RETURNING id, tenant_id, assistant_id, version, status, experience, created_at, published_at`, [versionId, tenantId, assistantId, actorUserId]);
  if (!published.rowCount) throw new GuideExperienceError('GUIDE_EXPERIENCE_PUBLISH_FAILED');
  await client.query(`INSERT INTO guide_experience_audit_events (tenant_id, assistant_id, experience_version_id, actor_user_id, event_type) VALUES ($1,$2,$3,$4,'PUBLISHED')`, [tenantId, assistantId, versionId, actorUserId]);
  return serialize(published.rows[0]);
}

export async function rollbackGuideExperience({ client, tenantId, assistantId, versionId, actorUserId }) {
  const target = await client.query(`SELECT id, tenant_id, assistant_id, version, status, experience, created_at, published_at FROM guide_experience_versions WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 FOR UPDATE`, [versionId, tenantId, assistantId]);
  if (!target.rowCount || !['ARCHIVED', 'PUBLISHED'].includes(target.rows[0].status)) throw new GuideExperienceError('GUIDE_EXPERIENCE_ROLLBACK_TARGET_NOT_FOUND');
  if (target.rows[0].status === 'PUBLISHED') return serialize(target.rows[0]);
  await client.query(`UPDATE guide_experience_versions SET status='ARCHIVED', updated_at=CURRENT_TIMESTAMP, updated_by=$3 WHERE tenant_id=$1 AND assistant_id=$2 AND status='PUBLISHED'`, [tenantId, assistantId, actorUserId]);
  const published = await client.query(`UPDATE guide_experience_versions SET status='PUBLISHED', published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, updated_by=$4 WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 AND status='ARCHIVED' RETURNING id, tenant_id, assistant_id, version, status, experience, created_at, published_at`, [versionId, tenantId, assistantId, actorUserId]);
  if (!published.rowCount) throw new GuideExperienceError('GUIDE_EXPERIENCE_ROLLBACK_FAILED');
  await client.query(`INSERT INTO guide_experience_audit_events (tenant_id, assistant_id, experience_version_id, actor_user_id, event_type) VALUES ($1,$2,$3,$4,'ROLLED_BACK')`, [tenantId, assistantId, versionId, actorUserId]);
  return serialize(published.rows[0]);
}
