const MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY = 12;
const MAX_HISTORY_MESSAGE_LENGTH = 1200;
const ALLOWED_INTENTS = new Set(['sales', 'qualification', 'product_question', 'capability_question', 'feature_question', 'pricing_question', 'pricing', 'demo_question', 'off_topic', 'handoff']);
const ALLOWED_RESPONSE_MODES = new Set(['qualification_answer', 'in_scope_interrupt', 'pricing_interrupt', 'capability_interrupt', 'demo_interrupt', 'off_topic', 'handoff']);
const ALLOWED_NEXT_FIELDS = new Set(['industry', 'channels', 'volume', 'integrations', 'leadQualification', 'languages', 'aiGuideNeed', 'apiWorkflow', 'externalIntegrations', 'aiLeadScoring', 'teamUsers', 'timeline', 'contactPreference', null]);
const ALLOWED_LEAD_FIELDS = new Set(['name', 'email', 'company', 'industry', 'country', 'website', 'mainGoal', 'channels', 'products', 'languages', 'integrations', 'volume', 'timeline', 'contactPreference', 'preferredDemoDate', 'preferredDemoTime', 'teamUsers', 'leadQualification', 'budget', 'apiWorkflow', 'apiAccessNeed', 'customWorkflowNeed', 'aiGuideNeed', 'externalIntegrations', 'aiLeadScoring']);
const ALLOWED_ACTIONS = ['REQUEST_DEMO', 'WHATSAPP_HANDOFF'];
export const SALES_CHAT_CAPABILITIES = Object.freeze({
  canScheduleCalendarMeeting: false,
  canConfirmAppointment: false,
  canSendEmail: false,
});
const SYSTEM_PROMPT = 'You are the SamChe AI sales conversation layer. Return only a JSON object with keys reply, intent, responseMode, resumePendingQuestion, extractedFields, requestedNextField, and actionIntent. CURRENT USER MESSAGE HAS PRIORITY. If responseMode is an in-scope interrupt, answer the current product, capability, feature, pricing, or demo question first; do not output only the pending qualification question. Then resume the supplied lastPendingQuestion naturally, preserving the full lead state. Never invent or alter pricing, setup fees, limits, features, availability, discounts, legal/security claims, or roadmap commitments. Do not claim guaranteed employee replacement, headcount reduction, ROI, or sales results. Do not reset qualification state. For off-topic questions, politely redirect and refer to the pending SamChe question without repeating the same wording. Extract only fields in the structured contract. Keep replies concise and natural in the requested locale. Server capabilities are authoritative and immutable: canScheduleCalendarMeeting=false, canConfirmAppointment=false, canSendEmail=false. Never claim that a meeting is scheduled, an appointment is confirmed, or an email confirmation will be sent.';
const EXTRACTED_ARRAY_FIELDS = new Set(['channels', 'products']);
const EXTRACTED_FIELD_ALIASES = Object.freeze({
  team_users: 'teamUsers', lead_qualification: 'leadQualification', ai_guide_need: 'aiGuideNeed',
  api_workflow: 'apiWorkflow', api_access_need: 'apiAccessNeed', custom_workflow_need: 'customWorkflowNeed',
  external_integrations: 'externalIntegrations', ai_lead_scoring: 'aiLeadScoring', contact_preference: 'contactPreference',
});
const NEXT_FIELD_ALIASES = Object.freeze({
  team_users: 'teamUsers', lead_qualification: 'leadQualification', ai_guide_need: 'aiGuideNeed',
  api_workflow: 'apiWorkflow', external_integrations: 'externalIntegrations', ai_lead_scoring: 'aiLeadScoring',
  contact_preference: 'contactPreference',
});
const INTENT_ALIASES = Object.freeze({ 'off-topic': 'off_topic', 'off topic': 'off_topic', 'product-question': 'product_question', 'product question': 'product_question' });
const EXTRACTED_FIELD_SCHEMA = Object.fromEntries([...ALLOWED_LEAD_FIELDS].map((field) => [field, EXTRACTED_ARRAY_FIELDS.has(field)
  ? { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] }
  : { anyOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'null' }] }]));
