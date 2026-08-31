const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

const TURKISH_GREETING = /^(?:merhaba|mrb|selam|slm|selamun\s+aleykum|selamün\s+aleyküm|selamunaleykum|selamünaleyküm|s\.?\s*a\.?|sa)(?=$|[\s,!.:;?])/u;
const ENGLISH_GREETING = /^(?:hello|hi|hey|good morning|good evening)\b/i;
const ARABIC_GREETING_OR_SOCIAL = /^[\u0600-\u06FF\s،؟!.]+$/u;

/**
 * Bounded local language evidence for substantive WhatsApp turns. This is
 * data-driven rather than tenant-specific logic: every language uses the same
 * scoring path, while short/weak messages remain unresolved for continuity.
 */
const LANGUAGE_EVIDENCE = [
  { code: 'tr', terms: ['şirket', 'kurmak', 'istiyorum', 'hakkında', 'fiyatı', 'nedir', 'maliyetleri', 'vize', 'hizmet', 'hizmetleri', 'veriyorsunuz', 'sunuyorsunuz', 'sağlıyorsunuz', 'hangi', 'siz', 'kimsiniz', 'ofisiniz', 'nerede', 'destek', 'süreciniz', 'nasıl', 'çalışıyor', 'çalışma', 'saatleriniz'] },
  { code: 'en', terms: ['the', 'and', 'with', 'company', 'setup', 'costs', 'visa', 'options', 'please', 'explain', 'does', 'document', 'who', 'are', 'you', 'what', 'services', 'do', 'provide', 'where', 'is', 'your', 'office', 'how', 'support', 'process', 'work', 'business', 'hours'] },
  { code: 'es', terms: ['quiero', 'obtener', 'trabajador', 'independiente', 'responde', 'español', 'empresa', 'visado', 'visa', 'costes'] },
  { code: 'fr', terms: ['je', 'souhaite', 'créer', 'entreprise', 'répondez', 'français', 'visa', 'coûts', 'options'] },
  { code: 'de', terms: ['ich', 'möchte', 'kosten', 'firmengründung', 'unternehmen', 'visum', 'bitte', 'deutsch'] },
  { code: 'it', terms: ['vorrei', 'società', 'azienda', 'visto', 'opzioni', 'costi', 'italiano'] },
  { code: 'pt', terms: ['quero', 'empresa', 'opções', 'visto', 'custos', 'português', 'abrir'] },
  { code: 'ru', terms: ['я', 'хочу', 'компанию', 'дубае', 'вариантах', 'визы', 'стоимость'] },
];

const EXPLICIT_LANGUAGE_EVIDENCE = [
  { code: 'tr', pattern: /(?:türkçe|turkish)\s+(?:cevap|yanıt|respond)|(?:cevap|yanıt)\s+ver.*türkçe/iu },
  { code: 'en', pattern: /(?:english|ingilizce)\s+(?:answer|respond|cevap)|(?:answer|respond)\s+in\s+english/iu },
  { code: 'ar', pattern: /(?:أجب|أريد).*العربية|(?:arabic|arapça)\s+(?:answer|respond|cevap)/iu },
  { code: 'es', pattern: /(?:responde|respuesta|contesta).*español|(?:spanish|español)\s+(?:answer|respond|respuesta)/iu },
  { code: 'fr', pattern: /(?:répondez|réponds|réponse).*français|(?:french|français)\s+(?:answer|respond|réponse)/iu },
  { code: 'de', pattern: /(?:bitte\s+)?(?:antworte|antworten).*deutsch|(?:german|deutsch)\s+(?:answer|respond|antwort)/iu },
  { code: 'it', pattern: /(?:rispondi|risposta).*italiano|(?:italian|italiano)\s+(?:answer|respond|risposta)/iu },
  { code: 'pt', pattern: /(?:responda|responde).*português|(?:portuguese|português)\s+(?:answer|respond|resposta)/iu },
  { code: 'ru', pattern: /(?:ответьте|ответь).*русск|(?:russian|русский)\s+(?:answer|respond|ответ)/iu },
];

