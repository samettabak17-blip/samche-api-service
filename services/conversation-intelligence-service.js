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

// Semantic signal patterns across multiple industries
const EXPLICIT_HUMAN_PATTERNS = [
  /(?:^|\s)(?:speak|talk|chat|connect)\s+(?:to|with)\s+(?:a\s+)?(?:human|live\s+agent|agent|representative|person|someone)(?:\s|$)/iu,
  /(?:^|\s)(?:want|need|give\s+me|get)\s+(?:a\s+)?(?:human|live\s+agent|real\s+person|agent|representative|someone)(?:\s|$)/iu,
  /(?:^|\s)talk\s+to\s+(?:a\s+)?human(?:\s|$)/iu,
  /(?:^|\s)(?:connect|transfer)\s+me\s+to\s+(?:an?\s+)?(?:human|live\s+agent|agent|representative|someone)(?:\s|$)/iu,
  /(?:^|\s)(?:live\s+support|live\s+agent|human\s+support|talk\s+to\s+a\s+live\s+person)(?:\s|$)/iu,
  /(?:^|\s)(?:canlı|canli)\s+destek(?:\s|$)/iu,
  /(?:^|\s)(?:müşteri|musteri)\s+(?:temsilcisi|hizmetleri)(?:\s|$)/iu,
  /(?:^|\s)temsilci(?:ye)?\s+(?:bağlanmak|baglanmak|aktar|görüşmek|gorusmek)(?:\s|$)/iu,
  /(?:^|\s)(?:bir\s+)?insanla\s+(?:görüşmek|gorusmek|konuşmak|konusmak)(?:\s|$)/iu,
  /(?:^|\s)(?:دعم\s+مباشر|موظف|ممثل\s+بşري|أريد\s+(?:التحدث\s+مع\s+)?(?:إنسان|شخص|موظف|ممثل)|تحدث\s+مع\s+(?:إنسان|موظف)|خدمة\s+العملاء)(?:\s|$)/iu,
];