const SALES_CHAT_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'sales_chat_response',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reply: { type: 'string' },
        intent: { type: 'string', enum: [...ALLOWED_INTENTS] },
        responseMode: { type: 'string', enum: [...ALLOWED_RESPONSE_MODES] },
        resumePendingQuestion: { type: 'boolean' },
        extractedFields: { type: 'object', additionalProperties: false, properties: EXTRACTED_FIELD_SCHEMA, required: [...ALLOWED_LEAD_FIELDS] },
        requestedNextField: { anyOf: [{ type: 'string', enum: [...ALLOWED_NEXT_FIELDS].filter(Boolean) }, { type: 'null' }] },
        actionIntent: { type: 'array', items: { type: 'string', enum: ALLOWED_ACTIONS } },
      },
      required: ['reply', 'intent', 'responseMode', 'resumePendingQuestion', 'extractedFields', 'requestedNextField', 'actionIntent'],
    },
  },
});

function text(value, limit) { return typeof value === 'string' ? value.slice(0, limit) : ''; }

function unavailableSalesClaims(reply, capabilities) {
  // Remove only explicit negated predicates, never a reply-wide "no" exemption.
  // Check clauses independently so a denial cannot hide a later affirmative claim.
  return String(reply).replace(/[’]/g, "'").replace(/[\u064B-\u065F]/g, '')
    .split(/[.!?;,\n،؛]+|\b(?:but|however|and)\b|ولكن|لكن/iu).some((clause) => {
      const affirmative = clause
        .replace(/\bno\s+(?:demo|appointment|meeting|slot|booking|email)(?:\s+or\s+email)?\s+(?:(?:has|have|is|was|were|will|be|been|now|yet)\s+)*(?:confirmed|scheduled|booked|sent)\b/gi, '')
        .replace(/\b(?:not|never|cannot|can't|haven't|hasn't|won't|isn't|wasn't|didn't)\s+(?:(?:have|has|been|be|yet|already|ever)\s+)*(?:confirm(?:ed)?|schedul(?:e|ed)|book(?:ed)?|send|sent|receive|received|email(?:ed)?)(?:\s+(?:an?|the|your|any))?(?:\s+(?:confirmation|email|demo|appointment|meeting|slot|booking))*(?:\s+(?:confirming|for|on|at)\b[^\n]*)?\b/gi, '')
        .replace(/(?:لم|لن|لا)\s+(?:يتم\s+|نقم\s+ب|يمكن(?:ني|نا)?\s+)?(?:تأكيد|نؤكد|حجز|نحجز|جدولة|نجدول|إرسال|ارسال|نرسل|يرسل|تأكيده)(?:\s+(?:بريد[^\n]*|موعد[^\n]*|عرض[^\n]*))?/gu, '')
        .replace(/(?:غير|ليس|ليست)\s+(?:مؤكد|مؤكدة|محجوز|محجوزة|مجدول|مجدولة)/gu, '');
      const explicitDenial = /\b(?:not|never|cannot|can't|haven't|hasn't|won't|isn't|wasn't|didn't)\b[^.!?\n]{0,100}\b(?:confirm|schedule|book|send|sent|receive|received|email)\b/i.test(clause)
        || /(?:لم|لن|لا|ليس|ليست|غير)[^،؛.!?\n]{0,100}(?:تأكيد|حجز|جدولة|إرسال|ارسال|بريد|إيميل|ايميل|مؤكد|محجوز|مجدول)/u.test(clause);
      if (explicitDenial) return false;
      const scheduling = /\b(?:demo|appointment|meeting|slot|booking)\b.{0,100}\b(?:confirm(?:ed|ation)?|schedul(?:e|ed|ing)|book(?:ed|ing)?|reserved|set|setting up|arranged|on the calendar)\b|\b(?:will|shall|can|going to)\s+(?:schedule|confirm|book|arrange|set(?:\s+up)?)\b.{0,100}\b(?:demo|appointment|meeting|slot|booking)\b|\b(?:confirm(?:ed|ation)?|schedul(?:e|ed|ing)|book(?:ed|ing)?|reserved|arranged|set(?:ting)?(?:\s+up)?|will\s+|going to\s+)(?:\w+\s+){0,2}(?:demo|appointment|meeting|slot|booking)\b|\b(?:set|setting up|arranged|scheduled|booked)\s+(?:a\s+)?(?:demo|appointment|meeting|slot|booking)\b|\b(?:demo|appointment|meeting|slot)\b.{0,100}\bon\s+the\s+calendar\b/i.test(affirmative)
        || /(?:تم|سيتم|سن|سوف|سيقوم|قمنا|لقد|قام|نحدد|نؤكد|نحجز|نجدول|جدولة|حجز|تأكيد|تحديد).{0,80}(?:موعد|عرض|اجتماع|تقويم)|(?:موعد|عرض|اجتماع).{0,80}(?:مؤكد|محجوز|مجدول)/u.test(affirmative);
      const email = /\b(?:send|sent|email|emailed|receive|received|will\s+email|going to\s+email)\b.{0,80}\b(?:confirmation|confirming|email)\b|\b(?:confirmation email|email confirmation|email is on the way|check your inbox)\b/i.test(affirmative)
        || /(?:أرسلنا|ارسلنا|سنرسل|نرسل|سيرسل|سيصلك|ستصلك|إرسال|ارسال|بريد|رسالة|إيميل|ايميل).{0,80}(?:تأكيد|موعد|عرض)/u.test(affirmative);
      return ((!capabilities.canScheduleCalendarMeeting || !capabilities.canConfirmAppointment) && scheduling)
        || (!capabilities.canSendEmail && email);
    });
}

export function sanitizeSalesReply(reply, capabilities = SALES_CHAT_CAPABILITIES) {
  if (typeof reply !== 'string') return reply;
  return unavailableSalesClaims(reply, capabilities)
    ? 'We’ll include your requested time as a preferred demo time. Our sales team will confirm availability after reviewing your request.'
    : reply;
}

function buildContext(body, commercialFacts) {
  const leadState = {};
  for (const key of ALLOWED_LEAD_FIELDS) {
    const value = body.leadState?.[key];
    if (Array.isArray(value)) leadState[key] = value.filter((item) => typeof item === 'string').slice(0, 20);
    else if (typeof value === 'string' || typeof value === 'boolean') leadState[key] = value;
  }
  return {
    locale: body.locale === 'ar' ? 'ar' : 'en',
    conversationHistory: body.conversationHistory.slice(-MAX_HISTORY).map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      text: text(message?.text ?? message?.content, MAX_HISTORY_MESSAGE_LENGTH),
    })).filter((message) => message.text),
    leadState,
    qualificationStage: text(body.qualificationStage, 40),
    pendingField: ALLOWED_NEXT_FIELDS.has(body.pendingQualificationField ?? body.pendingField) ? (body.pendingQualificationField ?? body.pendingField) : null,
    lastPendingQuestion: text(body.lastPendingQuestion, 500),
    recommendedPlan: text(body.recommendedPlan, 40),
    responseMode: ALLOWED_RESPONSE_MODES.has(body.responseMode) ? body.responseMode : 'qualification_answer',
    detectedIntent: text(body.detectedIntent, 40),
    approvedPlanFacts: commercialFacts.plans.map((plan) => ({ ...plan })),
    approvedProductFacts: commercialFacts.products.map((product) => ({ ...product })),
    capabilities: SALES_CHAT_CAPABILITIES,
    allowedActions: [...ALLOWED_ACTIONS],
    userMessage: text(body.userMessage, MAX_MESSAGE_LENGTH),
  };
}

