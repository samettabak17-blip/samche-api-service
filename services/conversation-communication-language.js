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