const SUPPORT_ACCOUNT_PATTERN = /(?:log\s*in|sign\s*in|sign\s*up|passwords?|workspace|accounts?|credentials?|reset\s+password|verify\s+account|giriş|şifre|parola|hesap|üyelik)/i;

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
  const isTroubleshooting = SUPPORT_TROUBLESHOOTING_PATTERN.test(text);
  const isPolicy = SUPPORT_POLICY_PATTERN.test(text);
  const isOrderProcess = SUPPORT_ORDER_PATTERN.test(text);
  const isPayment = SUPPORT_PAYMENT_PATTERN.test(text);
  const isUsage = SUPPORT_USAGE_PATTERN.test(text);
  const isContact = SUPPORT_CONTACT_PATTERN.test(text);
  const isAccount = SUPPORT_ACCOUNT_PATTERN.test(text);
  const isComplaint = SUPPORT_COMPLAINT_PATTERN.test(text);

  if (isTroubleshooting) signals.push('SUPPORT_TROUBLESHOOTING');
  if (isPolicy) signals.push('SUPPORT_POLICY');
  if (isOrderProcess) signals.push('SUPPORT_ORDER_PROCESS');
  if (isPayment) signals.push('SUPPORT_PAYMENT_BILLING');
  if (isUsage) signals.push('SUPPORT_USAGE_GUIDE');
  if (isContact) signals.push('SUPPORT_CONTACT_INFO');
  if (isAccount) signals.push('SUPPORT_ACCOUNT');
  if (isComplaint) signals.push('SUPPORT_COMPLAINT');

  const isSupport = isTroubleshooting || isPolicy || isOrderProcess || isPayment || isUsage || isContact || isAccount || isComplaint || isPrivateState;

  // 4. Detect Sales Signals
  const isDiscovery = SALES_DISCOVERY_PATTERN.test(text);
  const isComparison = SALES_COMPARISON_PATTERN.test(text);
  let isPurchase = SALES_PURCHASE_PATTERN.test(text);
  const isPastPurchaseReference = /(?:satın\s+aldığım|satın\s+aldigim|aldığım\s+ürün|i\s+bought|i\s+purchased|item\s+i\s+bought|already\s+bought)/i.test(text);
  if (isPastPurchaseReference && (isTroubleshooting || isPolicy || isOrderProcess || isComplaint)) {
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
    } else if (isDiscreteEntity(currentEntity) && (isTroubleshooting || isPolicy || isUsage)) {
      isCurrentPageSupport = true;
      signals.push('CURRENT_PAGE_ENTITY_SUPPORT_CORRELATION');
    }
  }

  // 6. Assign Primary and Secondary Intents
  let primaryIntent = INTENT_TYPES.GENERAL_CONVERSATION;

  if (isAccount) {
    primaryIntent = INTENT_TYPES.SUPPORT_ACCOUNT_ACCESS;
    if (isTroubleshooting) secondaryIntents.push(INTENT_TYPES.SUPPORT_TROUBLESHOOTING);
  } else if (isPrivateState) {
    primaryIntent = INTENT_TYPES.SUPPORT_PRIVATE_STATE;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isPayment) {
    primaryIntent = INTENT_TYPES.SUPPORT_PAYMENT_BILLING;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_PURCHASE);
  } else if (isCurrentPageSupport) {
    primaryIntent = INTENT_TYPES.SUPPORT_CURRENT_PAGE;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isTroubleshooting) {
    primaryIntent = INTENT_TYPES.SUPPORT_TROUBLESHOOTING;
    if (isSales) secondaryIntents.push(isComparison ? INTENT_TYPES.SALES_COMPARISON : INTENT_TYPES.SALES_DISCOVERY);
  } else if (isContact) {
    primaryIntent = INTENT_TYPES.SUPPORT_CONTACT_INFO;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isUsage) {
    primaryIntent = INTENT_TYPES.SUPPORT_USAGE_GUIDE;
    if (isSales) secondaryIntents.push(INTENT_TYPES.SALES_DISCOVERY);
  } else if (isPolicy) {
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
    isSupport: false,
    isSales: false,
    isHumanRequest: false,
    isPrivateStateRequest: false,
  };

  // 1. Explicit Human Escalation
  if (intent.isHumanRequest || intent.primaryIntent === INTENT_TYPES.HUMAN_ESCALATION) {
    return {
      action: RESOLUTION_ACTIONS.HUMAN_ESCALATION,
      intent: INTENT_TYPES.HUMAN_ESCALATION,
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
  if (intent.isPrivateStateRequest || intent.primaryIntent === INTENT_TYPES.SUPPORT_PRIVATE_STATE) {
    return {
      action: RESOLUTION_ACTIONS.EXPLAIN_LIMITATION_AND_GUIDE,
      intent: INTENT_TYPES.SUPPORT_PRIVATE_STATE,
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
    const isTroubleshoot = intent.primaryIntent === INTENT_TYPES.SUPPORT_TROUBLESHOOTING;
    const isPayment = intent.primaryIntent === INTENT_TYPES.SUPPORT_PAYMENT_BILLING;
    const isUsage = intent.primaryIntent === INTENT_TYPES.SUPPORT_USAGE_GUIDE;
    const isContact = intent.primaryIntent === INTENT_TYPES.SUPPORT_CONTACT_INFO;
    const isOrderProcess = intent.primaryIntent === INTENT_TYPES.SUPPORT_ORDER_PROCESS;

    let guidance = 'Provide the verified policy, procedure, or timeframe directly using current page context, site-wide intelligence, and approved business profile facts.';
    let stage = 'RESOLVE';

    if (isTroubleshoot) {
      stage = 'DIAGNOSE_AND_RESOLVE';
      guidance = 'Diagnose the technical problem step-by-step and provide grounded troubleshooting steps using approved knowledge and product specifications. Do NOT deflect to customer support when instructions exist.';
    } else if (isPayment) {
      stage = 'RESOLVE';
      guidance = 'Provide clear self-service payment troubleshooting steps (verifying card details, checking with issuing bank, trying alternative payment methods, checking billing address). Do NOT deflect prematurely.';
    } else if (isUsage) {
      stage = 'RESOLVE';
      guidance = 'Provide clear, step-by-step instructions on how to use, configure, or clean the product based on verified specifications and approved facts.';
    } else if (isContact) {
      stage = 'RESOLVE';
      guidance = 'Provide verified contact information, support channels, email, phone, operating hours, and fulfillment hub address directly from site intelligence without deflection.';
    } else if (isOrderProcess) {
      stage = 'RESOLVE';
      guidance = 'Explain standard fulfillment steps, delivery timeframes, dispatch cutoffs, and how tracking links are provided via confirmation email.';
    }

    return {
      action: RESOLUTION_ACTIONS.AI_FIRST_RESOLVE,
      intent: intent.primaryIntent,
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
    lines.push('3. Cross-page intelligence must be utilized: answer return, shipping, warranty, FAQ, or contact questions even if the customer is on a product page.');
    lines.push('4. Conclude with a helpful follow-up to confirm resolution or offer immediate next steps.');
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

