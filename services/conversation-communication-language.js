const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

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
  if (/^(?:merhaba|mrb|selam|slm|selamun\s+aleykum|selamün\s+aleyküm|selamunaleykum|selamünaleyküm|s\.?\s*a\.?|sa)(?=$|[\s,!.:;?])/u.test(normalized) || /[ığüşöçİĞÜŞÖÇ]/u.test(text) || /\b(şirket|kurmak|lazım|istiyorum)\b/u.test(normalized)) return 'tr';
  if (/^(hello|hi|good morning|good evening)\b/i.test(text) || /\b(i want|i need|information about)\b/i.test(text)) return 'en';
  return null;
}
