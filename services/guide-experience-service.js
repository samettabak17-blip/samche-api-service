const COLOR = /^#[0-9A-Fa-f]{6}$/;
const SAFE_URL = /^https:\/\/[^\s]+$/i;
const GUIDE_ASSET_URL = /^\/guide\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_MARKUP = /<\s*\/?\s*(?:script|style|iframe|object|embed|svg|img|a\b)/i;
const PRESETS = new Set(['PROFESSIONAL', 'PREMIUM', 'MINIMAL', 'CONVERSATIONAL', 'COMMERCE', 'SERVICE']);
const FONTS = new Set(['SYSTEM', 'INTER', 'MANROPE', 'SERIF']);
const LAUNCHERS = new Set(['PILL', 'CIRCLE', 'PANEL']);
const INPUT_TYPES = new Set(['TEXT', 'NUMBER', 'SELECT', 'BOOLEAN']);
const TERM_KINDS = new Set(['NUMBER_MULTIPLIER', 'SELECT_AMOUNT', 'BOOLEAN_AMOUNT']);
const FIELD_ID = /^[a-z][a-z0-9_]{0,39}$/;

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
  modules: { chat: true, guide: true, calculator: true, ctas: true },
  hero: { title: 'How can we help?', message: 'Choose a path or ask a question to get started.', cta_label: '' },
  roadmap: {
    enabled: true,
    title: 'Your roadmap',
    description: 'Share a few details and we will help shape the next step.',
    steps: [{ id: 'goal', label: 'What would you like to achieve?', description: '', input_type: 'TEXT', required: true, options: [], min: null, max: null, unit: '' }],
  },
  interactive_tool: {
    enabled: true,
    title: 'Planning snapshot',
    description: 'Capture your indicative budget to share with the assistant.',
    currency: '',
    result_label: 'Your planning snapshot',
    fields: [{ id: 'budget', label: 'Indicative budget', description: '', input_type: 'NUMBER', required: false, options: [], min: 0, max: 100000000, unit: '' }],
    calculation: { base_amount: 0, terms: [{ field_id: 'budget', kind: 'NUMBER_MULTIPLIER', multiplier: 1 }] },
  },
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

function bool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
  return value;
}

