import {
  buildTenantRuntimeSystemInstruction,
} from './tenant-runtime-persona-service.js';
import {
  buildContextualIntelligencePromptSection,
} from './contextual-intelligence-service.js';

/**
 * services/visitor-intent-service.js
 * Canonical Visitor Intent Evaluation & Proactive Engagement Engine
 *
 * Evaluates real-time session signals (page context, dwell time, repeat visits,
 * comparisons, entity depth) against tenant-scoped configuration to compute
 * intent states (LOW, MEDIUM, HIGH) and determine bounded proactive activation.
 */

export const INTENT_STATES = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

export const DEFAULT_PROACTIVE_CONFIG = Object.freeze({
  enabled: true,
  auto_open: true,
  intent_threshold: 70,
  medium_threshold: 40,
  dismissal_cooldown_seconds: 300, // 5 minutes
  dwell_time_threshold_seconds: 15, // seconds
  deep_dwell_threshold_seconds: 30, // seconds
});

const HIGH_INTENT_PAGE_TYPES = new Set([
  'product_detail',
  'product',
  'project',
  'service',
  'package',
  'pricing',
  'booking',
  'contact',
  'quote',
  'quotation',
  'reservation',
  'demo',
  'checkout',
  'tier',
]);

const HIGH_INTENT_PATH_PATTERN = /(?:urun|product|item|service|hizmet|project|proje|pricing|fiyat|paket|package|booking|randevu|rezervasyon|contact|iletisim|teklif|quote|demo)/i;

const HIGH_INTENT_ENTITY_TYPES = new Set([
  'PRODUCT',
  'SERVICE',
  'PROJECT',
  'PACKAGE',
  'OFFER',
  'COURSE',
  'HOTEL',
  'VEHICLE',
  'PROPERTY',
  'PLAN',
]);

/**
 * Resolve proactive engagement configuration from tenant assistant configuration data,
 * falling back safely to canonical platform defaults.
 */
export function resolveTenantProactiveConfig(assistantConfiguration = null) {
  const custom = assistantConfiguration?.proactive_engagement || assistantConfiguration?.proactiveEngagement || {};
  return {
    enabled: custom.enabled !== undefined ? Boolean(custom.enabled) : DEFAULT_PROACTIVE_CONFIG.enabled,
    auto_open: custom.auto_open !== undefined ? Boolean(custom.auto_open) : (custom.autoOpen !== undefined ? Boolean(custom.autoOpen) : DEFAULT_PROACTIVE_CONFIG.auto_open),
    intent_threshold: Number.isFinite(custom.intent_threshold) ? custom.intent_threshold : (Number.isFinite(custom.intentThreshold) ? custom.intentThreshold : DEFAULT_PROACTIVE_CONFIG.intent_threshold),
    medium_threshold: Number.isFinite(custom.medium_threshold) ? custom.medium_threshold : (Number.isFinite(custom.mediumThreshold) ? custom.mediumThreshold : DEFAULT_PROACTIVE_CONFIG.medium_threshold),
    dismissal_cooldown_seconds: Number.isFinite(custom.dismissal_cooldown_seconds) ? custom.dismissal_cooldown_seconds : (Number.isFinite(custom.dismissalCooldownSeconds) ? custom.dismissalCooldownSeconds : DEFAULT_PROACTIVE_CONFIG.dismissal_cooldown_seconds),
    dwell_time_threshold_seconds: Number.isFinite(custom.dwell_time_threshold_seconds) ? custom.dwell_time_threshold_seconds : DEFAULT_PROACTIVE_CONFIG.dwell_time_threshold_seconds,
    deep_dwell_threshold_seconds: Number.isFinite(custom.deep_dwell_threshold_seconds) ? custom.deep_dwell_threshold_seconds : DEFAULT_PROACTIVE_CONFIG.deep_dwell_threshold_seconds,
  };
}
/**
 * Compute visitor intent score (0-100) and identify behavioral signals.
 */
