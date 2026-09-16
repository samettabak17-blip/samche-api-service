const MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY = 12;
const MAX_HISTORY_MESSAGE_LENGTH = 1200;
const ALLOWED_INTENTS = new Set(['sales', 'qualification', 'product_question', 'pricing', 'off_topic', 'handoff']);
const ALLOWED_NEXT_FIELDS = new Set(['industry', 'channels', 'volume', 'integrations', 'leadQualification', 'languages', 'aiGuideNeed', 'apiWorkflow', 'externalIntegrations', 'aiLeadScoring', 'teamUsers', 'timeline', 'contactPreference', null]);
const ALLOWED_LEAD_FIELDS = new Set(['name', 'email', 'company', 'industry', 'country', 'website', 'mainGoal', 'channels', 'products', 'languages', 'integrations', 'volume', 'timeline', 'contactPreference', 'teamUsers', 'leadQualification', 'budget', 'apiWorkflow', 'apiAccessNeed', 'customWorkflowNeed', 'aiGuideNeed', 'externalIntegrations', 'aiLeadScoring']);
const ALLOWED_ACTIONS = ['REQUEST_DEMO', 'WHATSAPP_HANDOFF'];
const SYSTEM_PROMPT = 'You are the SamChe AI sales conversation layer. Return only a JSON object with keys reply, intent, extractedFields, requestedNextField, and actionIntent. Use supplied lead state and approved facts as context. Never invent or alter pricing, setup fees, limits, features, availability, discounts, legal/security claims, or roadmap commitments. Do not reset qualification state. For off-topic questions, politely redirect and refer to the pending SamChe question without repeating the same wording. Extract only fields in the structured contract. Keep replies concise and natural in the requested locale.';
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
        extractedFields: { type: 'object', additionalProperties: false, properties: EXTRACTED_FIELD_SCHEMA, required: [...ALLOWED_LEAD_FIELDS] },
        requestedNextField: { anyOf: [{ type: 'string', enum: [...ALLOWED_NEXT_FIELDS].filter(Boolean) }, { type: 'null' }] },
        actionIntent: { type: 'array', items: { type: 'string', enum: ALLOWED_ACTIONS } },
      },
      required: ['reply', 'intent', 'extractedFields', 'requestedNextField', 'actionIntent'],
    },
  },
});

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
  return { ok: true, value: { reply: value.reply.trim(), intent: value.intent, extractedFields: value.extractedFields, requestedNextField: value.requestedNextField ?? null, actionIntent: value.actionIntent } };
}

function logValidationFailure(result, { environment, logger }) {
  if (environment?.RENDER_SERVICE_NAME !== 'samche-api-staging' && environment?.NODE_ENV !== 'staging') return;
  const details = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'ok' && key !== 'reason' && result[key] !== undefined));
  logger?.warn?.('sales_chat_validation_failed', { reason: result.reason, ...details });
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
        return { status: 422, body: { error: 'Sales assistant response was not usable.' }, context };
      }
      const result = validateSalesLlmOutput(content, { plans: commercialFacts.plans, products: commercialFacts.products });
      if (!result.ok) logValidationFailure(result, { environment, logger });
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

export { MODEL, MAX_HISTORY, MAX_MESSAGE_LENGTH, SALES_CHAT_RESPONSE_FORMAT };
