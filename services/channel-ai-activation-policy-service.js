/**
 * services/channel-ai-activation-policy-service.js
 *
 * Generic, tenant-configurable AI Activation Policy engine.
 *
 * Precedence Order:
 * 1. Human Mode / Takeover (handling_mode === 'HUMAN') -> SUPPRESSED (HUMAN_MODE_ACTIVE)
 * 2. Contact/Conversation Override (NEVER_AI)           -> SUPPRESSED (OVERRIDE_NEVER_AI)
 * 3. Contact/Conversation Override (ALWAYS_AI)          -> ACTIVATED  (OVERRIDE_ALWAYS_AI)
 * 4. Channel AI Activation Policy:
 *    - MANUAL_ONLY          -> SUPPRESSED (POLICY_MANUAL_ONLY) [Default]
 *    - ALL_MESSAGES         -> ACTIVATED  (POLICY_ALL_MESSAGES)
 *    - TRIGGER_ONLY         -> ACTIVATED (TRIGGER_MATCHED) / SUPPRESSED (NO_TRIGGER_MATCHED)
 *    - BUSINESS_INTENT_ONLY -> ACTIVATED (BUSINESS_INTENT_CLASSIFIED) / SUPPRESSED (SOCIAL_OR_NON_BUSINESS_INTENT | CLASSIFICATION_UNCERTAIN)
 */

export const AI_ACTIVATION_MODES = Object.freeze({
  MANUAL_ONLY: 'MANUAL_ONLY',
  ALL_MESSAGES: 'ALL_MESSAGES',
  BUSINESS_INTENT_ONLY: 'BUSINESS_INTENT_ONLY',
  TRIGGER_ONLY: 'TRIGGER_ONLY',
});