export function computeVisitorIntentScore({
  pageContext = null,
  currentEntity = null,
  previousEntities = [],
  sessionBrowsing = {},
  config = DEFAULT_PROACTIVE_CONFIG,
}) {
  let score = 0;
  const signals = [];

  const rawPath = pageContext?.path || pageContext?.url || '';
  const rawType = (pageContext?.page_type || pageContext?.entity_type || '').toLowerCase();
  const entityType = (currentEntity?.entity_type || '').toUpperCase();
  const dwellSeconds = Number(sessionBrowsing.dwellSeconds || sessionBrowsing.dwell_seconds || 0);
  const revisitCount = Number(sessionBrowsing.revisitCount || sessionBrowsing.revisit_count || 0);
  const explicitActions = Array.isArray(sessionBrowsing.signals || sessionBrowsing.explicitActions)
    ? (sessionBrowsing.signals || sessionBrowsing.explicitActions)
    : [];

  // 1. Entity Detail Evaluation Signal
  const isEntityDetail = HIGH_INTENT_PAGE_TYPES.has(rawType)
    || HIGH_INTENT_ENTITY_TYPES.has(entityType)
    || (currentEntity && Object.keys(currentEntity.attributes || {}).length > 0);

  if (isEntityDetail) {
    score += 25;
    signals.push('ENTITY_DETAIL_VIEW');
  }

  // 2. High-Intent Commercial / Conversion / Pricing Page
  const isHighIntentPage = HIGH_INTENT_PATH_PATTERN.test(rawPath)
    || rawType === 'pricing'
    || rawType === 'booking'
    || rawType === 'contact'
    || rawType === 'quote';

  if (isHighIntentPage) {
    score += 30;
    signals.push('COMMERCIAL_INTENT_PAGE');
  }

  // 3. Meaningful Dwell Time
  if (dwellSeconds >= config.deep_dwell_threshold_seconds) {
    score += 35;
    signals.push('DEEP_DWELL_TIME');
  } else if (dwellSeconds >= config.dwell_time_threshold_seconds) {
    score += 25;
    signals.push('QUALIFIED_DWELL_TIME');
  } else if (dwellSeconds >= 5) {
    score += 10;
    signals.push('MINIMAL_DWELL_TIME');
  }

  // 4. Multi-Entity Browsing (Exploration / Comparison)
  const prevCount = Array.isArray(previousEntities) ? previousEntities.length : 0;
  if (prevCount >= 2) {
    score += 30;
    signals.push('MULTI_ENTITY_EXPLORATION_DEEP');
  } else if (prevCount === 1) {
    score += 20;
    signals.push('MULTI_ENTITY_EXPLORATION');
  }

  // 5. Revisit to the same entity
  const isRevisit = revisitCount > 0
    || (currentEntity && Array.isArray(previousEntities) && previousEntities.some(
      (prev) => prev.entity_id === currentEntity.entity_id || prev.canonical_url === currentEntity.canonical_url
    ));

  if (isRevisit) {
    score += 25;
    signals.push('ENTITY_REVISIT');
  }

  // 6. Same-Category Comparison
  if (currentEntity && Array.isArray(previousEntities) && previousEntities.length > 0) {
    const lastPrev = previousEntities[0];
    const sameCategory = lastPrev.attributes?.category && currentEntity.attributes?.category &&
      String(lastPrev.attributes.category).toLowerCase() === String(currentEntity.attributes.category).toLowerCase();
    const sameType = lastPrev.entity_type && currentEntity.entity_type &&
      lastPrev.entity_type === currentEntity.entity_type &&
      lastPrev.entity_id !== currentEntity.entity_id;

    if (sameCategory || sameType) {
      score += 20;
      signals.push('CATEGORY_COMPARISON');
    }
  }

  // 7. Explicit Evaluation Actions
  if (explicitActions.length > 0) {
    score += 20;
    signals.push('EXPLICIT_EVALUATION_ACTION');
  }

  const boundedScore = Math.min(100, Math.max(0, score));

  let intentState = INTENT_STATES.LOW;
  if (boundedScore >= config.intent_threshold) {
    intentState = INTENT_STATES.HIGH;
  } else if (boundedScore >= config.medium_threshold) {
    intentState = INTENT_STATES.MEDIUM;
  }

  return {
    score: boundedScore,
    intentState,
    signals,
  };
}

