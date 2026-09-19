import { parseCustomerHumanSupportRequest } from './human-support-intent.js';
import { isDiscreteEntity } from './contextual-intelligence-service.js';

/**
 * services/conversation-intelligence-service.js
 * Canonical Conversation Intelligence & Support Resolution Engine
 */

export const INTENT_TYPES = Object.freeze({
  SUPPORT_INFORMATIONAL: 'SUPPORT_INFORMATIONAL',
  SUPPORT_CURRENT_PAGE: 'SUPPORT_CURRENT_PAGE',
  SUPPORT_TROUBLESHOOTING: 'SUPPORT_TROUBLESHOOTING',
  SUPPORT_ORDER_PROCESS: 'SUPPORT_ORDER_PROCESS',
  SUPPORT_PAYMENT_BILLING: 'SUPPORT_PAYMENT_BILLING',
  SUPPORT_USAGE_GUIDE: 'SUPPORT_USAGE_GUIDE',
  SUPPORT_CONTACT_INFO: 'SUPPORT_CONTACT_INFO',
  SUPPORT_PRIVATE_STATE: 'SUPPORT_PRIVATE_STATE',
  SUPPORT_ACCOUNT_ACCESS: 'SUPPORT_ACCOUNT_ACCESS',
  SUPPORT_COMPLAINT: 'SUPPORT_COMPLAINT',
  SALES_DISCOVERY: 'SALES_DISCOVERY',
  SALES_COMPARISON: 'SALES_COMPARISON',
  SALES_PURCHASE: 'SALES_PURCHASE',
  LEAD_CAPTURE: 'LEAD_CAPTURE',
  HUMAN_ESCALATION: 'HUMAN_ESCALATION',
  GENERAL_CONVERSATION: 'GENERAL_CONVERSATION',
});

export const RESOLUTION_ACTIONS = Object.freeze({
  AI_FIRST_RESOLVE: 'AI_FIRST_RESOLVE',
  EXPLAIN_LIMITATION_AND_GUIDE: 'EXPLAIN_LIMITATION_AND_GUIDE',
  HUMAN_ESCALATION: 'HUMAN_ESCALATION',
  SALES_ENGAGE: 'SALES_ENGAGE',
  COEXISTENCE_RESOLVE: 'COEXISTENCE_RESOLVE',
});

export const SUPPORT_CASES = Object.freeze({
  NORMAL_RETURN: 'NORMAL_RETURN',
  DEFECTIVE_OR_MALFUNCTION: 'DEFECTIVE_OR_MALFUNCTION',
  DAMAGED_ON_ARRIVAL: 'DAMAGED_ON_ARRIVAL',
  WRONG_ITEM: 'WRONG_ITEM',
  MISSING_ITEM: 'MISSING_ITEM',
  DELIVERY_ISSUE: 'DELIVERY_ISSUE',
  ORDER_STATUS: 'ORDER_STATUS',
  PAYMENT_BILLING: 'PAYMENT_BILLING',
  CANCELLATION: 'CANCELLATION',
  ACCOUNT_ACCESS: 'ACCOUNT_ACCESS',
  PRODUCT_USAGE: 'PRODUCT_USAGE',
  WARRANTY_INQUIRY: 'WARRANTY_INQUIRY',
  EXPLICIT_HUMAN_REQUEST: 'EXPLICIT_HUMAN_REQUEST',
  GENERAL_SUPPORT: 'GENERAL_SUPPORT',
});

export const POLICY_SUBJECTS = Object.freeze({
  NORMAL_RETURN: 'NORMAL_RETURN',
  DEFECTIVE_MALFUNCTION: 'DEFECTIVE_MALFUNCTION',
  DAMAGED_ON_ARRIVAL: 'DAMAGED_ON_ARRIVAL',
  WRONG_ITEM: 'WRONG_ITEM',
  WARRANTY: 'WARRANTY',
  CANCELLATION: 'CANCELLATION',
  SHIPPING_DELIVERY: 'SHIPPING_DELIVERY',
  GENERAL: 'GENERAL',
});

// Semantic signal patterns across multiple industries
const EXPLICIT_HUMAN_PATTERNS = [
  /(?:^|\s)(?:speak|talk|chat)\s+(?:to|with)\s+(?:a\s+)?(?:human|live\s+agent|real\s+person|human\s+agent|live\s+person|human\s+representative)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:want|need|give\s+me|get)\s+(?:a\s+)?(?:human|live\s+agent|real\s+person|live\s+person)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)talk\s+to\s+(?:a\s+)?(?:human|real\s+person|human\s+agent)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:connect|transfer)\s+me\s+to\s+(?:a\s+|an\s+)?(?:human|live\s+agent|real\s+person|human\s+agent|live\s+person|human\s+representative|operator|agent|representative|someone)(?:\s|[.,!?]|$)/iu,
  /(?:^|\s)(?:live\s+agent|human\s+agent|talk\s+to\s+a\s+live\s+person|talk\s+to\s+a\s+human|not\s+ai|real\s+person|real\s+human)(?:\s|[.,!?]|$)/iu,
  /(?:canlı|canli)\s+(?:temsilci|destek)/iu,
  /(?:müşteri|musteri)\s+temsilcisi(?:ne|yle|ine)?(?:\s+(?:ile|yle|ne))?\s+(?:aktar\w*|bağla\w*|bagla\w*|görüş\w*|gorus\w*|konuş\w*|konus\w*)/iu,
  /temsilci(?:ye)?\s+(?:bağlanmak|baglanmak|aktar|görüşmek|gorusmek)/iu,
  /(?:bir\s+)?insanla\s+(?:görüşmek|gorusmek|konuşmak|konusmak)/iu,
  /(?:gerçek\s+bir\s+(?:müşteri\s+)?(?:insan|kişi|temsilci)|bot\s+istemiyorum|bot\s+değil\s+insan)/iu,
  /(?:not\s+ai|no\s+bot|bot\s+değil|bot\s+degil|gerçek\s+insan|gercek\s+insan|real\s+human)/iu,
  /(?:موظف\s+بشري|ممثل\s+بشري|أريد\s+(?:التحدث\s+مع\s+)?(?:إنسان|شخص\s+حقيقي)|تحدث\s+مع\s+إنسان)/iu,
];

const SUPPORT_ACCOUNT_PATTERN = /(?:log\s*in|sign\s*in|sign\s*up|passwords?|workspace|accounts?|credentials?|reset\s+password|verify\s+account|giriş|şifre|parola|hesap|üyelik)/i;