export const AI_BEHAVIOR_OVERRIDES = Object.freeze({
  AUTOMATIC: 'AUTOMATIC',
  AI_ONLY: 'AI_ONLY',
  ALWAYS_AI: 'AI_ONLY',
  NEVER_AI: 'NEVER_AI',
  FIRST_CONTACT_HOLD: 'FIRST_CONTACT_HOLD',
  UNDECIDED: 'FIRST_CONTACT_HOLD',
});

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchTriggers(text, triggers = []) {
  if (!text || typeof text !== 'string') return { matched: false, matchedTriggers: [] };
  if (!Array.isArray(triggers) || triggers.length === 0) return { matched: false, matchedTriggers: [] };

  const normalizedInput = normalizeText(text);
  if (!normalizedInput) return { matched: false, matchedTriggers: [] };

  const matchedTriggers = [];

  for (const rawTrigger of triggers) {
    if (typeof rawTrigger !== 'string') continue;
    const cleanTrigger = normalizeText(rawTrigger);
    if (!cleanTrigger) continue;

    if (cleanTrigger.includes(' ')) {
      if (normalizedInput.includes(cleanTrigger)) {
        matchedTriggers.push(rawTrigger.trim());
      }
      continue;
    }

    try {
      const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(cleanTrigger)}(?:$|[^\\p{L}\\p{N}])`, 'iu');
      if (pattern.test(normalizedInput)) {
        matchedTriggers.push(rawTrigger.trim());
      }
    } catch {
      if (normalizedInput.includes(cleanTrigger)) {
        matchedTriggers.push(rawTrigger.trim());
      }
    }
  }

  return {
    matched: matchedTriggers.length > 0,
    matchedTriggers,
  };
}

const COMMON_SOCIAL_PATTERNS = [
  /^(?:selam|merhaba|slm|mrhb|hey|hi|hello|günaydın|iyi\s+akşamlar|iyi\s+geceler|good\s+morning|good\s+evening)[.!]?$/i,
  /\b(?:naber|nasılsın|nbr|nasilsin|nabıyon|napıyorsun|napıyon|how\s+are\s+you|what'?s\s+up|sup)\b/i,
  /\b(?:akşam\s+neredesin|aksam\s+nerdesin|neredesin|nerdesin|where\s+are\s+you|buluşalım|görüşelim|kahve\s+içelim)\b/i,
  /\b(?:doğum\s+günün\s+kutlu\s+olsun|dogum\s+gunun\s+kutlu\s+olsun|happy\s+birthday|tebrikler|kutlarım|congrats|geçmiş\s+olsun)\b/i,
  /\b(?:canım|kardeşim|dostum|kanka|bro|knk|aşkım|hocam|kral)\b/i,
];

const COMMON_BUSINESS_PATTERNS = [
  /\b(?:şirket|sirket|company|business|kuruluş|kurulum|kurmak|formation|incorporation|setup)\b/i,
  /\b(?:vize|visa|ikamet|oturum|residence|residency|emirates\s*id)\b/i,
  /\b(?:fiyat|fiyatlar|ücret|ucret|maliyet|cost|price|pricing|teklif|quote|bütçe|butce)\b/i,
  /\b(?:danışmanlık|danismanlik|consulting|advisory|hizmet|hizmetler|services)\b/i,
  /\b(?:banka|bank|account|hesap|banka\s+hesabı|hesap\s+açılışı)\b/i,
  /\b(?:muhasebe|accounting|vergi|tax|vat|audit|beyanname)\b/i,
  /\b(?:freezone|free\s+zone|mainland|offshore|lisans|license)\b/i,
  /\b(?:bilgi\s+almak\s+istiyorum|yardımcı\s+olabilir\s+misiniz|yardimci\s+olabilir\s+misiniz|i\s+would\s+like\s+information|how\s+to\s+start|need\s+help\s+with)\b/i,
  /\b(?:paket|plan|satın\s+al|satin\s+al|buy|order|sipariş|siparis|demo|appointment|randevu)\b/i,
];

export async function classifySemanticBusinessIntent({
  messageText,
  tenantContext = {},
  generateAiClassification = null,
}) {
  const text = String(messageText ?? '').trim();
  if (!text) return { label: 'EMPTY', isBusinessIntent: false, confidence: 1.0 };

  if (typeof generateAiClassification === 'function') {
    try {
      const result = await generateAiClassification({
        text,
        tenantContext,
      });
      if (result && typeof result.isBusinessIntent === 'boolean') {
        return {
          label: result.label || (result.isBusinessIntent ? 'BUSINESS' : 'SOCIAL'),
          isBusinessIntent: result.isBusinessIntent,
          confidence: Number(result.confidence ?? 0.9),
        };
      }
    } catch (err) {
      console.warn('SEMANTIC_INTENT_CLASSIFIER_AI_WARN', err?.message);
    }
  }

  const isSocial = COMMON_SOCIAL_PATTERNS.some((p) => p.test(text));
  const isBusiness = COMMON_BUSINESS_PATTERNS.some((p) => p.test(text));

  if (isBusiness && !isSocial) {
    return { label: 'BUSINESS', isBusinessIntent: true, confidence: 0.95 };
  }

  if (isSocial && !isBusiness) {
    return { label: 'SOCIAL', isBusinessIntent: false, confidence: 0.95 };
  }

  if (isBusiness && isSocial) {
    return { label: 'BUSINESS', isBusinessIntent: true, confidence: 0.85 };
  }

  if (text.length > 20 && /\b(?:istiyorum|istiyoruz|bilgi|nasıl|nasil|öğrenmek|ogrenmek|how|what|where|can\s+you|please|help)\b/i.test(text)) {
    return { label: 'BUSINESS', isBusinessIntent: true, confidence: 0.75 };
  }

  return { label: 'UNCERTAIN', isBusinessIntent: false, confidence: 0.5 };
}

export async function evaluateChannelAiActivationPolicy({
  messageText = '',
  conversation = {},
  channelConfig = {},
  tenantContext = {},
  generateAiClassification = null,
}) {
  const timestamp = new Date().toISOString();
  const text = String(messageText ?? '').trim();

  // 1. Human Mode / Takeover Precedence (Authoritative)
  const isHumanHandling = conversation?.handling_mode === 'HUMAN' || conversation?.status === 'closed';
  if (isHumanHandling) {
    return {
      eligible: false,
      decision: 'SUPPRESSED',
      reasonCode: 'HUMAN_MODE_ACTIVE',
      policy: channelConfig?.activation_policy || AI_ACTIVATION_MODES.MANUAL_ONLY,
      matchedTriggers: [],
      classifierLabel: null,
      timestamp,
    };
  }

  // 2. Contact / Conversation Override Precedence
  const rawOverride = conversation?.ai_behavior_override || conversation?.contact_ai_behavior_override || conversation?.contact?.ai_behavior_override || AI_BEHAVIOR_OVERRIDES.AUTOMATIC;
  const override = String(rawOverride).toUpperCase().trim();

  if (override === 'NEVER_AI') {
    return {
      eligible: false,
      decision: 'SUPPRESSED',
      reasonCode: 'OVERRIDE_NEVER_AI',
      policy: channelConfig?.activation_policy || AI_ACTIVATION_MODES.MANUAL_ONLY,
      matchedTriggers: [],
      classifierLabel: null,
      timestamp,
    };
  }

  if (override === 'AI_ONLY' || override === 'ALWAYS_AI') {
    return {
      eligible: true,
      decision: 'ACTIVATED',
      reasonCode: 'OVERRIDE_AI_ONLY',
      policy: channelConfig?.activation_policy || AI_ACTIVATION_MODES.MANUAL_ONLY,
      matchedTriggers: [],
      classifierLabel: null,
      timestamp,
    };
  }

  if (override === 'FIRST_CONTACT_HOLD' || override === 'UNDECIDED') {
    return {
      eligible: false,
      decision: 'SUPPRESSED',
      reasonCode: 'FIRST_CONTACT_HOLD',
      policy: channelConfig?.activation_policy || AI_ACTIVATION_MODES.MANUAL_ONLY,
      matchedTriggers: [],
      classifierLabel: null,
      timestamp,
    };
  }

  // 3. Channel Activation Policy Evaluation
  const policy = String(channelConfig?.activation_policy || AI_ACTIVATION_MODES.MANUAL_ONLY).toUpperCase();
  const configuredTriggers = Array.isArray(channelConfig?.activation_triggers) ? channelConfig.activation_triggers : [];

  switch (policy) {
    case AI_ACTIVATION_MODES.MANUAL_ONLY: {
      return {
        eligible: false,
        decision: 'SUPPRESSED',
        reasonCode: 'POLICY_MANUAL_ONLY',
        policy: AI_ACTIVATION_MODES.MANUAL_ONLY,
        matchedTriggers: [],
        classifierLabel: null,
        timestamp,
      };
    }

    case AI_ACTIVATION_MODES.ALL_MESSAGES: {
      return {
        eligible: true,
        decision: 'ACTIVATED',
        reasonCode: 'POLICY_ALL_MESSAGES',
        policy: AI_ACTIVATION_MODES.ALL_MESSAGES,
        matchedTriggers: [],
        classifierLabel: null,
        timestamp,
      };
    }

    case AI_ACTIVATION_MODES.TRIGGER_ONLY: {
      const { matched, matchedTriggers } = matchTriggers(text, configuredTriggers);
      if (matched) {
        return {
          eligible: true,
          decision: 'ACTIVATED',
          reasonCode: 'TRIGGER_MATCHED',
          policy: AI_ACTIVATION_MODES.TRIGGER_ONLY,
          matchedTriggers,
          classifierLabel: null,
          timestamp,
        };
      }
      return {
        eligible: false,
        decision: 'SUPPRESSED',
        reasonCode: 'NO_TRIGGER_MATCHED',
        policy: AI_ACTIVATION_MODES.TRIGGER_ONLY,
        matchedTriggers: [],
        classifierLabel: null,
        timestamp,
      };
    }

    case AI_ACTIVATION_MODES.BUSINESS_INTENT_ONLY: {
      const triggerCheck = matchTriggers(text, configuredTriggers);
      if (triggerCheck.matched) {
        return {
          eligible: true,
          decision: 'ACTIVATED',
          reasonCode: 'BUSINESS_TRIGGER_MATCHED',
          policy: AI_ACTIVATION_MODES.BUSINESS_INTENT_ONLY,
          matchedTriggers: triggerCheck.matchedTriggers,
          classifierLabel: 'BUSINESS',
          timestamp,
        };
      }

      const classification = await classifySemanticBusinessIntent({
        messageText: text,
        tenantContext,
        generateAiClassification,
      });

      if (classification.isBusinessIntent) {
        return {
          eligible: true,
          decision: 'ACTIVATED',
          reasonCode: 'BUSINESS_INTENT_CLASSIFIED',
          policy: AI_ACTIVATION_MODES.BUSINESS_INTENT_ONLY,
          matchedTriggers: [],
          classifierLabel: classification.label,
          timestamp,
        };
      }

      const reasonCode = classification.label === 'SOCIAL'
        ? 'SOCIAL_OR_NON_BUSINESS_INTENT'
        : 'CLASSIFICATION_UNCERTAIN';

      return {
        eligible: false,
        decision: 'SUPPRESSED',
        reasonCode,
        policy: AI_ACTIVATION_MODES.BUSINESS_INTENT_ONLY,
        matchedTriggers: [],
        classifierLabel: classification.label,
        timestamp,
      };
    }

    default: {
      return {
        eligible: false,
        decision: 'SUPPRESSED',
        reasonCode: 'POLICY_MANUAL_ONLY_DEFAULT',
        policy: AI_ACTIVATION_MODES.MANUAL_ONLY,
        matchedTriggers: [],
        classifierLabel: null,
        timestamp,
      };
    }
  }
}