function approvedAmounts(plans) { return new Set(plans.flatMap((plan) => [plan.monthly, plan.setup, plan.yearly, plan.interactions]).map(String)); }

function failure(reason, details = {}) { return { ok: false, reason, ...details }; }

function safeDiagnosticValue(value) {
  return typeof value === 'string' ? value.slice(0, 80) : typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}

export function normalizeSalesLlmOutput(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
  const normalized = { ...output };
  if (typeof normalized.intent === 'string') normalized.intent = INTENT_ALIASES[normalized.intent] || normalized.intent;
  if (typeof normalized.requestedNextField === 'string') normalized.requestedNextField = NEXT_FIELD_ALIASES[normalized.requestedNextField] || normalized.requestedNextField;
  if (normalized.extractedFields && typeof normalized.extractedFields === 'object' && !Array.isArray(normalized.extractedFields)) {
    normalized.extractedFields = Object.fromEntries(Object.entries(normalized.extractedFields)
      .map(([key, value]) => [EXTRACTED_FIELD_ALIASES[key] || key, value])
      .filter(([, value]) => value !== null));
  }
  return normalized;
}

export function validateSalesLlmOutput(output, { plans, products, allowedActions = ALLOWED_ACTIONS } = {}) {
  let value = output;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return failure('invalid_json'); } }
  value = normalizeSalesLlmOutput(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid_shape');
  if (typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 3000) return failure('invalid_reply', { field: 'reply' });
  if (!ALLOWED_INTENTS.has(value.intent)) return failure('invalid_intent', { value: safeDiagnosticValue(value.intent) });
  if (!ALLOWED_RESPONSE_MODES.has(value.responseMode)) return failure('invalid_response_mode', { value: safeDiagnosticValue(value.responseMode) });
  if (typeof value.resumePendingQuestion !== 'boolean') return failure('invalid_resume_pending_question');
  if (!ALLOWED_NEXT_FIELDS.has(value.requestedNextField ?? null)) return failure('invalid_next_field', { value: safeDiagnosticValue(value.requestedNextField) });
  if (!Array.isArray(value.actionIntent) || value.actionIntent.some((action) => !allowedActions.includes(action))) return failure('invalid_action', { value: safeDiagnosticValue(value.actionIntent?.find((action) => !allowedActions.includes(action))) });
  if (!value.extractedFields || typeof value.extractedFields !== 'object' || Array.isArray(value.extractedFields)) return failure('invalid_fields');
  const unsupportedField = Object.keys(value.extractedFields).find((key) => !ALLOWED_LEAD_FIELDS.has(key));
  if (unsupportedField) return failure('unsupported_field', { field: unsupportedField });
  for (const [key, fieldValue] of Object.entries(value.extractedFields)) {
    if (['channels', 'products'].includes(key)) {
      if (!Array.isArray(fieldValue) || fieldValue.some((item) => typeof item !== 'string')) return failure('invalid_field_value', { field: key, type: Array.isArray(fieldValue) ? 'array_item' : typeof fieldValue });
    } else if (typeof fieldValue !== 'string' && typeof fieldValue !== 'boolean') return failure('invalid_field_value', { field: key, type: typeof fieldValue });
  }
  const amounts = approvedAmounts(plans);
  for (const amount of value.reply.matchAll(/AED\s*([\d,]+)/gi)) if (!amounts.has(amount[1].replaceAll(',', ''))) return failure('unsupported_commercial_claim', { category: 'amount' });
  if (/(?:discount|free|unlimited|guaranteed)/i.test(value.reply)) return failure('unsupported_commercial_claim', { category: 'disallowed_term' });
  const knownProducts = products.map((product) => product.name);
  const unknownProductClaim = [...value.reply.matchAll(/\b(?:Web Chatbot|WhatsApp AI|AI Guide|Knowledge Intelligence|Live Inbox|CRM & Pipeline)\b/g)].some((match) => knownProducts.length > 0 && !knownProducts.includes(match[0]));
  if (unknownProductClaim) return failure('unsupported_product_claim', { category: 'product_name' });
  if (value.responseMode === 'capability_interrupt' && value.intent !== 'capability_question') return failure('response_mode_intent_mismatch');
  if (value.responseMode === 'pricing_interrupt' && !['pricing', 'pricing_question'].includes(value.intent)) return failure('response_mode_intent_mismatch');
  if (['in_scope_interrupt', 'capability_interrupt', 'pricing_interrupt', 'demo_interrupt'].includes(value.responseMode) && value.resumePendingQuestion !== true) return failure('interrupt_resume_required');
  return { ok: true, value: { reply: value.reply.trim(), intent: value.intent, responseMode: value.responseMode, resumePendingQuestion: value.resumePendingQuestion, extractedFields: value.extractedFields, requestedNextField: value.requestedNextField ?? null, actionIntent: value.actionIntent } };
}

