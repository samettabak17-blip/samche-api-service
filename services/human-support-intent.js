const HUMAN_SUPPORT_PATTERNS = [
  /(?:^|\s)(?:canlı|canli)\s+(?:destek|desteğ\w*|desteg\w*|temsilci\w*|operatör\w*|operator\w*|yetkili\w*)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:müşteri|musteri|canlı|canli|gerçek|gercek)?\s*temsilci\w*(?:\s+(?:ile|yle|ne|ye|ine))?\s+(?:aktar\w*|bağla\w*|bagla\w*|görüş\w*|gorus\w*|konuş\w*|konus\w*|yönlendir\w*)/iu,
  /(?:^|\s)temsilci\w*\s+(?:bağlanmak|baglanmak|bağla\w*|bagla\w*|aktar\w*|görüş\w*|gorus\w*|istiyorum)/iu,
  /(?:^|\s)(?:live\s+agent|human\s+support|human\s+agent|human\s+representative|human\s+operator|real\s+person)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)live\s+support(?:\s|[.,!?]|$)/iu,
  /^(?:customer\s+support|müşteri\s+hizmetleri|musteri\s+hizmetleri)[.!?]?$/iu,
  /(?:^|\s)(?:speak|talk|chat)\s+(?:to|with)\s+(?:a\s+)?(?:human|live\s+agent|real\s+person|human\s+agent|live\s+person|human\s+representative|representative|agent|operator|person)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:want|need|give\s+me|get)\s+(?:a\s+)?(?:human|live\s+agent|real\s+person|live\s+person|human\s+representative|human\s+operator)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:connect|transfer|escalate)\s+(?:me\s+)?(?:to\s+)?(?:an?\s+)?(?:human|live\s+agent|real\s+person|human\s+representative|human\s+operator|agent|representative|operator|person|someone)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:bir\s+)?insanla\s+(?:görüşmek|gorusmek|konuşmak|konusmak|bağla\w*)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:gerçek\s+bir\s+(?:müşteri\s+)?(?:insan|kişi|kisi|temsilci)|bot\s+istemiyorum|bot\s+değil|bot\s+degil)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:not\s+ai|no\s+bot|no\s+ai|bot\s+değil\s+insan|gerçek\s+insan|gercek\s+insan|real\s+human|not\s+(?:the\s+)?(?:ai|assistant|bot))(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:دعم\s+مباشر|موظف\s+بشري|ممثل\s+بشري|أريد\s+(?:التحدث\s+مع\s+)?(?:إنسان|شخص\s+حقيقي|موظف|خدمة\s+العملاء|ممثل)|تحدث\s+مع\s+(?:إنسان|موظف|شخص\s+حقيقي|ممثل)|حولني\s+إلى\s+(?:موظف|إنسان))(?:\s|[.,!?]|$)/iu,
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
