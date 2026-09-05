const REQUIRED_KEYS = Object.freeze([
  'human_support_default_topic',
  'human_support_request',
  'human_session_warning',
  'human_takeover',
  'return_to_ai',
]);
const REQUIRED_LOCALES = Object.freeze(['tr', 'en', 'ar']);
const VARIABLE = /\{([A-Z][A-Z0-9_]*)\}/g;

export class PlatformLifecycleMessageError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

function canonicalLocale(locale) {
  return REQUIRED_LOCALES.includes(String(locale ?? '').toLowerCase())
    ? String(locale).toLowerCase()
    : 'en';
}

function normalizedAllowedVariables(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String))].sort();
}

function variablesIn(body) {
  return [...String(body).matchAll(VARIABLE)].map((match) => match[1]);
}

export async function loadPlatformLifecycleMessages({ database }) {
  if (!database?.query) throw new PlatformLifecycleMessageError('PLATFORM_LIFECYCLE_DATABASE_INVALID');
  const result = await database.query(
    `SELECT message_key, locale, body, allowed_variables
       FROM platform_lifecycle_message_templates
      WHERE active = TRUE
      ORDER BY message_key, locale`,
  );
  const templates = {};
  for (const row of result.rows ?? []) {
    if (!REQUIRED_KEYS.includes(row.message_key) || !REQUIRED_LOCALES.includes(row.locale)) continue;
    const body = typeof row.body === 'string' ? row.body.trim() : '';
    const allowed = normalizedAllowedVariables(row.allowed_variables);
    const used = variablesIn(body);
    if (!body || used.some((name) => !allowed.includes(name)) || allowed.some((name) => name !== 'TOPIC')) {
      throw new PlatformLifecycleMessageError('PLATFORM_LIFECYCLE_TEMPLATE_INVALID');
    }
    templates[row.message_key] ??= {};
    if (templates[row.message_key][row.locale]) throw new PlatformLifecycleMessageError('PLATFORM_LIFECYCLE_TEMPLATE_DUPLICATE');
    templates[row.message_key][row.locale] = Object.freeze({ body, allowed_variables: Object.freeze(allowed) });
  }
  for (const key of REQUIRED_KEYS) {
    if (REQUIRED_LOCALES.some((locale) => !templates[key]?.[locale])) {
      throw new PlatformLifecycleMessageError('PLATFORM_LIFECYCLE_TEMPLATE_INCOMPLETE');
    }
    Object.freeze(templates[key]);
  }
  return Object.freeze(templates);
}

export function renderPlatformLifecycleMessage({ templates, key, locale = 'en', variables = {} }) {
  const selected = templates?.[key]?.[canonicalLocale(locale)] ?? templates?.[key]?.en;
  if (!selected) throw new PlatformLifecycleMessageError('PLATFORM_LIFECYCLE_TEMPLATE_UNAVAILABLE');
  const supplied = Object.keys(variables ?? {});
  if (supplied.some((name) => !selected.allowed_variables.includes(name))) {
    throw new PlatformLifecycleMessageError('PLATFORM_LIFECYCLE_VARIABLE_INVALID');
  }
  let body = selected.body;
  for (const name of selected.allowed_variables) {
    const value = String(variables?.[name] ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
    body = body.replaceAll(`{${name}}`, value);
  }
  if (variablesIn(body).length) throw new PlatformLifecycleMessageError('PLATFORM_LIFECYCLE_VARIABLE_REQUIRED');
  return body;
}

export async function resolvePlatformHumanSupportPolicy({ database, locale = 'en' }) {
  const templates = await loadPlatformLifecycleMessages({ database });
  const language = canonicalLocale(locale);
  const defaultTopic = renderPlatformLifecycleMessage({ templates, key: 'human_support_default_topic', locale: language });
  return Object.freeze({
    source: 'PLATFORM_DATABASE',
    language,
    defaultTopic,
    acknowledgement(topic = defaultTopic) {
      const normalized = typeof topic === 'string' && topic.trim() ? topic.trim().slice(0, 255) : defaultTopic;
      return renderPlatformLifecycleMessage({ templates, key: 'human_support_request', locale: language, variables: { TOPIC: normalized } });
    },
    lifecycleMessage(event) {
      return renderPlatformLifecycleMessage({ templates, key: event, locale: language });
    },
  });
}
