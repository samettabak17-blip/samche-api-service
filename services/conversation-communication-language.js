const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

const TURKISH_GREETING = /^(?:merhaba|mrb|selam|slm|selamun\s+aleykum|selamün\s+aleyküm|selamunaleykum|selamünaleyküm|s\.?\s*a\.?|sa)(?=$|[\s,!.:;?])/u;
const ENGLISH_GREETING = /^(?:hello|hi|hey|good morning|good evening)\b/i;
const ARABIC_GREETING_OR_SOCIAL = /^[\u0600-\u06FF\s،؟!.]+$/u;

export function normalizeCommunicationLanguage(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.length === 2 || trimmed.length === 3
    ? trimmed.toLowerCase()
    : `${trimmed.slice(0, 2).toLowerCase()}-${trimmed.slice(3).toUpperCase()}`;
  return LANGUAGE_TAG.test(normalized) ? normalized : null;
}

export function shouldUpdateCommunicationLanguage({ currentLanguage, candidateLanguage, confidence, substantive }) {
  const current = normalizeCommunicationLanguage(currentLanguage) ?? 'und';
  const candidate = normalizeCommunicationLanguage(candidateLanguage);
  if (!candidate || candidate === current || confidence !== 'high') return false;
  return current === 'und' || substantive === true;
}

export function inferConservativeWhatsAppLanguage(content) {
  const text = String(content ?? '').trim();
  if (!text) return null;
  if (/[\u0600-\u06FF]/u.test(text)) return 'ar';
  const normalized = text.toLocaleLowerCase('tr-TR');
  if (
    TURKISH_GREETING.test(normalized)
    || /[ığüşöçİĞÜŞÖÇ]/u.test(text)
    || /\b(şirket|kurmak|lazım|istiyorum|hakkında|fiyatı|nedir)\b/u.test(normalized)
  ) return 'tr';
  if (
    ENGLISH_GREETING.test(text)
    || /\b(i want|i need|information about|can you|could you|please|price|company setup)\b/i.test(text)
  ) return 'en';
  return null;
}

export function isClearlySubstantiveWhatsAppMessage(content) {
  const text = String(content ?? '').trim();
  if (!text) return false;
  const normalized = text.toLocaleLowerCase('tr-TR');
  if (TURKISH_GREETING.test(normalized) || ENGLISH_GREETING.test(text) || ARABIC_GREETING_OR_SOCIAL.test(text)) {
    const withoutGreeting = normalized
      .replace(TURKISH_GREETING, '')
      .replace(ENGLISH_GREETING, '')
      .trim()
      .replace(/^[,!.:;?\s]+/u, '');
    return Boolean(withoutGreeting);
  }
  return text.split(/\s+/u).length > 1;
}

/**
 * The inbound message is the only authority for an intentional language
 * transition. Greeting-only and ambiguous fragments retain the persisted
 * language; a clear substantive message may replace it.
 */
export function resolveWhatsAppCommunicationLanguage({ currentLanguage, content }) {
  const current = normalizeCommunicationLanguage(currentLanguage) ?? 'und';
  const candidate = inferConservativeWhatsAppLanguage(content);
  if (!candidate) return current;
  return shouldUpdateCommunicationLanguage({
    currentLanguage: current,
    candidateLanguage: candidate,
    confidence: 'high',
    substantive: isClearlySubstantiveWhatsAppMessage(content),
  }) ? candidate : current;
}