const SUPPORT_DAMAGED_ARRIVAL_PATTERN = /(?:damaged|broken|cracked|shattered|crushed|dented)\s+(?:on|upon|in|during)?\s*(?:arrival|delivery|transit|shipping|box|package)|(?:arrived|delivered)\s+(?:damaged|broken|cracked|shattered|crushed|dented|scratched)|kargo(?:da)?\s+(?:kırılmış|hasar|hasarlı|ezilmiş|parçalanmış)|hasarlı\s+(?:bir\s+)?(?:geldi|ulaştı|teslim)|(?:kırık|ezik)\s+(?:bir\s+)?(?:geldi|ulaştı|teslim)|(?:وصل\s+تالف|مكسور\s+عند\s+الوصول|تضرر\s+أثناء\s+الشحن)/iu;

const SUPPORT_WRONG_ITEM_PATTERN = /(?:received|sent|got)\s+(?:(?:me|us)\s+)?(?:the\s+)?(?:wrong|incorrect|different)\s+(?:item|product|model|order|size|color|package|device)|(?:wrong|incorrect|different)\s+(?:item|product|model)\s+(?:was\s+)?(?:sent|delivered|received)|(?:yanlış|farklı|başka)\s+(?:bir\s+)?(?:ürün|model|sipariş|paket|renk|beden)\s+(?:geldi|gönderildi|teslim\s+edildi|çıktı)|(?:وصلني\s+منتج\s+مختلف|منتج\s+خاطئ|طلب\s+غير\s+صحيح)/iu;

const SUPPORT_MISSING_ITEM_PATTERN = /(?:missing|incomplete|omitted)\s+(?:item|part|accessory|cable|piece|box|order|package)|(?:item|piece|part|accessory|cable)\s+(?:is\s+)?missing|(?:eksik|çıkmadı|yok)\s+(?:bir\s+)?(?:parça|ürün|kablo|aksesuar|kutu)|içinden\s+(?:çıkmadı|eksik\s+çıktı)|(?:قطعة\s+ناقصة|منتج\s+ناقص|عنصر\s+مفقود)/iu;

const SUPPORT_DEFECTIVE_PATTERN = /(?:not\s+working\s+(?:properly|correctly|at\s+all)?|defective|malfunction(?:ing)?|faulty|won['’]?t\s+(?:turn\s+on|start|pair|connect|work|charge|boot|power\s+on)|stopped\s+working|error\s+code|filter\s+light\s+(?:is\s+)?blinking|crashes?|crashed|keeps\s+shutting\s+off|does\s+not\s+turn\s+on|doesn['’]?t\s+work|broken\s+product|hardware\s+malfunction|çalışmıyor|calismiyor|bozuldu|bozuk|arızalandı|arızalı|arizali|açılmıyor|acilmiyor|düzgün\s+çalışmıyor|bağlanmıyor|hata\s+veriyor|ışığı\s+yanıp\s+sönüyor|(?:لا\s+يعمل|معطل|عطل|لا\s+يشتغل|خلل\s+فني))/iu;

const SUPPORT_CANCELLATION_PATTERN = /(?:cancel\s+(?:my\s+)?(?:order|subscription|booking|reservation)|cancellation\s+policy|how\s+(?:do\s+i|to)\s+cancel|iptal\s+(?:etmek|et|politikası|işlemi)|(?:إلغاء\s+(?:الطلب|الحجز)))/iu;

const SUPPORT_WARRANTY_PATTERN = /(?:warranty|guarantee|garanti\s+(?:süresi|kapsamı|şartları)|ضمان)/i;

const SUPPORT_NORMAL_RETURN_PATTERN = /(?:return\s+policy|how\s+(?:can\s+i|do\s+i)\s+return|want\s+to\s+return|send\s+(?:it\s+)?back|return\s+(?:window|period|procedure)|refund\s+(?:policy|procedure|window)|change\s+of\s+mind|unopened\s+return|iade\s+etmek|iade\s+koşulları|iade\s+süresi|iade\s+nasıl\s+yapılır|cayma\s+hakkı|(?:استرجاع|سياسة\s+الإرجاع))/iu;