function logValidationFailure(result, { environment, logger }) {
  if (environment?.RENDER_SERVICE_NAME !== 'samche-api-staging' && environment?.NODE_ENV !== 'staging') return;
  // Reasons are fixed literals produced by this module. Never forward provider values or keys.
  logger?.warn?.('sales_chat_validation_failed', { reason: result.reason });
}

function isInterruptMode(mode) { return ['capability_interrupt', 'pricing_interrupt', 'in_scope_interrupt', 'demo_interrupt'].includes(mode); }

function expectedIntentForMode(mode, userMessage = '') {
  if (mode === 'capability_interrupt') return 'capability_question';
  if (mode === 'pricing_interrupt') return 'pricing_question';
  if (mode === 'in_scope_interrupt') return /ai guide|web chatbot|whatsapp ai|live inbox|knowledge intelligence|product|feature/i.test(userMessage) ? 'feature_question' : 'product_question';
  if (mode === 'demo_interrupt') return 'demo_question';
  return 'qualification';
}

function pendingResumePresent(reply, context) {
  if (!context.lastPendingQuestion || !context.pendingField) return true;
  if (reply.toLowerCase().includes(context.lastPendingQuestion.toLowerCase())) return true;
  const fieldTerms = {
    industry: /industry|business/i, channels: /channel|website|whatsapp/i, volume: /volume|enquir|inquir|lead/i,
    integrations: /integration|crm|booking/i, leadQualification: /qualif/i, languages: /language/i,
    aiGuideNeed: /ai guide/i, apiWorkflow: /api|workflow/i, externalIntegrations: /external/i,
    aiLeadScoring: /scoring/i, teamUsers: /team|user|people|staff/i, timeline: /start|launch/i, contactPreference: /demo|whatsapp|contact/i,
  };
  return Boolean(fieldTerms[context.pendingField]?.test(reply));
}