function number(value, key, { fallback = null, min = -100000000, max = 100000000 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  return value;
}

function identifier(value, key) {
  if (typeof value !== 'string' || !FIELD_ID.test(value)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  return value;
}

function object(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  return value;
}

function normalizeOptions(value, key) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  const seen = new Set();
  return value.map((option) => {
    object(option, key);
    const item = { value: identifier(option.value, `${key}.value`), label: text(option.label, `${key}.label`, 120) };
    if (seen.has(item.value)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
    seen.add(item.value);
    return item;
  });
}

function normalizeFields(value, key, { allowText = true } = {}) {
  if (!Array.isArray(value) || !value.length || value.length > 12) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
  const ids = new Set();
  return value.map((field) => {
    object(field, key);
    const inputType = bounded(field.input_type, allowText ? INPUT_TYPES : new Set(['NUMBER', 'SELECT', 'BOOLEAN']), `${key}.input_type`, 'TEXT');
    const item = {
      id: identifier(field.id, `${key}.id`),
      label: text(field.label, `${key}.label`, 120),
      description: text(field.description, `${key}.description`, 240, ''),
      input_type: inputType,
      required: bool(field.required, false),
      options: normalizeOptions(field.options, `${key}.options`),
      min: number(field.min, `${key}.min`, { fallback: null, min: -100000000, max: 100000000 }),
      max: number(field.max, `${key}.max`, { fallback: null, min: -100000000, max: 100000000 }),
      unit: text(field.unit, `${key}.unit`, 32, ''),
    };
    if (ids.has(item.id) || (item.input_type === 'SELECT' && !item.options.length) || (item.input_type !== 'SELECT' && item.options.length) || (item.min !== null && item.max !== null && item.min > item.max)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', `${key} is invalid.`);
    ids.add(item.id);
    return item;
  });
}

function normalizeRoadmap(value) {
  const roadmap = value === undefined || value === null ? neutral.roadmap : object(value, 'roadmap');
  return {
    enabled: bool(roadmap.enabled, true),
    title: text(roadmap.title, 'roadmap.title', 120, neutral.roadmap.title),
    description: text(roadmap.description, 'roadmap.description', 360, neutral.roadmap.description),
    steps: normalizeFields(roadmap.steps ?? neutral.roadmap.steps, 'roadmap.steps'),
  };
}

function normalizeInteractiveTool(value) {
  const tool = value === undefined || value === null ? neutral.interactive_tool : object(value, 'interactive_tool');
  const fields = normalizeFields(tool.fields ?? neutral.interactive_tool.fields, 'interactive_tool.fields', { allowText: false });
  const calculation = object(tool.calculation ?? neutral.interactive_tool.calculation, 'interactive_tool.calculation');
  if ('expression' in calculation || 'javascript' in calculation || 'formula' in calculation) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  if (!Array.isArray(calculation.terms) || calculation.terms.length > 12) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID', 'interactive_tool.calculation is invalid.');
  const terms = calculation.terms.map((term) => {
    object(term, 'interactive_tool.calculation.terms');
    const fieldId = identifier(term.field_id, 'interactive_tool.calculation.terms.field_id');
    const kind = bounded(term.kind, TERM_KINDS, 'interactive_tool.calculation.terms.kind', 'NUMBER_MULTIPLIER');
    const field = fieldById.get(fieldId);
    if (!field || (kind === 'NUMBER_MULTIPLIER' && field.input_type !== 'NUMBER') || (kind === 'SELECT_AMOUNT' && field.input_type !== 'SELECT') || (kind === 'BOOLEAN_AMOUNT' && field.input_type !== 'BOOLEAN')) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
    if (kind === 'NUMBER_MULTIPLIER') return { field_id: fieldId, kind, multiplier: number(term.multiplier, 'interactive_tool.calculation.terms.multiplier', { fallback: null }) };
    if (kind === 'BOOLEAN_AMOUNT') return { field_id: fieldId, kind, amount: number(term.amount, 'interactive_tool.calculation.terms.amount', { fallback: null }) };
    const amounts = object(term.amounts, 'interactive_tool.calculation.terms.amounts');
    const normalizedAmounts = {};
    for (const option of field.options) normalizedAmounts[option.value] = number(amounts[option.value], 'interactive_tool.calculation.terms.amounts', { fallback: 0 });
    return { field_id: fieldId, kind, amounts: normalizedAmounts };
  });
  if (terms.some((term) => term.multiplier === null || term.amount === null)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
  return {
    enabled: bool(tool.enabled, true),
    title: text(tool.title, 'interactive_tool.title', 120, neutral.interactive_tool.title),
    description: text(tool.description, 'interactive_tool.description', 360, neutral.interactive_tool.description),
    currency: text(tool.currency, 'interactive_tool.currency', 12, ''),
    result_label: text(tool.result_label, 'interactive_tool.result_label', 120, neutral.interactive_tool.result_label),
    fields,
    calculation: { base_amount: number(calculation.base_amount, 'interactive_tool.calculation.base_amount', { fallback: 0 }), terms },
  };
}

export function normalizeGuideExperience(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
  const theme = input.theme && typeof input.theme === 'object' && !Array.isArray(input.theme) ? input.theme : {};
  const layout = input.layout && typeof input.layout === 'object' && !Array.isArray(input.layout) ? input.layout : {};
  const modules = input.modules && typeof input.modules === 'object' && !Array.isArray(input.modules) ? input.modules : {};
  const hero = input.hero === undefined || input.hero === null ? {} : object(input.hero, 'hero');
  for (const forbidden of ['provider', 'model', 'thinking_level', 'system_prompt', 'html', 'javascript', 'script', 'expression']) {
    if (forbidden in input || forbidden in theme || forbidden in layout || forbidden in modules) throw new GuideExperienceError('GUIDE_EXPERIENCE_INVALID');
  }
  const roadmap = normalizeRoadmap(input.roadmap);
  const interactiveTool = normalizeInteractiveTool(input.interactive_tool);
  const isLegacyModuleContract = input.roadmap === undefined && input.interactive_tool === undefined;
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
      guide: modules.guide !== false && roadmap.enabled,
      calculator: (isLegacyModuleContract || modules.calculator !== false) && interactiveTool.enabled,
      ctas: modules.ctas !== false,
    },
    hero: {
      title: text(hero.title, 'hero.title', 160, text(input.welcome_title, 'welcome_title', 160, neutral.hero.title)),
      message: text(hero.message, 'hero.message', 800, text(input.welcome_message, 'welcome_message', 800, neutral.hero.message)),
      cta_label: text(hero.cta_label, 'hero.cta_label', 80, ''),
    },
    roadmap,
    interactive_tool: interactiveTool,
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

export async function inspectGuideExperiencePublication({ database, tenantId, assistantId }) {
  const result = await database.query(
    `SELECT id, tenant_id, assistant_id, version, status, created_at, published_at, updated_at
       FROM guide_experience_versions
      WHERE tenant_id=$1 AND assistant_id=$2
      ORDER BY version DESC`,
    [tenantId, assistantId],
  );
  const versions = result.rows.map((row) => ({
    id: row.id, tenant_id: row.tenant_id, assistant_id: row.assistant_id,
    version: row.version, status: row.status, created_at: row.created_at,
    published_at: row.published_at, updated_at: row.updated_at,
  }));
  const published = versions.filter((row) => row.status === 'PUBLISHED');
  const canonical = published.slice().sort((a, b) => b.version - a.version)[0] ?? null;
  const consistency = published.length === 0
    ? 'NO_CURRENT_PUBLISHED'
    : published.length > 1
      ? 'MULTIPLE_PUBLISHED'
      : 'HEALTHY';
  return {
    versions,
    current_published: canonical,
    public_bootstrap_version: canonical?.version ?? null,
    consistency,
  };
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