const SUPPORT_TROUBLESHOOTING_PATTERN = /(?:troubleshoot|not\s+working|broken|malfunction|error|bug|issue|problem|defect|damage|repair|fail|crash|won['’]?t\s+(?:turn\s+on|start|pair|connect|work|charge)|reset|fix|reboot|blink|\bclean(?:ing)?\s+(?:the|my)?\s*(?:filter|sensor|tray|brush|tank|unit|hepa)|filter\s+(?:light|clogged|dirty)|pair(?:ing)?\s+failed|çalışmıyor|calismiyor|bozuk|arızalı|arizali|hata|açılmıyor|acilmiyor|bağlanmıyor|baglanmiyor|düzelmiyor|duzelmiyor|sıfırlama|sifirlama|sorun|problem|fabrika\s+ayarları)/i;

const SUPPORT_POLICY_PATTERN = /(?:returns?|refunds?|warranty|guarantee|shipping|deliver(?:y|ies)|dispatch|cutoff|cancellations?|cancel\b|cancelling|exchanges?|iade|değişim|degisim|garanti|teslimat|kargo|iptal)/i;

const SUPPORT_CONTACT_PATTERN = /(?:contact|reach\s+us|phone|call|email|address|location|fulfillment\s+(?:hub|center)|hours|operating\s+hours|helpdesk|store\s+location|iletişim|telefon|adres|merkez|saatler)/i;

const SUPPORT_ORDER_PATTERN = /(?:where\s+is\s+my\s+order|track\s+(?:my\s+)?(?:order|package|shipment|parcel)|order\s+status|shipping\s+status|delivery\s+status|when\s+will\s+it\s+arrive|dispatch\s+status|sipariş(?:im)?\s+(?:nerede|durumu|ne\s+zaman)|kargom\s+nerede|takip\s+numarası|takip\s+kodu)/i;

const SUPPORT_PAYMENT_PATTERN = /(?:payments?|billing|checkout|credit\s+card|card\s+declined|payment\s+failed|failed\s+to\s+pay|charge\s+issue|invoice|fatura|ödeme|kart\s+hatası|ödeme\s+yapamadım)/i;

const SUPPORT_USAGE_PATTERN = /(?:how\s+(?:do|can)\s+I\s+use|how\s+to\s+(?:use|setup|install|clean|configure)|user\s+guide|manual|usage|instructions|nasıl\s+kullanılır|nasıl\s+çalışır|kurulum|temizlik)/i;

const SUPPORT_PRIVATE_STATE_PATTERN = /(?:#\s*[a-z0-9_-]{3,}|(?:order|tracking|ticket|shipment|invoice|package|parcel|sipariş|kargo|takip)\s*(?:#|no\.?|id|number|numara[a-z]*|kod[a-z]*)\s*[:=]?\s*[a-z0-9_-]{2,}|(?:order|tracking|ticket|shipment|invoice|package|parcel|sipariş|kargo|takip)\s*(?:[:=]|\s)\s*[a-z0-9_-]*\d+[a-z0-9_-]*|my\s+account\s+balance|refund\s+my\s+(?:money|card|credit|payment|order)|charge\s+on\s+my\s+card|kartımdan\s+çekilen|hesap\s+bakiyem)/i;

const SUPPORT_COMPLAINT_PATTERN = /(?:complaint|unhappy|dissatisfied|terrible|awful|worst|manager|escalate|unacceptable|very\s+bad|berbat|rezalet|şikayet|sikayet|memnun\s+değilim|kötü\s+hizmet)/i;

const SALES_DISCOVERY_PATTERN = /(?:recommend|suggest|what\s+do\s+you\s+have|show\s+me|best\s+(?:option|product|choice)|(?:what\s+(?:are|is)\s+)?(?:the\s+)?(?:key\s+|main\s+)?features?|specifications?|specs?|capabilities|functions?|details|pricing|options|catalog|öneri|tavsiye|neler\s+var|en\s+iyi|özellikler?|katalog)/i;

const SALES_COMPARISON_PATTERN = /(?:compare|difference\s+between|which\s+(?:one\s+)?is\s+better|vs\.?|versus|or\s+the\s+other|hangisi\s+daha\s+iyi|farkı\s+ne|farki\s+ne|karşılaştır|kıyasla)/i;

const SALES_PURCHASE_PATTERN = /(?:how\s+much|price|cost|buy|purchase|order\s+now|add\s+to\s+cart|discount|deal|offer|voucher|coupon|fiyat|fiyatı|ücret|satın\s+al|satin\s+al|indirim|kupon|kampanya)/i;

/**
 * Classify granular support case from text and deterministic flags.
 */
export function classifySupportCase(text = '', flags = {}) {
  const query = String(text || '').trim();
  if (flags.isHumanRequest) return SUPPORT_CASES.EXPLICIT_HUMAN_REQUEST;
  if (flags.isPrivateState) return SUPPORT_CASES.ORDER_STATUS;
  if (SUPPORT_DAMAGED_ARRIVAL_PATTERN.test(query)) return SUPPORT_CASES.DAMAGED_ON_ARRIVAL;
  if (SUPPORT_WRONG_ITEM_PATTERN.test(query)) return SUPPORT_CASES.WRONG_ITEM;
  if (SUPPORT_MISSING_ITEM_PATTERN.test(query)) return SUPPORT_CASES.MISSING_ITEM;
  if (SUPPORT_DEFECTIVE_PATTERN.test(query)) return SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION;
  if (SUPPORT_CANCELLATION_PATTERN.test(query)) return SUPPORT_CASES.CANCELLATION;
  if (SUPPORT_WARRANTY_PATTERN.test(query)) return SUPPORT_CASES.WARRANTY_INQUIRY;
  if (SUPPORT_NORMAL_RETURN_PATTERN.test(query)) return SUPPORT_CASES.NORMAL_RETURN;
  if (flags.isAccount) return SUPPORT_CASES.ACCOUNT_ACCESS;
  if (flags.isPayment) return SUPPORT_CASES.PAYMENT_BILLING;
  if (flags.isUsage) return SUPPORT_CASES.PRODUCT_USAGE;
  if (flags.isOrderProcess) return SUPPORT_CASES.DELIVERY_ISSUE;
  if (SUPPORT_TROUBLESHOOTING_PATTERN.test(query)) return SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION;
  if (SUPPORT_POLICY_PATTERN.test(query)) {
    if (/(?:return|refund|iade|değişim)/i.test(query)) return SUPPORT_CASES.NORMAL_RETURN;
    if (/(?:shipping|deliver|cutoff|kargo|teslimat)/i.test(query)) return SUPPORT_CASES.DELIVERY_ISSUE;
  }
  return SUPPORT_CASES.GENERAL_SUPPORT;
}

/**
 * Evaluate policy applicability against the customer's specific support case.
 * Enforces the critical rule: A policy retrieved for one condition (e.g. unopened return)
 * MUST NOT automatically be applied to another condition (e.g. opened defective item).
 */
export function evaluatePolicyApplicability({
  supportCase = null,
  policySubject = null,
  policyText = '',
  applicabilityConditions = [],
  customerIssue = null,
} = {}) {
  const text = String(policyText || '').toLowerCase();
  const effectiveCase = supportCase || customerIssue;

  const conditions = Array.isArray(applicabilityConditions) ? [...applicabilityConditions] : [];
  const requiresUnopened = /(?:unopened|original\s+packaging|unused|açılmamış|kutusunda|kullanılmamış|resaleable|غير\s+مفتوح)/i.test(text);
  if (requiresUnopened && !conditions.includes('UNOPENED_ORIGINAL_PACKAGING')) {
    conditions.push('UNOPENED_ORIGINAL_PACKAGING');
  }

  // 1. DEFECTIVE OR MALFUNCTIONING ITEM
  if (effectiveCase === SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION) {
    if (requiresUnopened) {
      return {
        isApplicable: false,
        policySubject: policySubject || POLICY_SUBJECTS.NORMAL_RETURN,
        applicabilityConditions: conditions,
        reason: 'UNOPENED_RESTRICTION_INAPPLICABLE_TO_DEFECTIVE_PRODUCT',
        explanation: 'The return policy applies specifically to unopened items in original packaging. This condition cannot be applied to an opened defective or malfunctioning product discovered after opening or use.',
        directive: 'DO NOT present the unopened return policy as applicable to this defective product. Explicitly clarify that the published return policy applies to unopened items and does not establish defective product terms.',
      };
    }
    if (/(?:warranty|defective|malfunction|faulty|replacement|repair|garanti|arızalı|değişim|tamir)/i.test(text)) {
      return {
        isApplicable: true,
        policySubject: policySubject || POLICY_SUBJECTS.WARRANTY,
        applicabilityConditions: conditions,
        reason: 'VERIFIED_DEFECTIVE_OR_WARRANTY_POLICY_APPLIES',
        explanation: 'Verified policy explicitly covers warranty, defects, or malfunctioning items.',
        directive: 'Apply verified warranty/defective terms directly without inventing unverified operational promises.',
      };
    }
  }

  // 2. DAMAGED ON ARRIVAL
  if (effectiveCase === SUPPORT_CASES.DAMAGED_ON_ARRIVAL) {
    if (requiresUnopened || /(?:standard\s+return|change\s+of\s+mind)/i.test(text)) {
      return {
        isApplicable: false,
        policySubject: policySubject || POLICY_SUBJECTS.NORMAL_RETURN,
        applicabilityConditions: conditions,
        reason: 'TRANSIT_DAMAGE_NOT_NORMAL_RETURN',
        explanation: 'Transit damage complaints are not governed by standard unopened change-of-mind return policies.',
        directive: 'Do NOT apply normal return policies to transit damage. Guide customer on transit damage reporting and photo evidence.',
      };
    }
  }

  // 3. WRONG ITEM RECEIVED
  if (effectiveCase === SUPPORT_CASES.WRONG_ITEM) {
    if (requiresUnopened) {
      return {
        isApplicable: false,
        policySubject: policySubject || POLICY_SUBJECTS.NORMAL_RETURN,
        applicabilityConditions: conditions,
        reason: 'FULFILLMENT_ERROR_NOT_NORMAL_RETURN',
        explanation: 'Receiving the wrong item is a fulfillment error, not a standard change-of-mind return.',
        directive: 'Do NOT apply unopened return policies to fulfillment errors. Direct to order verification.',
      };
    }
  }

  // 4. NORMAL RETURN
  if (effectiveCase === SUPPORT_CASES.NORMAL_RETURN) {
    return {
      isApplicable: true,
      policySubject: policySubject || POLICY_SUBJECTS.NORMAL_RETURN,
      applicabilityConditions: conditions,
      reason: 'NORMAL_RETURN_POLICY_APPLIES',
      explanation: 'Verified return policy applies directly to standard return requests.',
      directive: 'Explain verified return window, packaging requirements, and procedure step-by-step.',
    };
  }

  return {
    isApplicable: true,
    policySubject: policySubject || POLICY_SUBJECTS.GENERAL,
    applicabilityConditions: conditions,
    reason: 'STANDARD_POLICY_APPLIES',
    explanation: 'Verified policy is evaluated under standard grounding rules.',
    directive: 'Ground response in verified facts.',
  };
}


/**
 * Classify conversation intent using deterministic signals and multi-industry taxonomies.
 * Guarantees provider-independence, zero external LLM cost on deterministic turns,
 * and preserves sales + support coexistence.
 */
export function classifyConversationIntent({
  message = '',
  browsingState = null,
  conversationHistory = [],
} = {}) {
  const text = String(message || '').trim();
  const signals = [];
  const secondaryIntents = [];

  // 1. Explicit Human Support Request Check
  const humanReq = parseCustomerHumanSupportRequest(text);
  const explicitPatternMatch = EXPLICIT_HUMAN_PATTERNS.some((p) => p.test(text));
  if (humanReq.requested || explicitPatternMatch) {
    signals.push('EXPLICIT_HUMAN_REQUEST_SIGNAL');
    return {
      primaryIntent: INTENT_TYPES.HUMAN_ESCALATION,
      supportCase: SUPPORT_CASES.EXPLICIT_HUMAN_REQUEST,
      secondaryIntents: [],
      isSupport: true,
      isSales: false,
      isHumanRequest: true,
      requiresHandoff: true,
      isPrivateStateRequest: false,
      canResolveSafely: false,
      confidence: 1.0,
      signals,
      coexistence: false,
    };
  }

  // 2. Private State Detection (User requesting live private records)
  const isPrivateState = SUPPORT_PRIVATE_STATE_PATTERN.test(text)
    || ((SUPPORT_ORDER_PATTERN.test(text) || /(?:where\s+is\s+my\s+order|kargom\s+nerede)/i.test(text)) && /#|\d+/.test(text));

  if (isPrivateState) {
    signals.push('PRIVATE_STATE_IDENTIFIER_DETECTED');
  }

  // 3. Detect Support Signals
  const isDamagedArrival = SUPPORT_DAMAGED_ARRIVAL_PATTERN.test(text);
  const isWrongItem = SUPPORT_WRONG_ITEM_PATTERN.test(text);
  const isMissingItem = SUPPORT_MISSING_ITEM_PATTERN.test(text);
  const isDefectiveItem = SUPPORT_DEFECTIVE_PATTERN.test(text);
  const isCancellation = SUPPORT_CANCELLATION_PATTERN.test(text);
  const isTroubleshooting = SUPPORT_TROUBLESHOOTING_PATTERN.test(text);
  const isPolicy = SUPPORT_POLICY_PATTERN.test(text);
  const isOrderProcess = SUPPORT_ORDER_PATTERN.test(text);
  const isPayment = SUPPORT_PAYMENT_PATTERN.test(text);
  const isUsage = SUPPORT_USAGE_PATTERN.test(text);
  const isContact = SUPPORT_CONTACT_PATTERN.test(text);
  const isAccount = SUPPORT_ACCOUNT_PATTERN.test(text);
  const isComplaint = SUPPORT_COMPLAINT_PATTERN.test(text);

  if (isDamagedArrival) signals.push('SUPPORT_DAMAGED_ON_ARRIVAL');
  if (isWrongItem) signals.push('SUPPORT_WRONG_ITEM');
  if (isMissingItem) signals.push('SUPPORT_MISSING_ITEM');
  if (isDefectiveItem) signals.push('SUPPORT_DEFECTIVE_OR_MALFUNCTION');
  if (isCancellation) signals.push('SUPPORT_CANCELLATION');
  if (isTroubleshooting) signals.push('SUPPORT_TROUBLESHOOTING');
  if (isPolicy) signals.push('SUPPORT_POLICY');
  if (isOrderProcess) signals.push('SUPPORT_ORDER_PROCESS');
  if (isPayment) signals.push('SUPPORT_PAYMENT_BILLING');
  if (isUsage) signals.push('SUPPORT_USAGE_GUIDE');
  if (isContact) signals.push('SUPPORT_CONTACT_INFO');
  if (isAccount) signals.push('SUPPORT_ACCOUNT');
  if (isComplaint) signals.push('SUPPORT_COMPLAINT');

  const isSupport = isDamagedArrival || isWrongItem || isMissingItem || isDefectiveItem || isCancellation
    || isTroubleshooting || isPolicy || isOrderProcess || isPayment || isUsage || isContact || isAccount || isComplaint || isPrivateState;

  // Granular support case classification
  const supportCase = classifySupportCase(text, {
    isHumanRequest: false,
    isPrivateState,
    isAccount,
    isPayment,
    isUsage,
    isContact,
    isOrderProcess,
  });

  // 4. Detect Sales Signals
  const isDiscovery = SALES_DISCOVERY_PATTERN.test(text);
  const isComparison = SALES_COMPARISON_PATTERN.test(text);
  let isPurchase = SALES_PURCHASE_PATTERN.test(text);
  const isPastPurchaseReference = /(?:satın\s+aldığım|satın\s+aldigim|aldığım\s+ürün|i\s+bought|i\s+purchased|item\s+i\s+bought|already\s+bought)/i.test(text);
  if (isPastPurchaseReference && (isTroubleshooting || isPolicy || isOrderProcess || isComplaint || isDefectiveItem || isDamagedArrival)) {
    const hasActiveCommercialTerms = /(?:price|cost|discount|deal|offer|coupon|fiyat|ücret|indirim|kupon)/i.test(text);
    if (!hasActiveCommercialTerms) {
      isPurchase = false;
    }
  }

  if (isDiscovery) signals.push('SALES_DISCOVERY');
  if (isComparison) signals.push('SALES_COMPARISON');
  if (isPurchase) signals.push('SALES_PURCHASE');

  const isSales = isDiscovery || isComparison || isPurchase;

  // 5. Current Page Context Correlation
  const currentPage = browsingState?.currentPage;
  const currentEntity = browsingState?.currentEntity;
  const pagePath = (currentPage?.path || currentPage?.url || '').toLowerCase();

  let isCurrentPageSupport = false;
  if (isSupport) {
    if (pagePath.includes('return') || pagePath.includes('contact') || pagePath.includes('support') || pagePath.includes('help')) {
      isCurrentPageSupport = true;
      signals.push('CURRENT_PAGE_SUPPORT_PAGE_CORRELATION');
    } else if (isDiscreteEntity(currentEntity) && (isTroubleshooting || isPolicy || isUsage || isDefectiveItem)) {
      isCurrentPageSupport = true;
      signals.push('CURRENT_PAGE_ENTITY_SUPPORT_CORRELATION');
    }
  }

  // 6. Assign Primary and Secondary Intents
  let primaryIntent = INTENT_TYPES.GENERAL_CONVERSATION;

  if (isAccount) {
    primaryIntent = INTENT_TYPES.SUPPORT_ACCOUNT_ACCESS;
    if (isTroubleshooting || isDefectiveItem) secondaryIntents.push(INTENT_TYPES.SUPPORT_TROUBLESHOOTING);
  } else if (isPrivateState) {
    primaryIntent = INTENT_TYPES.SUPPORT_PRIVATE_STATE;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isPayment) {
    primaryIntent = INTENT_TYPES.SUPPORT_PAYMENT_BILLING;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_PURCHASE);
  } else if (isCurrentPageSupport) {
    primaryIntent = INTENT_TYPES.SUPPORT_CURRENT_PAGE;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isDefectiveItem || isTroubleshooting) {
    primaryIntent = INTENT_TYPES.SUPPORT_TROUBLESHOOTING;
    if (isSales) secondaryIntents.push(isComparison ? INTENT_TYPES.SALES_COMPARISON : INTENT_TYPES.SALES_DISCOVERY);
  } else if (isDamagedArrival || isWrongItem || isMissingItem) {
    primaryIntent = INTENT_TYPES.SUPPORT_COMPLAINT;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isContact) {
    primaryIntent = INTENT_TYPES.SUPPORT_CONTACT_INFO;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isUsage) {
    primaryIntent = INTENT_TYPES.SUPPORT_USAGE_GUIDE;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isPolicy || isCancellation) {
    primaryIntent = INTENT_TYPES.SUPPORT_INFORMATIONAL;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_PURCHASE);
  } else if (isOrderProcess) {
    primaryIntent = INTENT_TYPES.SUPPORT_ORDER_PROCESS;
  } else if (isComplaint) {
    primaryIntent = INTENT_TYPES.SUPPORT_COMPLAINT;
  } else if (isComparison) {
    primaryIntent = INTENT_TYPES.SALES_COMPARISON;
  } else if (isPurchase) {
    primaryIntent = INTENT_TYPES.SALES_PURCHASE;
  } else if (isDiscovery) {
    primaryIntent = INTENT_TYPES.SALES_DISCOVERY;
  }

  const confidence = signals.length > 0 ? Math.min(1.0, 0.6 + signals.length * 0.15) : 0.5;

  return {
    primaryIntent,
    supportCase,
    secondaryIntents,
    isSupport,
    isSales,
    isHumanRequest: false,
    requiresHandoff: false,
    isPrivateStateRequest: isPrivateState,
    canResolveSafely: !isPrivateState,
    confidence,
    signals,
    coexistence: isSupport && isSales,
  };
}

/**
 * Evaluate Support Resolution Strategy according to the AI-First Resolution Contract.
 * MANDATORY CONTRACT:
 * - Human handoff is NOT the default resolution path.
 * - AI attempts the highest safe level of resolution available from approved knowledge and page context.
 * - Private customer states are never fabricated.
 */
export function evaluateSupportResolutionPlan({
  intentClassification = null,
  browsingState = null,
  hasRuntimeKnowledge = false,
  hasPersona = false,
} = {}) {
  const intent = intentClassification || {
    primaryIntent: INTENT_TYPES.GENERAL_CONVERSATION,
    supportCase: SUPPORT_CASES.GENERAL_SUPPORT,
    isSupport: false,
    isSales: false,
    isHumanRequest: false,
    isPrivateStateRequest: false,
  };

  const supportCase = intent.supportCase || SUPPORT_CASES.GENERAL_SUPPORT;

  // 1. Explicit Human Escalation
  if (intent.isHumanRequest || intent.primaryIntent === INTENT_TYPES.HUMAN_ESCALATION || supportCase === SUPPORT_CASES.EXPLICIT_HUMAN_REQUEST) {
    return {
      action: RESOLUTION_ACTIONS.HUMAN_ESCALATION,
      intent: INTENT_TYPES.HUMAN_ESCALATION,
      supportCase: SUPPORT_CASES.EXPLICIT_HUMAN_REQUEST,
      stage: 'ESCALATE',
      canResolveSafely: false,
      requiresHandoff: true,
      groundingSources: [],
      reason: 'CUSTOMER_EXPLICIT_HUMAN_REQUEST',
    };
  }

  // 2. Private Customer State Request (Order lookup, private account)
  // AI MUST explain limitation and guide without hallucinating private state.
  // NO premature human handoff!
  if (intent.isPrivateStateRequest || intent.primaryIntent === INTENT_TYPES.SUPPORT_PRIVATE_STATE || supportCase === SUPPORT_CASES.ORDER_STATUS) {
    return {
      action: RESOLUTION_ACTIONS.EXPLAIN_LIMITATION_AND_GUIDE,
      intent: INTENT_TYPES.SUPPORT_PRIVATE_STATE,
      supportCase: SUPPORT_CASES.ORDER_STATUS,
      stage: 'GUIDE',
      canResolveSafely: true,
      requiresHandoff: false,
      groundingSources: ['APPROVED_BUSINESS_POLICIES', 'SUPPORT_CONTACT_CHANNELS'],
      reason: 'PRIVATE_CUSTOMER_DATA_UNAVAILABLE_IN_SESSION',
      guidance: 'Explain clearly that live customer order/account databases cannot be queried directly in this chat session for security. Provide verified standard fulfillment timelines, delivery cutoff rules, and guide the user to check their email tracking link or contact the official support desk with their order ID.',
    };
  }

  // 3. Sales + Support Coexistence
  if (intent.coexistence || (intent.isSupport && intent.isSales)) {
    return {
      action: RESOLUTION_ACTIONS.COEXISTENCE_RESOLVE,
      intent: intent.primaryIntent,
      supportCase,
      stage: 'RESOLVE',
      canResolveSafely: true,
      requiresHandoff: false,
      groundingSources: ['CURRENT_PAGE_CONTEXT', 'APPROVED_KNOWLEDGE', 'BUSINESS_PROFILE'],
      reason: 'DUAL_SALES_AND_SUPPORT_INTENT',
      guidance: 'Address both the support question (e.g. policy, returns, warranty) and the sales question (e.g. product features, recommendations) directly in the response without handoff.',
    };
  }

  // 4. Resolvable Support Request (Informational, Current Page, Troubleshooting, Policy, Payment, Usage)
  // AI MUST resolve directly. NO handoff!
  if (intent.isSupport) {
    const isCurrentPage = intent.primaryIntent === INTENT_TYPES.SUPPORT_CURRENT_PAGE;

    // Granular Support Case Handlers with Policy Applicability Guards
    if (supportCase === SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION) {
      return {
        action: RESOLUTION_ACTIONS.AI_FIRST_RESOLVE,
        intent: intent.primaryIntent,
        supportCase: SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION,
        stage: 'DIAGNOSE_AND_RESOLVE',
        canResolveSafely: true,
        requiresHandoff: false,
        groundingSources: isCurrentPage
          ? ['CURRENT_PAGE_VISIBLE_FACT', 'APPROVED_KNOWLEDGE', 'ACTIVE_BUSINESS_PROFILE', 'RELEVANT_TENANT_SITE_INTELLIGENCE']
          : ['APPROVED_KNOWLEDGE', 'ACTIVE_BUSINESS_PROFILE', 'CURRENT_PAGE_CONTEXT', 'RELEVANT_TENANT_SITE_INTELLIGENCE'],
        reason: 'DEFECTIVE_OR_MALFUNCTIONING_ITEM_DIAGNOSIS',
        policyApplicability: {
          normalUnopenedReturnApplies: false,
          replacementRequiresVerification: true,
          physicalVisitForbidden: true,
        },
        guidance: [
          'DEFECTIVE / MALFUNCTIONING PRODUCT RESOLUTION CONTRACT:',
          '1. UNDERSTAND & DIAGNOSE: Directly acknowledge that the product is malfunctioning or not working properly. Do NOT deflect with generic messages like "contact customer support" or give passive brush-offs.',
          '2. POLICY APPLICABILITY GUARD (CRITICAL): A policy retrieved for unopened returns does NOT apply to an opened defective product. If the verified return policy specifies unopened or original packaging conditions, explicitly clarify: the published return policy applies to unopened items and does not automatically govern opened defective products. DO NOT tell the customer they can return it under an unopened 14-day policy.',
          '3. SAFE TROUBLESHOOTING: Provide safe product-specific troubleshooting steps ONLY if verified in approved knowledge/product specifications. If none are verified, ask relevant diagnostic questions (what symptoms occur, what indicator lights show) without fabricating troubleshooting steps.',
          '4. NO UNVERIFIED REPLACEMENT PROMISES: Do NOT promise a replacement or exchange unless an approved replacement policy is explicitly verified in tenant knowledge. If unverified, clarify that replacement eligibility must be confirmed with the support team.',
          '5. NO INVENTED PHYSICAL RETURN LOCATIONS: Never tell the customer to visit a fulfillment center, warehouse, or office in person unless verified tenant knowledge explicitly states customer walk-in drop-offs are accepted there.',
          '6. INTERACTIVE CONTINUATION: Guide the customer through the specific troubleshooting step and ask them to confirm what happens when they try it. Do NOT append support email/phone contact details unless troubleshooting has been fully exhausted or the customer explicitly requests contact details.',
        ].join('\n'),
      };
    }

    if (supportCase === SUPPORT_CASES.DAMAGED_ON_ARRIVAL) {
      return {
        action: RESOLUTION_ACTIONS.AI_FIRST_RESOLVE,
        intent: intent.primaryIntent,
        supportCase: SUPPORT_CASES.DAMAGED_ON_ARRIVAL,
        stage: 'ASSESS_AND_GUIDE',
        canResolveSafely: true,
        requiresHandoff: false,
        groundingSources: ['APPROVED_KNOWLEDGE', 'ACTIVE_BUSINESS_PROFILE', 'RELEVANT_TENANT_SITE_INTELLIGENCE'],
        reason: 'DAMAGED_ON_ARRIVAL_ASSESSMENT',
        policyApplicability: {
          normalUnopenedReturnApplies: false,
          replacementRequiresVerification: true,
          physicalVisitForbidden: true,
        },
        guidance: [
          'DAMAGED ON ARRIVAL RESOLUTION CONTRACT:',
          '1. UNDERSTAND & ACKNOWLEDGE: Acknowledge that the item arrived damaged in transit. Do not deflect.',
          '2. POLICY APPLICABILITY GUARD: Transit damage is NOT a normal change-of-mind return. Do NOT apply unopened return policy restrictions.',
          '3. EVIDENCE & NEXT STEPS: Advise the customer to keep the original shipping box/packaging and take photos of the damaged item and packaging for carrier claim verification.',
          '4. INTERACTIVE DIAGNOSIS: Ask the customer to describe the visible damage or share photos so you can guide them on verified next steps. Do not invent replacement promises or physical walk-in locations.',
        ].join('\n'),
      };
    }

    if (supportCase === SUPPORT_CASES.WRONG_ITEM) {
      return {
        action: RESOLUTION_ACTIONS.AI_FIRST_RESOLVE,
        intent: intent.primaryIntent,
        supportCase: SUPPORT_CASES.WRONG_ITEM,
        stage: 'ASSESS_AND_GUIDE',
        canResolveSafely: true,
        requiresHandoff: false,
        groundingSources: ['APPROVED_KNOWLEDGE', 'ACTIVE_BUSINESS_PROFILE', 'RELEVANT_TENANT_SITE_INTELLIGENCE'],
        reason: 'WRONG_ITEM_FULFILLMENT_ERROR',
        policyApplicability: {
          normalUnopenedReturnApplies: false,
          replacementRequiresVerification: true,
          physicalVisitForbidden: true,
        },
        guidance: [
          'WRONG ITEM RECEIVED RESOLUTION CONTRACT:',
          '1. ACKNOWLEDGE FULFILLMENT ERROR: Acknowledge that an incorrect item was received. Do not deflect.',
          '2. POLICY APPLICABILITY GUARD: A dispatch error is NOT a standard customer return. Do not impose unopened return restrictions or fees.',
          '3. VERIFICATION & NEXT STEPS: Ask the customer to describe the incorrect item received and check their packing slip/order details directly in chat.',
        ].join('\n'),
      };
    }

    if (supportCase === SUPPORT_CASES.NORMAL_RETURN) {
      return {
        action: RESOLUTION_ACTIONS.AI_FIRST_RESOLVE,
        intent: intent.primaryIntent,
        supportCase: SUPPORT_CASES.NORMAL_RETURN,
        stage: 'RESOLVE',
        canResolveSafely: true,
        requiresHandoff: false,
        groundingSources: isCurrentPage
          ? ['CURRENT_PAGE_VISIBLE_FACT', 'SITE_STRUCTURED_DATA', 'APPROVED_KNOWLEDGE', 'RELEVANT_TENANT_SITE_INTELLIGENCE']
          : ['APPROVED_KNOWLEDGE', 'ACTIVE_BUSINESS_PROFILE', 'CURRENT_PAGE_CONTEXT', 'RELEVANT_TENANT_SITE_INTELLIGENCE'],
        reason: 'NORMAL_RETURN_POLICY_RESOLUTION',
        policyApplicability: {
          normalUnopenedReturnApplies: true,
        },
        guidance: 'Provide the verified return policy, window, packaging requirements, and procedure step-by-step from verified tenant facts. Do not invent unverified return drop-off locations or promises.',
      };
    }
    const isTroubleshoot = intent.primaryIntent === INTENT_TYPES.SUPPORT_TROUBLESHOOTING;
    const isPayment = intent.primaryIntent === INTENT_TYPES.SUPPORT_PAYMENT_BILLING;
    const isUsage = intent.primaryIntent === INTENT_TYPES.SUPPORT_USAGE_GUIDE;
    const isContact = intent.primaryIntent === INTENT_TYPES.SUPPORT_CONTACT_INFO;
    const isOrderProcess = intent.primaryIntent === INTENT_TYPES.SUPPORT_ORDER_PROCESS;

    let guidance = 'Provide the verified policy, procedure, or timeframe directly using current page context, site-wide intelligence, and approved business profile facts.';
    let stage = 'RESOLVE';

    if (isTroubleshoot) {
      stage = 'DIAGNOSE_AND_RESOLVE';
      guidance = 'Diagnose the technical problem step-by-step and provide grounded troubleshooting steps using approved knowledge and product specifications. Ask the user for the result of the diagnostic step. Do NOT deflect or append support email/phone to initial troubleshooting advice.';
    } else if (isPayment) {
      stage = 'RESOLVE';
      guidance = 'Provide clear self-service payment troubleshooting steps (verifying card details, checking with issuing bank, trying alternative payment methods, checking billing address). Do NOT deflect prematurely.';
    } else if (isUsage) {
      stage = 'RESOLVE';
      guidance = 'Provide clear, step-by-step instructions on how to use, configure, or clean the product based on verified specifications and approved facts.';
    } else if (isContact) {
      stage = 'RESOLVE';
      guidance = 'Provide verified contact information, support channels, email, phone, operating hours, and fulfillment hub address directly from site intelligence because the customer explicitly requested contact details.';
    } else if (isOrderProcess) {
      stage = 'RESOLVE';
      guidance = 'Explain standard fulfillment steps, delivery timeframes, dispatch cutoffs, and how tracking links are provided via confirmation email.';
    }

    return {
      action: RESOLUTION_ACTIONS.AI_FIRST_RESOLVE,
      intent: intent.primaryIntent,
      supportCase,
      stage,
      canResolveSafely: true,
      requiresHandoff: false,
      groundingSources: isCurrentPage
        ? ['CURRENT_PAGE_VISIBLE_FACT', 'SITE_STRUCTURED_DATA', 'APPROVED_KNOWLEDGE', 'RELEVANT_TENANT_SITE_INTELLIGENCE']
        : ['APPROVED_KNOWLEDGE', 'ACTIVE_BUSINESS_PROFILE', 'CURRENT_PAGE_CONTEXT', 'RELEVANT_TENANT_SITE_INTELLIGENCE'],
      reason: 'RESOLVABLE_VIA_APPROVED_KNOWLEDGE_AND_PAGE_CONTEXT',
      guidance,
    };
  }

  // 5. Sales Engagement
  if (intent.isSales) {
    return {
      action: RESOLUTION_ACTIONS.SALES_ENGAGE,
      intent: intent.primaryIntent,
      supportCase,
      stage: 'GUIDE',
      canResolveSafely: true,
      requiresHandoff: false,
      groundingSources: ['CURRENT_PAGE_CONTEXT', 'APPROVED_KNOWLEDGE', 'BUSINESS_PROFILE', 'RELEVANT_TENANT_SITE_INTELLIGENCE'],
      reason: 'COMMERCIAL_ENGAGEMENT',
      guidance: 'Provide consultative, expert sales guidance highlighting key product features and benefits. Proactively recommend next steps, offer comparisons, and assist with ordering details.',
    };
  }

  // 6. General Fallback
  return {
    action: RESOLUTION_ACTIONS.AI_FIRST_RESOLVE,
    intent: INTENT_TYPES.GENERAL_CONVERSATION,
    supportCase: SUPPORT_CASES.GENERAL_SUPPORT,
    stage: 'RESOLVE',
    canResolveSafely: true,
    requiresHandoff: false,
    groundingSources: ['BUSINESS_PROFILE', 'APPROVED_KNOWLEDGE'],
    reason: 'GENERAL_INQUIRY',
    guidance: 'Respond helpfully, politely, and professionally in alignment with active persona rules.',
  };
}

/**
 * Build a concise prompt directive for the generative model based on the resolution plan.
 */
export function buildConversationIntelligencePromptSection(plan = null) {
  if (!plan) return '';

  const lines = [
    '================================================================================',
    'CONVERSATION INTELLIGENCE DIRECTIVE (AI-FIRST RESOLUTION & SALES CONTRACT)',
    '================================================================================',
    `PRIMARY INTENT: ${plan.intent}`,
    ...(plan.supportCase ? [`SUPPORT CASE: ${plan.supportCase}`] : []),
    `ACTION: ${plan.action}`,
    `RESOLUTION STAGE: ${plan.stage}`,
    `SAFE DIRECT RESOLUTION: ${plan.canResolveSafely ? 'YES (MANDATORY AI-FIRST DIRECT RESOLUTION)' : 'NO'}`,
    `HUMAN ESCALATION REQUIRED: ${plan.requiresHandoff ? 'YES' : 'NO (PREVENT DEFLECTION)'}`,
  ];

  if (plan.guidance) {
    lines.push(`OPERATIONAL GUIDANCE:\n${plan.guidance}`);
  }

  if (plan.action === RESOLUTION_ACTIONS.AI_FIRST_RESOLVE) {
    lines.push('AI-FIRST SUPPORT RESOLUTION CONTRACT:');
    lines.push('1. Under NO circumstances should you deflect this resolvable support request with "Please contact customer support", "Visit our website", or "Reach out to our team". Resolve it directly with verified knowledge, current page information, and site-wide intelligence.');
    lines.push('2. Provide concrete, step-by-step instructions (e.g. return process steps, packaging requirements, delivery timelines and cutoffs, cancellation procedure, account recovery steps, troubleshooting instructions).');
    lines.push('3. INTERACTIVE DIAGNOSTIC ENGAGEMENT: Treat troubleshooting as an active conversation. Give the first troubleshooting step, ask the customer to try it, and ask for their result. Do NOT automatically append support phone/email unless troubleshooting is exhausted or the customer explicitly asked for contact details.');
    lines.push('4. Cross-page intelligence must be utilized: answer return, shipping, warranty, FAQ, or contact questions even if the customer is on a product page.');
    lines.push('5. Conclude with a helpful follow-up to confirm resolution or offer immediate next steps.');

    if (plan.supportCase === SUPPORT_CASES.DEFECTIVE_OR_MALFUNCTION) {
      lines.push('CRITICAL POLICY APPLICABILITY INVARIANTS FOR DEFECTIVE PRODUCTS:');
      lines.push('- A normal return policy requiring unopened items in original packaging does NOT apply to an opened defective product.');
      lines.push('- Clarify honestly if applicable: "The verified return policy applies to unopened items in original packaging, so it does not automatically cover opened or defective products."');
      lines.push('- NEVER promise a replacement or exchange unless an approved replacement policy is explicitly verified in tenant facts. State that replacement eligibility must be confirmed with the support team.');
      lines.push('- NEVER tell the customer to visit a fulfillment hub or warehouse in person unless verified tenant knowledge explicitly confirms walk-in customer drop-offs are accepted there.');
      lines.push('- Do NOT invent troubleshooting steps. If no steps are verified in your facts, ask diagnostic questions about symptoms.');
    } else if (plan.supportCase === SUPPORT_CASES.DAMAGED_ON_ARRIVAL) {
      lines.push('CRITICAL POLICY APPLICABILITY INVARIANTS FOR DAMAGED ARRIVAL:');
      lines.push('- Transit damage is NOT a standard change-of-mind return. Do NOT apply unopened return restrictions.');
      lines.push('- Guide the customer to document damage (take photos of packaging and item).');
    } else if (plan.supportCase === SUPPORT_CASES.WRONG_ITEM) {
      lines.push('CRITICAL POLICY APPLICABILITY INVARIANTS FOR WRONG ITEM:');
      lines.push('- Fulfillment error is NOT a normal return or product defect.');
      lines.push('- Request order details and photos of incorrect item received directly in chat.');
    }
  } else if (plan.action === RESOLUTION_ACTIONS.SALES_ENGAGE) {
    lines.push('ACTIVE SALES CONSULTANT CONTRACT:');
    lines.push('1. Do NOT behave as a passive answering machine. Provide a helpful, value-oriented response that highlights key features and real-world benefits for the customer.');
    lines.push('2. Ground all claims strictly in verified specifications, visible attributes, and approved catalog facts.');
    lines.push('3. Proactively offer relevant next steps: offer to compare with other items they viewed, highlight delivery or warranty advantages, ask qualifying questions, or assist them toward taking the next purchase step.');
    lines.push('4. Conclude with a warm, open-ended question or next step.');
  } else if (plan.action === RESOLUTION_ACTIONS.COEXISTENCE_RESOLVE) {
    lines.push('SALES + SUPPORT DUAL RESOLUTION CONTRACT:');
    lines.push('1. Seamlessly resolve both the support question (return, shipping, policy, troubleshooting) and the sales question (features, recommendations, comparison) in the same turn without deflection.');
    lines.push('2. Ground both aspects in verified facts and provide clear, proactive next steps.');
  } else if (plan.action === RESOLUTION_ACTIONS.EXPLAIN_LIMITATION_AND_GUIDE) {
    lines.push('CRITICAL CONTRACT (NO PRIVATE DATA FABRICATION):');
    lines.push('1. Do NOT invent order status, delivery progress, or tracking numbers. Clearly state that live order/account databases cannot be queried directly in this chat session for security/privacy.');
    lines.push('2. Explain the verified standard delivery timeframes and dispatch cutoffs from site policies.');
    lines.push('3. Instruct the customer on the official next step (checking their confirmation email link or contacting support with their order ID).');
  }

  lines.push('================================================================================');
  return lines.join('\n');
}