/**
 * Primary decision engine for visitor intent and proactive engagement.
 * Strictly respects frequency capping, human handoff, active conversation safety,
 * and dismissal cooldown.
 */
export function evaluateVisitorIntent({
  pageContext = null,
  currentEntity = null,
  previousEntities = [],
  sessionBrowsing = {},
  tenantConfig = null,
  engagementState = {},
}) {
  const config = resolveTenantProactiveConfig(tenantConfig);

  // 1. Tenant enable/disable switch
  if (!config.enabled) {
    return {
      score: 0,
      intentState: INTENT_STATES.LOW,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      reason: 'PROACTIVE_DISABLED_BY_TENANT',
      signals: [],
    };
  }

  // 2. Compute intent score
  const { score, intentState, signals } = computeVisitorIntentScore({
    pageContext,
    currentEntity,
    previousEntities,
    sessionBrowsing,
    config,
  });

  // 3. Existing Conversation Safety: Suppress if visitor already chatted in this session
  if (engagementState.hasConversation || Number(engagementState.messageCount || 0) > 0) {
    return {
      score,
      intentState,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      reason: 'ACTIVE_CONVERSATION',
      signals,
    };
  }

  // 4. Human Handoff Safety: Suppress if human support/takeover is active
  if (engagementState.humanHandoffActive) {
    return {
      score,
      intentState,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      reason: 'HUMAN_TAKEOVER_ACTIVE',
      signals,
    };
  }

  // 5. Frequency Capping: Suppress if proactive message was already sent in this session
  if (engagementState.proactiveMessageSent || engagementState.proactiveEngagedAt) {
    return {
      score,
      intentState,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      reason: 'ALREADY_ENGAGED',
      signals,
    };
  }

  // 6. Dismissal Cooldown: Suppress if user explicitly closed the chat recently
  if (engagementState.dismissedAt) {
    const dismissedTime = new Date(engagementState.dismissedAt).getTime();
    const cooldownMs = config.dismissal_cooldown_seconds * 1000;
    if (Date.now() - dismissedTime < cooldownMs) {
      return {
        score,
        intentState,
        shouldProactivelyEngage: false,
        shouldAutoOpen: false,
        reason: 'DISMISSAL_COOLDOWN',
        signals,
      };
    }
  }

  // 7. Threshold Check
  const isHigh = intentState === INTENT_STATES.HIGH;
  const isMedium = intentState === INTENT_STATES.MEDIUM;
  const shouldProactivelyEngage = isHigh || isMedium;
  const shouldAutoOpen = isHigh && config.auto_open;

  let reason = 'BELOW_INTENT_THRESHOLD';
  if (isHigh) {
    reason = 'HIGH_INTENT_ACTIVATION';
  } else if (isMedium) {
    reason = 'MEDIUM_INTENT_NUDGE';
  }

  return {
    score,
    intentState,
    shouldProactivelyEngage,
    shouldAutoOpen,
    reason,
    signals,
  };
}

/**
 * Generate a contextual proactive assistant message using the active persona
 * and OpenAI runtime, or fall back to an appropriately qualified deterministic message.
 */
