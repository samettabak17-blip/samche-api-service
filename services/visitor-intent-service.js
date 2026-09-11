import {
  buildTenantRuntimeSystemInstruction,
} from './tenant-runtime-persona-service.js';
import {
  buildContextualIntelligencePromptSection,
  isDiscreteEntity,
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
  'property',
  'property_detail',
  'hotel',
  'hotel_detail',
  'course',
  'course_detail',
  'offer',
]);

const HIGH_INTENT_PATH_PATTERN = /(?:(?:\/|^|#)(?:ur(?:un|unler)|products?|items?|services?|hizmet(?:ler)?|projects?|projeler|properties?|emlak|pricing|fiyat(?:lar)?|paket(?:ler)?|packages?|bookings?|randevu|rezervasyon|contacts?|iletisim|teklif|quotes?|hotels?|courses?|offers?)(?:\/|$|#|\?|-|_)|(?:\/|^|#)demo(?:\/|$|#|\?))/i;

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
    || rawType === 'quote'
    || isDiscreteEntity(currentEntity);

  if (isHighIntentPage) {
    score += 30;
    signals.push('COMMERCIAL_INTENT_PAGE');
  }

  // 3. Meaningful Dwell Time
  // Must be measured strictly on a qualified discrete entity!
  // Catalog, home, and non-discrete page dwell MUST NOT contribute.
  const isDiscrete = isDiscreteEntity(currentEntity);
  const effectiveDwell = isDiscrete ? dwellSeconds : 0;

  if (effectiveDwell >= config.deep_dwell_threshold_seconds) {
    score += 35;
    signals.push('DEEP_DWELL_TIME');
  } else if (effectiveDwell >= config.dwell_time_threshold_seconds) {
    score += 25;
    signals.push('QUALIFIED_DWELL_TIME');
  } else if (effectiveDwell >= 5) {
    score += 10;
    signals.push('MINIMAL_DWELL_TIME');
  }

  // 4. Multi-Entity Browsing (Exploration / Comparison)
  const validPrev = Array.isArray(previousEntities)
    ? previousEntities.filter((item) => isDiscreteEntity(item))
    : [];
  const currentIsDiscrete = isDiscreteEntity(currentEntity);
  const prevCount = currentIsDiscrete ? validPrev.length : 0;

  if (prevCount >= 2) {
    score += 30;
    signals.push('MULTI_ENTITY_EXPLORATION_DEEP');
  } else if (prevCount === 1) {
    score += 20;
    signals.push('MULTI_ENTITY_EXPLORATION');
  }

  // 5. Revisit to the same entity
  const isRevisit = revisitCount > 0
    || (currentIsDiscrete && validPrev.some(
      (prev) => prev.entity_id === currentEntity.entity_id || prev.canonical_url === currentEntity.canonical_url
    ));

  if (isRevisit) {
    score += 25;
    signals.push('ENTITY_REVISIT');
  }

  // 6. Same-Category Comparison
  if (currentIsDiscrete && validPrev.length > 0) {
    const lastPrev = validPrev[0];
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
  currentEntityFirstSeenAt = null,
}) {
  const config = resolveTenantProactiveConfig(tenantConfig);

  // Calculate qualified discrete entity dwell:
  // QUALIFIED_DWELL must be measured from the CURRENT DISCRETE ENTITY becoming active.
  // Catalog/home/category dwell MUST NOT contribute.
  const isDiscrete = isDiscreteEntity(currentEntity);
  const rawDwell = Number(sessionBrowsing.dwellSeconds || sessionBrowsing.dwell_seconds || 0);
  const qualifiedDwellSeconds = isDiscrete ? Math.max(0, rawDwell) : 0;

  const entityFirstSeen = currentEntityFirstSeenAt
    || engagementState.entityFirstSeenAt
    || pageContext?.first_seen_at
    || null;

  const timing = {
    entity_first_seen_at: entityFirstSeen,
    server_timestamp: new Date().toISOString(),
    qualified_dwell_seconds: qualifiedDwellSeconds,
    dwell_threshold_seconds: config.dwell_time_threshold_seconds,
    is_qualified_dwell: qualifiedDwellSeconds >= config.dwell_time_threshold_seconds,
  };

  // 1. Tenant enable/disable switch
  if (!config.enabled) {
    return {
      score: 0,
      intentState: INTENT_STATES.LOW,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      shouldNudge: false,
      reason: 'PROACTIVE_DISABLED_BY_TENANT',
      signals: [],
      timing,
    };
  }

  // 2. Compute intent score with qualified discrete dwell
  const { score, intentState, signals } = computeVisitorIntentScore({
    pageContext,
    currentEntity,
    previousEntities,
    sessionBrowsing: {
      ...sessionBrowsing,
      dwellSeconds: qualifiedDwellSeconds,
    },
    config,
  });

  // 3. Human Handoff Safety: Suppress if human support/takeover is active
  if (engagementState.humanHandoffActive) {
    return {
      score,
      intentState,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      shouldNudge: false,
      reason: 'HUMAN_TAKEOVER_ACTIVE',
      signals,
      timing,
    };
  }

  // 4. Resolve current entity identity for entity-scoped policy
  const currentEntityId = currentEntity?.entity_id
    || currentEntity?.id
    || currentEntity?.canonical_url
    || currentEntity?.entity_name
    || pageContext?.entity_id
    || pageContext?.path
    || null;

  // Discrete entity qualification check: non-discrete pages (catalog, home, about, etc.)
  // must never trigger proactive auto-open
  if (!isDiscrete) {
    let nonDiscreteReason = 'BELOW_INTENT_THRESHOLD';
    if (intentState === INTENT_STATES.MEDIUM) nonDiscreteReason = 'MEDIUM_INTENT_NUDGE';
    return {
      score,
      intentState: INTENT_STATES.LOW,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      shouldNudge: false,
      reason: nonDiscreteReason,
      signals,
      timing,
    };
  }

  // 5. Entity-Scoped Frequency Capping:
  // Suppress if proactive message was already sent for THIS entity in the conversation
  const acknowledgedList = Array.isArray(engagementState.acknowledgedEntityIds)
    ? engagementState.acknowledgedEntityIds.map(String)
    : (engagementState.proactiveEntityId ? [String(engagementState.proactiveEntityId)] : []);

  const isCurrentEntityAcknowledged = currentEntityId && acknowledgedList.includes(String(currentEntityId));
  if (isCurrentEntityAcknowledged) {
    return {
      score,
      intentState,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      shouldNudge: false,
      reason: 'ALREADY_ENGAGED',
      signals,
      timing,
    };
  }

  // Fallback for legacy test contexts without entity list where proactiveMessageSent is explicitly set
  if (!Array.isArray(engagementState.acknowledgedEntityIds) && !engagementState.proactiveEntityId && engagementState.proactiveMessageSent) {
    return {
      score,
      intentState,
      shouldProactivelyEngage: false,
      shouldAutoOpen: false,
      shouldNudge: false,
      reason: 'ALREADY_ENGAGED',
      signals,
      timing,
    };
  }

  // 6. Dismissal Cooldown: Suppress if user explicitly closed the chat recently ON THIS ENTITY
  if (engagementState.dismissedAt) {
    const dismissedTime = new Date(engagementState.dismissedAt).getTime();
    const cooldownMs = config.dismissal_cooldown_seconds * 1000;
    const isWithinCooldown = (Date.now() - dismissedTime) < cooldownMs;
    const dismissedEntityId = engagementState.dismissedEntityId ? String(engagementState.dismissedEntityId) : null;
    const appliesToEntity = !dismissedEntityId || (currentEntityId && dismissedEntityId === String(currentEntityId));

    if (isWithinCooldown && appliesToEntity) {
      return {
        score,
        intentState,
        shouldProactivelyEngage: false,
        shouldAutoOpen: false,
        shouldNudge: false,
        reason: 'DISMISSAL_COOLDOWN',
        signals,
        timing,
      };
    }
  }

  // 7. Active Conversation Safety: If the user explicitly has an active conversation ongoing on this entity,
  // protect against proactive auto-open interruptions.
  if (engagementState.hasConversation || Number(engagementState.messageCount || 0) > 0) {
    const convEntityId = engagementState.conversationEntityId ? String(engagementState.conversationEntityId) : null;
    const isNewEntityTransition = Boolean(convEntityId && currentEntityId && convEntityId !== String(currentEntityId));
    if (!isNewEntityTransition) {
      return {
        score,
        intentState,
        shouldProactivelyEngage: false,
        shouldAutoOpen: false,
        shouldNudge: false,
        reason: 'ACTIVE_CONVERSATION',
        signals,
        timing,
      };
    }
  }

  // 7. Threshold and Qualified Dwell Check
  const isHigh = intentState === INTENT_STATES.HIGH;
  const isMedium = intentState === INTENT_STATES.MEDIUM;
  const isQualifiedDwell = timing.is_qualified_dwell;

  const shouldProactivelyEngage = isHigh && isQualifiedDwell;
  const shouldAutoOpen = shouldProactivelyEngage && config.auto_open;
  const shouldNudge = isMedium || (isHigh && !isQualifiedDwell);

  let reason = 'BELOW_INTENT_THRESHOLD';
  if (shouldProactivelyEngage) {
    reason = 'HIGH_INTENT_ACTIVATION';
  } else if (isHigh && !isQualifiedDwell) {
    reason = 'AWAITING_QUALIFIED_DWELL';
  } else if (isMedium) {
    reason = 'MEDIUM_INTENT_NUDGE';
  }

  return {
    score,
    intentState,
    shouldProactivelyEngage,
    shouldAutoOpen,
    shouldNudge,
    reason,
    signals,
    timing,
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

/**
 * Generate a contextual opening assistant message for manual chat opening
 * on a discrete entity using active persona/LLM, or deterministic fallback.
 */
export async function generateContextualOpeningMessage({
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

  const deterministicFallback = () => {
    if (normLang === 'en') {
      if (entityName && prevName) {
        return `You are currently viewing ${entityName}. If you have questions about its details or how it compares with ${prevName}, feel free to ask.`;
      }
      if (entityName) {
        return `You are currently viewing ${entityName}. If you would like more details or have any questions, I'm here to help.`;
      }
      return `Hello! Feel free to ask any questions about what you're viewing or our offerings.`;
    }
    if (normLang === 'ar') {
      if (entityName && prevName) {
        return `أنت تتصفح حالياً تفاصيل ${entityName}. يسعدني مساعدتك في الإجابة عن أي استفسار أو مقارنتها مع ${prevName}.`;
      }
      if (entityName) {
        return `أنت تتصفح حالياً تفاصيل ${entityName}. يسعدني تقديم المساعدة والإجابة عن أي استفسارات تود معرفتها.`;
      }
      return `مرحباً! يسعدني تقديم المساعدة والإجابة عن أي استفسار.`;
    }
    // Default Turkish
    if (entityName && prevName) {
      return `Şu anda ${entityName} detaylarını inceliyorsunuz. Özellikleri veya daha önce baktığınız ${prevName} ile farkları hakkında yardımcı olabilir miyim?`;
    }
    if (entityName) {
      return `Şu anda ${entityName} detaylarını inceliyorsunuz. Merak ettiğiniz teknik özellikleri, detayları veya aklınıza takılan soruları yanıtlayabilirim.`;
    }
    return `Merhaba! İncelediğiniz konu hakkında merak ettiğiniz tüm soruları memnuniyetle yanıtlayabilirim.`;
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

      const contextualDirective = [
        `\n# CONTEXTUAL CHAT OPENING INSTRUCTION:`,
        `The visitor manually opened the chat widget while viewing ${entityName || 'the current item'} (${currentEntity?.entity_type || 'Entity'}).`,
        `Generate ONE friendly, professional, concise, qualified contextual opening message (1-2 sentences maximum).`,
        `Acknowledge that they are viewing ${entityName || 'this item'} and offer assistance or comparison with previously viewed items if applicable.`,
        `STRICT GUARDRAILS:`,
        `- DO NOT HALLUCINATE USER INTENT: Never say "I know you want to buy" or make assumptions about private intent.`,
        `- CONTEXTUAL RELEVANCE: Mention the current item (${entityName || 'current page'}) and, if previous items were viewed (${prevName || 'earlier items'}), offer comparison or guidance.`,
        `- FACTUAL GROUNDING: Rely strictly on approved business details. Do not invent unconfirmed claims.`,
        `- LANGUAGE: Respond strictly in ${normLang === 'en' ? 'English' : (normLang === 'ar' ? 'Arabic' : 'Turkish')}.`,
        `- LENGTH: Strictly 1 to 2 sentences.`,
      ].join('\n');

      const messages = [
        { role: 'system', content: systemInstruction + '\n' + contextualDirective },
        { role: 'user', content: `[CONTEXTUAL_OPEN_TRIGGER: Visitor manually opened chat while viewing ${entityName || 'entity'}. Generate contextual opening message.]` },
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
      console.warn('CONTEXTUAL_OPEN_OPENAI_FALLBACK:', err?.message || err);
    }
  }

  return deterministicFallback();
}

