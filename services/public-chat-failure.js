import {
  inferConservativeCommunicationLanguage,
  normalizeCommunicationLanguage,
} from './conversation-communication-language.js';

const PUBLIC_ERROR_CODE = 'TEMPORARY_RESPONSE_FAILURE';
const SUPPORTED_LANGUAGES = new Set(['tr', 'en', 'ar']);
const PUBLIC_REPLIES = Object.freeze({
  tr: 'Şu anda yanıt oluştururken geçici bir sorun yaşıyorum. Lütfen kısa bir süre sonra tekrar deneyin.',
  en: "I'm having a temporary problem generating a response. Please try again shortly.",
  ar: 'أواجه مشكلة مؤقتة أثناء إنشاء الرد. يُرجى المحاولة مرة أخرى بعد قليل.',
});
const PUBLIC_ENGLISH_TURN = /\b(?:i\s+am|i['’]m|i\s+(?:get|have|receive)|getting|connection\s+(?:failed|failure)|failed\s+warning)\b/iu;

function supportedLanguage(value) {
  const normalized = normalizeCommunicationLanguage(value);
  const primary = normalized?.split('-')[0] ?? null;
  return SUPPORTED_LANGUAGES.has(primary) ? primary : null;
}

function safeDiagnosticToken(value, fallback, pattern, maxLength) {
  const text = typeof value === 'string' ? value.slice(0, maxLength) : '';
  return pattern.test(text) ? text : fallback;
}

function safeStatus(error) {
  const candidate = error?.status ?? error?.statusCode ?? error?.httpStatus;
  const status = Number(candidate);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}

function normalizedFailureCode(error) {
  const status = safeStatus(error);
  const code = typeof error?.code === 'string' ? error.code.slice(0, 128).toUpperCase() : '';
  const name = typeof error?.name === 'string' ? error.name.slice(0, 64).toUpperCase() : '';

  if (status === 429 || /RESOURCE_EXHAUSTED|RATE_LIMIT|QUOTA|TOO_MANY_REQUESTS/.test(code)) return 'RATE_LIMITED';
  if (/TIMEOUT|TIMED_OUT|DEADLINE|ABORT/.test(`${code} ${name}`)) return 'TIMEOUT';
  if (/INVALID_RESPONSE|RESPONSE_INVALID|MALFORMED|EMPTY_RESPONSE|RESPONSE_EMPTY/.test(code)) return 'INVALID_RESPONSE';
  if (status !== null && status >= 500) return 'UPSTREAM_5XX';
  return 'UNEXPECTED';
}

export function resolvePublicChatLanguage({ latestMessage, fallbackLocale } = {}) {
  const latestLanguage = inferConservativeCommunicationLanguage(latestMessage)
    ?? (PUBLIC_ENGLISH_TURN.test(String(latestMessage ?? '')) ? 'en' : null);
  return supportedLanguage(latestLanguage) ?? supportedLanguage(fallbackLocale) ?? 'en';
}

export function buildPublicChatFailure({ latestMessage, fallbackLocale } = {}) {
  const language = resolvePublicChatLanguage({ latestMessage, fallbackLocale });
  return Object.freeze({
    error: PUBLIC_ERROR_CODE,
    reply: PUBLIC_REPLIES[language],
  });
}

export function logPublicChatFailure({ logger = console, route, stage, correlationId, error } = {}) {
  const safeRoute = safeDiagnosticToken(route, 'unknown', /^\/[A-Za-z0-9_./:-]{1,80}$/, 80);
  const safeStage = safeDiagnosticToken(stage, 'unknown', /^[A-Za-z0-9_.:-]{1,64}$/, 64);
  const safeCorrelationId = safeDiagnosticToken(correlationId, 'unknown', /^[A-Za-z0-9_.:-]{1,96}$/, 96);
  const code = normalizedFailureCode(error);
  const status = safeStatus(error);
  const statusField = status === null ? '' : ` status=${status}`;
  logger?.error?.(`PUBLIC_CHAT_FAILURE route=${safeRoute} stage=${safeStage} correlation_id=${safeCorrelationId} code=${code}${statusField}`);
}
