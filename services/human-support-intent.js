const HUMAN_SUPPORT_PATTERNS = [
  /(?:^|\s)(?:canlı|canli)\s+(?:destek|temsilci)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:müşteri|musteri)\s+temsilcisi(?:ne|yle|ine)?(?:\s+(?:ile|yle|ne))?\s+(?:aktar\w*|bağla\w*|bagla\w*|görüş\w*|gorus\w*|konuş\w*|konus\w*)/iu,
  /(?:^|\s)temsilci(?:ye)?\s+(?:bağlanmak|baglanmak|aktar|görüşmek|gorusmek)/iu,
  /(?:^|\s)(?:live\s+agent|human\s+support|human\s+agent|human\s+representative|human\s+operator)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:speak|talk|chat)\s+(?:to|with)\s+(?:a\s+)?(?:human|live\s+agent|real\s+person|human\s+agent|live\s+person|human\s+representative)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:want|need|give\s+me|get)\s+(?:a\s+)?(?:human|live\s+agent|real\s+person|live\s+person)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)talk\s+to\s+(?:a\s+)?human(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)connect\s+me\s+to\s+(?:an?\s+)?(?:human|live\s+agent|real\s+person|human\s+representative|human\s+operator|agent|representative|someone)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:bir\s+)?insanla\s+(?:görüşmek|gorusmek|konuşmak|konusmak)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:gerçek\s+bir\s+(?:müşteri\s+)?(?:insan|kişi|temsilci)|bot\s+istemiyorum|bot\s+değil\s+insan)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:not\s+ai|no\s+bot|bot\s+değil|bot\s+degil|gerçek\s+insan|gercek\s+insan|real\s+human)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:دعم\s+مباشر|موظف\s+بشري|ممثل\s+بشري|أريد\s+(?:التحدث\s+مع\s+)?(?:إنسان|شخص\s+حقيقي|موظف|خدمة\s+العملاء)|تحدث\s+مع\s+(?:إنسان|موظف))(?:\s|[.,!?]|$)/iu,
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
