const HUMAN_SUPPORT_PATTERNS = [
  /(?:^|\s)(?:canlı|canli)\s+destek(?:\s|$)/iu,
  /(?:^|\s)(?:müşteri|musteri)\s+temsilcisi(?:\s|$)/iu,
  /(?:^|\s)(?:live\s+support|live\s+agent|human\s+support)(?:\s|$)/iu,
  /(?:^|\s)(?:speak|talk)\s+to\s+(?:a\s+)?(?:human|agent|someone)(?:\s|$)/iu,
  /(?:^|\s)(?:دعم\s+مباشر|موظف|ممثل\s+بشري)(?:\s|$)/iu,
  /^\/(?:w|n)$/iu,
];

const REQUEST_ONLY_WORDS = new Set([
  'istiyorum', 'lütfen', 'lutfen', 'rica', 'ederim', 'i', 'want', 'need',
  'please', 'bir', 'ile', 'görüşmek', 'gorusmek', 'konuşmak', 'konusmak',
  'connect', 'me', 'to', 'a', 'an', 'the',
]);

export function parseCustomerHumanSupportRequest(content) {
  const text = String(content ?? '').trim();
  if (!text) return { requested: false, hasMeaningfulContext: false };

  let requestFound = false;
  let context = text;
  for (const pattern of HUMAN_SUPPORT_PATTERNS) {
    if (!pattern.test(text)) continue;
    requestFound = true;
    context = context.replace(pattern, ' ');
  }
  if (!requestFound) return { requested: false, hasMeaningfulContext: false };

  const meaningfulTerms = context
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter((term) => term && !REQUEST_ONLY_WORDS.has(term));

  return {
    requested: true,
    hasMeaningfulContext: meaningfulTerms.length >= 2,
  };
}
