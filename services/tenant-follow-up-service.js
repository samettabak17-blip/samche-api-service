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

const SUPPORT_COMPLAINT_PATTERN = /(?:not\s+working|defective|malfunction|broken|faulty|won['’]?t\s+work|çalışmıyor|calismiyor|bozuk|arızalı|arizali|şikayet|sikayet|problem|issue|complaint|unhappy|disappointed|refund|return|iade|لا\s+يعمل|معطل|عطل|شكوى)/i;
const SALES_INQUIRY_PATTERN = /(?:price|pricing|cost|quote|package|services?|buy|purchase|hire|fiyat|ücret|ucret|paket|hizmet|satın\s+al|satin\s+al|سعر|باقات|خدمات)/i;

export function classifyFollowUpContextIntent(conversationContext = '') {
  const contextStr = String(conversationContext ?? '');
  if (SUPPORT_COMPLAINT_PATTERN.test(contextStr)) {
    return 'UNRESOLVED_SUPPORT_OR_COMPLAINT';
  }
  if (SALES_INQUIRY_PATTERN.test(contextStr)) {
    return 'SALES_INQUIRY';
  }
  return 'GENERAL';
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

export function buildTenantFollowUpRequest({
  persona,
  stage,
  language = 'en',
  conversationContext = '',
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

  const contextIntent = classifyFollowUpContextIntent(conversationContext);
  let contextDirective = '';
  if (contextIntent === 'UNRESOLVED_SUPPORT_OR_COMPLAINT') {
    contextDirective = [
      'Context classification: UNRESOLVED_SUPPORT_OR_COMPLAINT.',
      'MANDATORY COMPLIANCE: The customer has an unresolved issue, defect, or complaint.',
      'DO NOT push sales pitches, commercial offers, or aggressive follow-ups.',
      'Any follow-up must be exclusively supportive, empathetic, and aimed at resolving the issue.',
    ].join(' ');
  } else if (contextIntent === 'SALES_INQUIRY') {
    contextDirective = [
      'Context classification: SALES_INQUIRY.',
      'Follow up with helpful, consultative, and relevant assistance regarding requested services.',
    ].join(' ');
  }

  return [
    `Generate one ${resolved.kind} message for ${persona.companyIdentity} as ${persona.assistantIdentity}.`,
    `Output language: ${language}.`,
    `ACTIVE tenant services/context: ${JSON.stringify(persona.profile?.services ?? [])}.`,
    `ACTIVE tenant tone: ${String(persona.configuration?.tone ?? '')}.`,
    `Approved ${resolved.kind} behavior: ${JSON.stringify(resolved.policy)}.`,
    `Current conversation context: ${String(conversationContext).slice(0, 2000)}.`,
    contextDirective,
    'Use only this tenant data. Do not invent identity, services, prices, geography, or claims. Produce only the customer-facing message.',
  ].filter(Boolean).join('\n');
}

