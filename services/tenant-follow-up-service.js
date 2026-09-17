function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function enabled(value) {
  return value === true;
}

export const OPT_OUT_PATTERNS = Object.freeze([
  /\b(?:stop|unsubscribe|opt[\s-]?out|cancel|iptal|vazgec|vazgeç|dur|istemiyorum)\b/i,
  /(?:^|[\s\p{P}])(?:توقف|إلغاء|الغاء)(?:$|[\s\p{P}])/u,
  /\b(?:lütfen\s+)?(?:artık\s+)?(?:yazma(?:yın)?|mesaj\s+atma(?:yın)?)\b/i,
  /\b(?:please\s+)?(?:stop\s+messaging\s+me|unsubscribe\s+me|opt\s*me\s*out|do\s+not\s+contact\s+me)\b/i,
]);

export function isCustomerOptOut(text) {
  const clean = String(text ?? '').trim();
  if (!clean) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(clean));
}

const SUPPORT_COMPLAINT_PATTERN = /(?:not\s+working|defective|malfunction|broken|faulty|won['’]?t\s+work|çalışmıyor|calismiyor|bozuk|arızalı|arizali|şikayet|sikayet|problem|issue|complaint|unhappy|disappointed|refund|return|iade|tamir|destek|لا\s+يعمل|معطل|عطل|شكوى|استرجاع)/i;
const PRODUCT_COMPARISON_PATTERN = /(?:compare|comparison|differ(?:ence|ences)|difference\s+between|decid(?:e|ing)\s+between|versus|\bvs\b|which\s+(?:one|option|product|service|package)|karşılaştır|karsilastir|fark(?:ı|lar)?|farki\s+ne|hangisi\s+daha\s+iyi|iki\s+seçenek|karar\s+ver|مقارنة|الفرق\s+بين|أيهما\s+أفضل)/i;
const SALES_INQUIRY_PATTERN = /(?:how\s+much|price|pricing|cost|quote|package|services?|buy|purchase|hire|book|booking|conference|corporate\s+event|proposal|ne\s+kadar|fiyat|ücret|ucret|maliyet|paket|hizmet|satın\s+al|satin\s+al|teklif|etkinlik|rezervasyon|كم|سعر|أسعار|تكلفة|عرض\s+سعر|باقات|خدمات|حجز|فعالية)/i;

export function classifyFollowUpContextIntent(conversationContext = '') {
  const contextStr = String(conversationContext ?? '');
  if (SUPPORT_COMPLAINT_PATTERN.test(contextStr)) {
    return 'UNRESOLVED_SUPPORT_OR_COMPLAINT';
  }
  if (PRODUCT_COMPARISON_PATTERN.test(contextStr)) {
    return 'PRODUCT_OR_SERVICE_COMPARISON';
  }
  if (SALES_INQUIRY_PATTERN.test(contextStr)) {
    return 'SALES_INQUIRY';
  }
  return 'GENERAL';
}

export const SEMANTIC_TIME_BUCKETS = Object.freeze({
  SHORT_TIME: 'short_time',
  EARLIER_TODAY: 'earlier_today',
  YESTERDAY: 'yesterday',
  FEW_DAYS_AGO: 'few_days_ago',
  RECENTLY: 'recently',
  SOME_TIME_AGO: 'some_time_ago',
});

export const ELAPSED_TIME_SIGNALS = Object.freeze({
  short_time: {
    bucket: 'short_time',
    label: 'a short time ago',
    cues: {
      en: 'a short time ago',
      tr: 'kısa süre önce',
      ar: 'منذ وقت قصير',
    },
    instruction: 'Refer naturally to speaking "a short time ago" (e.g. "We spoke a short while ago about..."). CRITICAL: DO NOT claim or imply "yesterday", "earlier this week", or "last week".',
  },
  earlier_today: {
    bucket: 'earlier_today',
    label: 'earlier today',
    cues: {
      en: 'earlier today',
      tr: 'bugün daha önce',
      ar: 'اليوم في وقت سابق',
    },
    instruction: 'Refer naturally to speaking "earlier today" (e.g. "We spoke earlier today about..."). DO NOT claim "yesterday".',
  },
  yesterday: {
    bucket: 'yesterday',
    label: 'yesterday',
    cues: {
      en: 'yesterday',
      tr: 'dün',
      ar: 'أمس',
    },
    instruction: 'Refer naturally to speaking "yesterday" (e.g. "We spoke yesterday about...").',
  },
  few_days_ago: {
    bucket: 'few_days_ago',
    label: 'a few days ago',
    cues: {
      en: 'a few days ago',
      tr: 'birkaç gün önce',
      ar: 'منذ بضعة أيام',
    },
    instruction: 'Refer naturally to speaking "a few days ago" (e.g. "We spoke a few days ago about...").',
  },
  recently: {
    bucket: 'recently',
    label: 'recently',
    cues: {
      en: 'recently',
      tr: 'yakın zamanda',
      ar: 'مؤخراً',
    },
    instruction: 'Refer naturally to speaking "recently" (e.g. "We spoke recently about...").',
  },
  some_time_ago: {
    bucket: 'some_time_ago',
    label: 'some time ago',
    cues: {
      en: 'some time ago',
      tr: 'bir süre önce',
      ar: 'منذ فترة',
    },
    instruction: 'Refer naturally to speaking "some time ago" (e.g. "We spoke some time ago about...").',
  },
});

export function calculateElapsedSemanticBucket({
  lastMeaningfulMessageAt,
  now = new Date(),
  timezone = 'UTC',
} = {}) {
  const lastTime = lastMeaningfulMessageAt ? new Date(lastMeaningfulMessageAt).getTime() : 0;
  const currentTime = new Date(now).getTime();

  if (!lastTime || Number.isNaN(lastTime) || currentTime < lastTime) {
    return {
      bucket: 'short_time',
      label: 'a short time ago',
      elapsedHours: 0,
      calendarDaysDiff: 0,
      timezone: 'UTC',
    };
  }

  const elapsedMs = currentTime - lastTime;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  let isSameDay = false;
  let isYesterday = false;
  let calendarDaysDiff = 0;

  try {
    const tz = timezone || 'UTC';
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const nowDateStr = formatter.format(new Date(currentTime));
    const lastDateStr = formatter.format(new Date(lastTime));

    if (nowDateStr === lastDateStr) {
      isSameDay = true;
      calendarDaysDiff = 0;
    } else {
      const nowEpochDay = Math.round(new Date(`${nowDateStr}T00:00:00Z`).getTime() / (1000 * 60 * 60 * 24));
      const lastEpochDay = Math.round(new Date(`${lastDateStr}T00:00:00Z`).getTime() / (1000 * 60 * 60 * 24));
      calendarDaysDiff = Math.max(0, nowEpochDay - lastEpochDay);
      if (calendarDaysDiff === 1) {
        isYesterday = true;
      }
    }
  } catch {
    if (elapsedHours < 24) isSameDay = true;
    else if (elapsedHours < 48) isYesterday = true;
    calendarDaysDiff = Math.floor(elapsedHours / 24);
  }

  let bucket = 'short_time';
  let label = 'a short time ago';

  if (elapsedHours < 4) {
    bucket = 'short_time';
    label = 'a short time ago';
  } else if (isSameDay) {
    bucket = 'earlier_today';
    label = 'earlier today';
  } else if (isYesterday || (calendarDaysDiff === 1 && elapsedHours < 48)) {
    bucket = 'yesterday';
    label = 'yesterday';
  } else if (calendarDaysDiff >= 2 && calendarDaysDiff <= 4) {
    bucket = 'few_days_ago';
    label = 'a few days ago';
  } else if (calendarDaysDiff > 4 && calendarDaysDiff <= 7) {
    bucket = 'recently';
    label = 'recently';
  } else {
    bucket = 'some_time_ago';
    label = 'some time ago';
  }

  return {
    bucket,
    label,
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    calendarDaysDiff,
    timezone: timezone || 'UTC',
  };
}

export function evaluateWhatsAppFollowUpSendGate({
  lastCustomerMessageAt,
  stage,
  templates = null,
  now = new Date(),
} = {}) {
  const lastTime = lastCustomerMessageAt ? new Date(lastCustomerMessageAt).getTime() : 0;
  const currentTime = new Date(now).getTime();
  const elapsedMs = Math.max(0, currentTime - lastTime);
  const isWithinSessionWindow = lastTime > 0 && elapsedMs <= 24 * 60 * 60 * 1000;

  if (isWithinSessionWindow) {
    return { allowed: true, mode: 'SESSION_MESSAGE' };
  }

  // Outside 24-hour customer service window: freeform session messages are forbidden by Meta.
  // Requires an approved message template explicitly configured for this stage.
  // Never assume an unapproved template is valid or exists.
  const approvedTemplate = templates?.follow_up_approved_templates?.[stage]
    || templates?.[`follow_up_${stage}`];

  if (approvedTemplate && approvedTemplate.status === 'APPROVED') {
    return {
      allowed: true,
      mode: 'TEMPLATE_MESSAGE',
      templateName: approvedTemplate.name,
    };
  }

  return {
    allowed: false,
    code: 'WHATSAPP_SESSION_WINDOW_EXPIRED_NO_APPROVED_TEMPLATE',
    mode: 'REJECTED',
  };
}

export function resolveTenantFollowUpPolicy({ persona, stage, scheduled = false }) {
  if (!persona?.available) return { enabled: false, code: 'TENANT_PERSONA_NOT_ACTIVE' };
  const key = scheduled ? 'scheduled_messaging_behavior' : 'follow_up_behavior';
  const policy = object(persona.configuration?.[key]);
  if (!policy || !enabled(policy.enabled)) return { enabled: false, code: 'FOLLOW_UP_NOT_CONFIGURED' };
  if (!scheduled && Array.isArray(policy.timing_strategy) && !policy.timing_strategy.includes(stage)) {
    return { enabled: false, code: 'FOLLOW_UP_STAGE_NOT_ALLOWED' };
  }
  return { enabled: true, kind: scheduled ? 'scheduled' : 'follow_up', stage, policy };
}

export function analyzeConversationContext(messages = null, conversationContext = '') {
  let rawText = '';
  const turns = [];

  if (Array.isArray(messages) && messages.length > 0) {
    for (const m of messages) {
      const role = m.sender_type === 'CUSTOMER' ? 'customer' : 'assistant';
      const content = String(m.content ?? '').trim();
      if (content) {
        turns.push({
          role,
          content,
          createdAt: m.created_at || null,
        });
      }
    }
    rawText = turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n');
  } else if (typeof conversationContext === 'string') {
    rawText = conversationContext;
    const lines = conversationContext.split('\n');
    for (const line of lines) {
      const match = line.match(/^(CUSTOMER|ASSISTANT):\s*(.*)$/i);
      if (match) {
        turns.push({
          role: match[1].toLowerCase(),
          content: match[2].trim(),
          createdAt: null,
        });
      }
    }
  }

  const customerTurns = turns.filter((t) => t.role === 'customer');
  const assistantTurns = turns.filter((t) => t.role === 'assistant');
  const lastCustomerTurn = customerTurns[customerTurns.length - 1] || null;
  const lastAssistantTurn = assistantTurns[assistantTurns.length - 1] || null;

  const intent = classifyFollowUpContextIntent(rawText);

  const greetingFiltered = customerTurns
    .map((t) => t.content)
    .join(' ')
    .replace(/\b(?:hi|hello|hey|merhaba|selam|selamlar|hola|bonjour|good\s+morning|good\s+afternoon|good\s+evening|test)\b/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

  const topicConfidence = greetingFiltered.length >= 8 ? 'HIGH' : 'LOW';

  return {
    rawText,
    turns,
    customerTurns,
    assistantTurns,
    lastCustomerTurn,
    lastAssistantTurn,
    intent,
    topicConfidence,
  };
}

export function normalizeGeneratedFollowUpText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^(?:(?:assistant|ai|bot|advisor|agent):\s*)/i, '').trim();
  return text;
}


export function buildTenantFollowUpRequest({
  persona,
  stage,
  language = 'en',
  conversationContext = '',
  messages = null,
  lastCustomerMessageAt = null,
  now = new Date(),
  timezone = null,
  humanHandling = false,
  optOut = false,
  scheduled = false,
}) {
  if (humanHandling) return { available: false, code: 'HUMAN_HANDLING' };
  if (optOut) return { available: false, code: 'CUSTOMER_OPT_OUT' };

  // Detect opt-out directly in conversation context if latest customer message opted out
  const customerLines = String(conversationContext)
    .split('\n')
    .filter((line) => line.startsWith('CUSTOMER:'));
  const lastCustomerLine = customerLines[customerLines.length - 1];
  if (lastCustomerLine && isCustomerOptOut(lastCustomerLine.replace(/^CUSTOMER:\s*/i, ''))) {
    return { available: false, code: 'CUSTOMER_OPT_OUT' };
  }

  const resolved = resolveTenantFollowUpPolicy({ persona, stage, scheduled });
  if (!resolved.enabled) return { available: false, code: resolved.code };

  const analysis = analyzeConversationContext(messages, conversationContext);
  const contextIntent = analysis.intent;

  const effectiveTimezone = timezone
    || persona.profile?.timezone
    || persona.configuration?.timezone
    || 'UTC';

  const effectiveLastMessageAt = lastCustomerMessageAt
    || analysis.lastCustomerTurn?.createdAt
    || (Array.isArray(messages) && messages[messages.length - 1]?.created_at)
    || null;

  const timeBucket = calculateElapsedSemanticBucket({
    lastMeaningfulMessageAt: effectiveLastMessageAt,
    now,
    timezone: effectiveTimezone,
  });

  const timeSignal = ELAPSED_TIME_SIGNALS[timeBucket.bucket] || ELAPSED_TIME_SIGNALS.short_time;

  let contextDirective = '';
  if (contextIntent === 'UNRESOLVED_SUPPORT_OR_COMPLAINT') {
    contextDirective = [
      'Context classification: UNRESOLVED_SUPPORT_OR_COMPLAINT.',
      'MANDATORY COMPLIANCE: The customer has an unresolved issue, defect, or complaint.',
      'DO NOT push sales pitches, commercial offers, or aggressive follow-ups.',
      'Any follow-up must be exclusively supportive, empathetic, and aimed at resolving the issue.',
      'Ask whether the issue was resolved or if they are still experiencing the problem, and offer to continue assisting.',
    ].join(' ');
  } else if (contextIntent === 'PRODUCT_OR_SERVICE_COMPARISON') {
    contextDirective = [
      'Context classification: PRODUCT_OR_SERVICE_COMPARISON.',
      'The customer was comparing options, products, or services.',
      'Naturally ask if they have had a chance to decide which option suits them better, or offer to help compare the remaining differences.',
    ].join(' ');
  } else if (contextIntent === 'SALES_INQUIRY') {
    contextDirective = [
      'Context classification: SALES_INQUIRY.',
      'Follow up with helpful, consultative, and relevant assistance regarding requested services.',
      'Continue the customer\'s decision process naturally: ask if they have had a chance to review the options or decide how to proceed, and offer assistance with the next step.',
    ].join(' ');
  } else {
    contextDirective = [
      'Context classification: GENERAL.',
      'Follow up with helpful, consultative, and relevant assistance regarding their enquiry.',
    ].join(' ');
  }

  const topicGuidance = analysis.topicConfidence === 'LOW'
    ? 'TOPIC CONFIDENCE: LOW / BROAD. The conversation does not contain specific product names, event dates, or detailed proposals. Degrade gracefully to a broader check-in regarding their enquiry without hallucinating specific products, dates, prices, or promises.'
    : 'TOPIC CONFIDENCE: HIGH. MANDATORY: Continue the specific subject/entity discussed in the recent conversation turns. Naturally reference the actual subject rather than sending a generic reminder.';

  const promptParts = [
    `Generate one ${resolved.kind} message for ${persona.companyIdentity} as ${persona.assistantIdentity}.`,
    `Output language: ${language}.`,
    `ACTIVE tenant services/context: ${JSON.stringify(persona.profile?.services ?? [])}.`,
    `ACTIVE tenant tone: ${String(persona.configuration?.tone ?? '')}.`,
    `Approved ${resolved.kind} behavior: ${JSON.stringify(resolved.policy)}.`,
    `ELAPSED TIME FACTUAL SIGNAL:`,
    `- Bucket: "${timeBucket.bucket}" (${timeBucket.label}).`,
    `- Localized cue for language "${language}": "${timeSignal.cues[language] || timeSignal.cues.en}".`,
    `- Instruction: ${timeSignal.instruction}`,
    `TOPIC & CONVERSATION GUIDANCE:`,
    `- ${topicGuidance}`,
    `- ${contextDirective}`,
    `Recent conversation turns:`,
    analysis.rawText ? analysis.rawText.slice(0, 2000) : 'None available.',
    `CRITICAL ANTI-HALLUCINATION & IDENTITY GUARDRAILS:`,
    `- Do NOT invent products, services, prices, appointments, decisions, or promises not in this context.`,
    `- Never send generic filler phrases like "Just following up" or "Do you need any help?" when conversation context exists.`,
    `- Output ONLY the customer-facing message in ${language}.`,
  ];

  return promptParts.filter(Boolean).join('\n');
}