function tokenize(text) {
  return String(text ?? '').toLocaleLowerCase('und').match(/[\p{L}]+/gu) ?? [];
}

function bestEvidenceLanguage(text) {
  const tokens = tokenize(text);
  if (tokens.length < 2) return null;
  const tokenSet = new Set(tokens);
  const matches = LANGUAGE_EVIDENCE
    .map(({ code, terms }) => ({ code, score: terms.reduce((total, term) => total + (tokenSet.has(term) ? 1 : 0), 0) }))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score);
  if (!matches.length || (matches[1] && matches[0].score === matches[1].score)) return null;
  return matches[0].code;
}

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

export function inferExplicitWhatsAppLanguageRequest(content) {
  const text = String(content ?? '').trim();
  if (!text) return null;
  return EXPLICIT_LANGUAGE_EVIDENCE.find(({ pattern }) => pattern.test(text))?.code ?? null;
}

export function inferConservativeWhatsAppLanguage(content) {
  const text = String(content ?? '').trim();
  if (!text) return null;
  const explicit = inferExplicitWhatsAppLanguageRequest(text);
  if (explicit) return explicit;
  if (/[\u0600-\u06FF]/u.test(text)) return 'ar';
  if (/[\u0400-\u04FF]/u.test(text)) return 'ru';
  const normalized = text.toLocaleLowerCase('tr-TR');
  if (
    TURKISH_GREETING.test(normalized)
    || /[ığşİĞŞ]/u.test(text)
    || /\b(şirket|kurmak|lazım|istiyorum|hakkında|fiyatı|nedir)\b/u.test(normalized)
  ) return 'tr';
  if (
    ENGLISH_GREETING.test(text)
    || /\b(i want|i need|information about|can you|could you|please|price|company setup)\b/i.test(text)
  ) return 'en';
  return bestEvidenceLanguage(text);
}

export function isClearlySubstantiveWhatsAppMessage(content) {
  const text = String(content ?? '').trim();
  if (!text) return false;
  const normalized = text.toLocaleLowerCase('tr-TR');
  if (inferExplicitWhatsAppLanguageRequest(text)) return true;
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
 * The current inbound message is the authority for a response-language
 * transition. A reliably recognized greeting is enough to change this turn
 * and the persisted conversation language; only ambiguous text retains
 * continuity.
 */
/**
 * A reliable customer language signal is distinct from substantive continuity:
 * greetings such as "Merhaba" and "Hola" are valid future-media signals,
 * while ambiguous fragments intentionally return null.
 */
export function inferReliableWhatsAppCustomerLanguage(content) {
  const text = String(content ?? '').trim();
  const inferred = inferConservativeWhatsAppLanguage(text);
  if (inferred) return inferred;
  if (/^(?:hola|gracias)\b/iu.test(text)) return 'es';
  if (/^(?:bonjour|merci)\b/iu.test(text)) return 'fr';
  if (/^(?:hallo|danke)\b/iu.test(text)) return 'de';
  if (/^(?:ciao|grazie)\b/iu.test(text)) return 'it';
  if (/^(?:olá|oi|obrigad[oa])\b/iu.test(text)) return 'pt';
  return null;
}

export function resolveWhatsAppMediaResponseLanguage({ currentLanguage, lastReliableCustomerLanguage, caption }) {
  const reliableCaption = inferReliableWhatsAppCustomerLanguage(caption);
  if (String(caption ?? '').trim() && reliableCaption) {
    return { language: resolveWhatsAppCommunicationLanguage({ currentLanguage, content: caption }), source: 'media_caption', detected: reliableCaption };
  }
  const reliable = normalizeCommunicationLanguage(lastReliableCustomerLanguage);
  if (reliable) return { language: reliable, source: 'last_reliable_customer_language', detected: null };
  return { language: normalizeCommunicationLanguage(currentLanguage) ?? 'en', source: 'persisted_language', detected: null };
}

export function resolveWhatsAppCommunicationLanguage({ currentLanguage, content }) {
  const current = normalizeCommunicationLanguage(currentLanguage) ?? 'und';
  const candidate = inferConservativeWhatsAppLanguage(content);
  if (!candidate) return current;
  return candidate;
}
