const MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY = 12;
const MAX_HISTORY_MESSAGE_LENGTH = 1200;
const ALLOWED_INTENTS = new Set(['sales', 'qualification', 'product_question', 'pricing', 'off_topic', 'handoff']);
const ALLOWED_NEXT_FIELDS = new Set(['industry', 'channels', 'volume', 'integrations', 'leadQualification', 'languages', 'aiGuideNeed', 'apiWorkflow', 'externalIntegrations', 'aiLeadScoring', 'teamUsers', 'timeline', 'contactPreference', null]);
const ALLOWED_LEAD_FIELDS = new Set(['name', 'email', 'company', 'industry', 'country', 'website', 'mainGoal', 'channels', 'products', 'languages', 'integrations', 'volume', 'timeline', 'contactPreference', 'teamUsers', 'leadQualification', 'budget', 'apiWorkflow', 'apiAccessNeed', 'customWorkflowNeed', 'aiGuideNeed', 'externalIntegrations', 'aiLeadScoring']);
const ALLOWED_ACTIONS = ['REQUEST_DEMO', 'WHATSAPP_HANDOFF'];
const SYSTEM_PROMPT = 'You are the SamChe AI sales conversation layer. Return only a JSON object with keys reply, intent, extractedFields, requestedNextField, and actionIntent. Use supplied lead state and approved facts as context. Never invent or alter pricing, setup fees, limits, features, availability, discounts, legal/security claims, or roadmap commitments. Do not reset qualification state. For off-topic questions, politely redirect and refer to the pending SamChe question without repeating the same wording. Extract only fields in the structured contract. Keep replies concise and natural in the requested locale.';

function text(value, limit) { return typeof value === 'string' ? value.slice(0, limit) : ''; }

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
    approvedPlanFacts: commercialFacts.plans.map((plan) => ({ ...plan })),
    approvedProductFacts: commercialFacts.products.map((product) => ({ ...product })),
    allowedActions: [...ALLOWED_ACTIONS],
    userMessage: text(body.userMessage, MAX_MESSAGE_LENGTH),
  };
}

function approvedAmounts(plans) { return new Set(plans.flatMap((plan) => [plan.monthly, plan.setup, plan.yearly, plan.interactions]).map(String)); }

export function validateSalesLlmOutput(output, { plans, products, allowedActions = ALLOWED_ACTIONS } = {}) {
  let value = output;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return { ok: false, reason: 'invalid_json' }; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'invalid_shape' };
  if (typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 3000) return { ok: false, reason: 'invalid_reply' };
  if (!ALLOWED_INTENTS.has(value.intent)) return { ok: false, reason: 'invalid_intent' };
  if (!ALLOWED_NEXT_FIELDS.has(value.requestedNextField ?? null)) return { ok: false, reason: 'invalid_next_field' };
  if (!Array.isArray(value.actionIntent) || value.actionIntent.some((action) => !allowedActions.includes(action))) return { ok: false, reason: 'invalid_action' };
  if (!value.extractedFields || typeof value.extractedFields !== 'object' || Array.isArray(value.extractedFields)) return { ok: false, reason: 'invalid_fields' };
  if (Object.keys(value.extractedFields).some((key) => !ALLOWED_LEAD_FIELDS.has(key))) return { ok: false, reason: 'unsupported_field' };
  for (const [key, fieldValue] of Object.entries(value.extractedFields)) {
    if (['channels', 'products'].includes(key)) {
      if (!Array.isArray(fieldValue) || fieldValue.some((item) => typeof item !== 'string')) return { ok: false, reason: 'invalid_field_value' };
    } else if (typeof fieldValue !== 'string' && typeof fieldValue !== 'boolean') return { ok: false, reason: 'invalid_field_value' };
  }
  const amounts = approvedAmounts(plans);
  for (const amount of value.reply.matchAll(/AED\s*([\d,]+)/gi)) if (!amounts.has(amount[1].replaceAll(',', ''))) return { ok: false, reason: 'unsupported_commercial_claim' };
  if (/(?:discount|free|unlimited|guaranteed)/i.test(value.reply)) return { ok: false, reason: 'unsupported_commercial_claim' };
  const knownProducts = products.map((product) => product.name);
  const unknownProductClaim = [...value.reply.matchAll(/\b(?:Web Chatbot|WhatsApp AI|AI Guide|Knowledge Intelligence|Live Inbox|CRM & Pipeline)\b/g)].some((match) => knownProducts.length > 0 && !knownProducts.includes(match[0]));
  if (unknownProductClaim) return { ok: false, reason: 'unsupported_product_claim' };
  return { ok: true, value: { reply: value.reply.trim(), intent: value.intent, extractedFields: value.extractedFields, requestedNextField: value.requestedNextField ?? null, actionIntent: value.actionIntent } };
}

export function createSalesChatService({ openaiClient, commercialFacts, timeoutMs = 20000 } = {}) {
  async function handle({ body = {} } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'Sales assistant request is invalid.' } };
    if (typeof body.userMessage !== 'string' || !body.userMessage.trim() || body.userMessage.length > MAX_MESSAGE_LENGTH) return { status: 400, body: { error: 'A non-empty message is required.' } };
    if (!Array.isArray(body.conversationHistory) || body.conversationHistory.length > MAX_HISTORY) return { status: 400, body: { error: 'Sales assistant request is invalid.' } };
    const context = buildContext({ ...body, conversationHistory: body.conversationHistory }, commercialFacts);
    if (!openaiClient?.chat?.completions?.create) return { status: 503, body: { error: 'Sales assistant is temporarily unavailable.' }, context };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const completion = await openaiClient.chat.completions.create({ model: MODEL, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(context) },
      ] }, { signal: controller.signal });
      const content = completion?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return { status: 422, body: { error: 'Sales assistant response was not usable.' }, context };
      const result = validateSalesLlmOutput(content, { plans: commercialFacts.plans, products: commercialFacts.products });
      return result.ok ? { status: 200, body: result.value, context } : { status: 422, body: { error: 'Sales assistant response was not usable.' }, context };
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

export { MODEL, MAX_HISTORY, MAX_MESSAGE_LENGTH };