function planFromContext(context, plans) {
  const textValue = `${context.userMessage} ${context.recommendedPlan}`.toLowerCase();
  return plans.find((plan) => textValue.includes(plan.slug) || textValue.includes(plan.name.toLowerCase())) || null;
}

function safeInterruptReply(mode, context, plans) {
  const pending = context.lastPendingQuestion || '';
  if (mode === 'capability_interrupt') return `SamChe AI can support first-response work by answering FAQs, qualifying leads, and routing conversations. It is a support layer rather than a one-for-one employee replacement; people remain important for negotiation, relationships, and closing.${pending ? ` ${pending}` : ''}`;
  if (mode === 'pricing_interrupt') {
    const plan = planFromContext(context, plans);
    if (plan) return `The ${plan.name} plan is ${plan.from ? 'from ' : ''}AED ${plan.monthly.toLocaleString('en-US')}/month, with ${plan.from ? 'from ' : ''}AED ${plan.setup.toLocaleString('en-US')} one-time setup and ${plan.interactions} AI interactions per month.${pending ? ` ${pending}` : ''}`;
  }
  if (mode === 'in_scope_interrupt') {
    const product = /ai guide/i.test(context.userMessage)
      ? 'AI Guide provides a guided, step-by-step experience for helping visitors find relevant information and next actions.'
      : 'SamChe AI can answer common questions using approved business knowledge and route qualified conversations to your team.';
    return `${product}${pending ? ` ${pending}` : ''}`;
  }
  return `I can help with that SamChe AI question.${pending ? ` ${pending}` : ''}`;
}

function interruptReplyIsUsable(mode, reply, context, plans) {
  if (!reply || !pendingResumePresent(reply, context)) return false;
  if (mode === 'capability_interrupt') return /automate|support|first-response|faq|qualif|rout|human|sales staff|negotiat|relationship|closing/i.test(reply)
    && !/guaranteed|headcount reduction|reduce(?:d)? headcount|replace.*one-for-one|\broi\b|sales results/i.test(reply);
  if (mode === 'pricing_interrupt') {
    const plan = planFromContext(context, plans);
    return Boolean(plan && reply.includes(`AED ${plan.monthly.toLocaleString('en-US')}`));
  }
  if (mode === 'in_scope_interrupt') return /ai guide|web chatbot|whatsapp ai|live inbox|knowledge intelligence|product|feature/i.test(reply);
  return true;
}