export async function generateContextualProactiveMessage({
  persona = null,
  currentEntity = null,
  previousEntities = [],
  channelRules = '',
  openaiClient = null,
  language = 'tr',
}) {
  const normLang = (language || persona?.profile?.language || 'tr').toLowerCase().slice(0, 2);
  const contextualSection = buildContextualIntelligencePromptSection({
    currentEntity,
    previousEntities,
    channelType: 'WEB_CHAT',
  });

  const entityName = currentEntity?.entity_name || null;
  const prevName = (Array.isArray(previousEntities) && previousEntities.length > 0)
    ? previousEntities[0].entity_name
    : null;

  // Fallback grounded templates for each language
  const deterministicFallback = () => {
    if (normLang === 'en') {
      if (entityName && prevName) {
        return `It looks like you might be comparing ${entityName} with ${prevName}. Would you like a quick overview of how they differ, or any specific details?`;
      }
      if (entityName) {
        return `Hello! If you have any questions about ${entityName} or would like more details, I'm here to help.`;
      }
      return `Hello! If you have any questions while exploring our offerings, feel free to ask.`;
    }
    if (normLang === 'ar') {
      if (entityName && prevName) {
        return `يبدو أنك تقارن بين ${entityName} و ${prevName}. هل ترغب في معرفة الفروق والمواصفات الأساسية لمساعدتك في الاختيار؟`;
      }
      if (entityName) {
        return `مرحباً! إذا كان لديك أي استفسار حول ${entityName} أو ترغب في معرفة المزيد من التفاصيل، يسعدني تقديم المساعدة.`;
      }
      return `مرحباً! يسعدني مساعدتك والإجابة عن أي استفسار أثناء تصفحك لخدماتنا.`;
    }
    // Default Turkish
    if (entityName && prevName) {
      return `Görünüşe göre ${entityName} ile daha önce incelediğiniz ${prevName} arasında bir değerlendirme yapıyorsunuz. İki model arasındaki temel farkları veya özellikleri karşılaştırmanızda yardımcı olabilir miyim?`;
    }
    if (entityName) {
      return `Merhaba! ${entityName} hakkında merak ettiğiniz teknik özellikleri veya kullanım detaylarını memnuniyetle yanıtlayabilirim. Aklınıza takılan bir konu var mı?`;
    }
    return `Merhaba! Sitemizdeki çözümleri incelerken aklınıza takılan sorular olursa yardımcı olmaktan memnuniyet duyarım.`;
  };

  // If OpenAI client is available and configured, call assistant model
  if (openaiClient && typeof openaiClient.chat?.completions?.create === 'function' && process.env.OPENAI_API_KEY) {
    try {
      const systemInstruction = persona?.available
        ? buildTenantRuntimeSystemInstruction({
            persona,
            channelRules: channelRules || 'Return a short, natural, friendly greeting suitable for Web Chat. No HTML wrapping required.',
            contextualIntelligence: contextualSection,
          })
        : [
            'You are an AI assistant for this business website.',
            contextualSection,
          ].join('\n\n');

      const proactiveDirective = [
        `\n# PROACTIVE VISITOR ENGAGEMENT INSTRUCTION:`,
        `The visitor is actively browsing and has demonstrated high evaluation intent, but has not initiated a chat.`,
        `Generate ONE friendly, professional, concise, qualified proactive message (1-2 sentences maximum).`,
        `STRICT GUARDRAILS:`,
        `- DO NOT HALLUCINATE USER INTENT: Never say "I know you want to buy" or make assumptions about private intent. Use qualified observation ("It looks like you're exploring...", "Görünüşe göre ... modellerini inceliyorsunuz").`,
        `- CONTEXTUAL RELEVANCE: Mention the current item (${entityName || 'current page'}) and, if previous items were viewed, offer to compare details.`,
        `- FACTUAL GROUNDING: Rely strictly on approved business details. Do not invent unconfirmed claims.`,
        `- LANGUAGE: Respond strictly in ${normLang === 'en' ? 'English' : (normLang === 'ar' ? 'Arabic' : 'Turkish')}.`,
        `- LENGTH: Strictly 1 to 2 sentences.`,
      ].join('\n');

      const messages = [
        { role: 'system', content: systemInstruction + '\n' + proactiveDirective },
        { role: 'user', content: `[HIGH_INTENT_TRIGGER: Visitor is on ${entityName || 'page'}. Generate proactive greeting.]` },
      ];

      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 120,
        temperature: 0.6,
      });

      const reply = completion.choices?.[0]?.message?.content?.trim();
      if (reply && reply.length > 10) {
        return reply;
      }
    } catch (err) {
      console.warn('PROACTIVE_MESSAGE_GENERATION_FALLBACK code=' + (err?.code ?? err?.name ?? 'ERROR'));
    }
  }

  return deterministicFallback();
}