function enforceInterruptResponse(candidate, context, commercialFacts) {
  const mode = context.responseMode;
  const sanitizedCandidateReply = candidate ? sanitizeSalesReply(candidate.reply, SALES_CHAT_CAPABILITIES) : null;
  const replyWasRewritten = Boolean(candidate && sanitizedCandidateReply !== candidate.reply);
  const sanitizedCandidate = replyWasRewritten ? { ...candidate, reply: sanitizedCandidateReply, actionIntent: [] } : candidate;
  const usable = replyWasRewritten || (sanitizedCandidate && interruptReplyIsUsable(mode, sanitizedCandidate.reply, context, commercialFacts.plans));
  const baseReply = usable ? sanitizedCandidate.reply : safeInterruptReply(mode, context, commercialFacts.plans);
  const reply = replyWasRewritten && context.lastPendingQuestion ? `${baseReply} ${context.lastPendingQuestion}` : baseReply;
  return {
    reply, intent: expectedIntentForMode(mode, context.userMessage), responseMode: mode,
    extractedFields: usable ? sanitizedCandidate.extractedFields : {},
    requestedNextField: context.pendingField || (usable ? sanitizedCandidate.requestedNextField : null),
    resumePendingQuestion: Boolean(context.lastPendingQuestion && context.pendingField), actionIntent: [],
  };
}

export function createSalesChatService({ openaiClient, commercialFacts, timeoutMs = 20000, environment = process.env, logger = console } = {}) {
  async function handle({ body = {} } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'Sales assistant request is invalid.' } };
    if (typeof body.userMessage !== 'string' || !body.userMessage.trim() || body.userMessage.length > MAX_MESSAGE_LENGTH) return { status: 400, body: { error: 'A non-empty message is required.' } };
    if (!Array.isArray(body.conversationHistory) || body.conversationHistory.length > MAX_HISTORY) return { status: 400, body: { error: 'Sales assistant request is invalid.' } };
    const context = buildContext({ ...body, conversationHistory: body.conversationHistory }, commercialFacts);
    if (!openaiClient?.chat?.completions?.create) return { status: 503, body: { error: 'Sales assistant is temporarily unavailable.' }, context };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const completion = await openaiClient.chat.completions.create({ model: MODEL, response_format: SALES_CHAT_RESPONSE_FORMAT, messages: [
        { role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(context) },
      ] }, { signal: controller.signal });
      const content = completion?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        logValidationFailure(failure('invalid_provider_response'), { environment, logger });
        if (isInterruptMode(context.responseMode)) return { status: 200, body: enforceInterruptResponse(null, context, commercialFacts), context };
        return { status: 422, body: { error: 'Sales assistant response was not usable.' }, context };
      }
      const result = validateSalesLlmOutput(content, { plans: commercialFacts.plans, products: commercialFacts.products });
      if (!result.ok) logValidationFailure(result, { environment, logger });
      if (isInterruptMode(context.responseMode)) return { status: 200, body: enforceInterruptResponse(result.ok ? result.value : null, context, commercialFacts), context };
      if (result.ok) {
        const reply = sanitizeSalesReply(result.value.reply, SALES_CHAT_CAPABILITIES);
        return { status: 200, body: { ...result.value, reply, actionIntent: reply === result.value.reply ? result.value.actionIntent : [] }, context };
      }
      return { status: 422, body: { error: 'Sales assistant response was not usable.' }, context };
    } catch {
      return { status: 503, body: { error: 'Sales assistant is temporarily unavailable.' }, context };
    } finally { clearTimeout(timer); }
  }
  return { handle };
}

export function createSalesChatRateLimiter({ limit = 30, windowMs = 60_000, now = Date.now } = {}) {
  const attempts = new Map();
  return {
    allow(identity = 'unknown') {
      const current = now();
      const recent = (attempts.get(identity) || []).filter((timestamp) => current - timestamp < windowMs);
      if (recent.length >= limit) { attempts.set(identity, recent); return false; }
      recent.push(current);
      attempts.set(identity, recent);
      return true;
    },
  };
}

export function registerSalesChatRoute({ app, service, rateLimiter }) {
  app.post('/api/sales-chat', async (req, res) => {
    if (!rateLimiter.allow(req.ip || req.socket?.remoteAddress || 'unknown')) {
      return res.status(429).json({ error: 'Sales assistant is temporarily unavailable.' });
    }
    const result = await service.handle({ body: req.body });
    return res.status(result.status).json(result.body);
  });
}

export { MODEL, MAX_HISTORY, MAX_MESSAGE_LENGTH, SALES_CHAT_RESPONSE_FORMAT };
