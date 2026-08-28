function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function enabled(value) {
  return value === true;
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

export function buildTenantFollowUpRequest({ persona, stage, language = 'en', conversationContext = '', humanHandling = false, scheduled = false }) {
  if (humanHandling) return { available: false, code: 'HUMAN_HANDLING' };
  const resolved = resolveTenantFollowUpPolicy({ persona, stage, scheduled });
  if (!resolved.enabled) return { available: false, code: resolved.code };
  return [
    `Generate one ${resolved.kind} message for ${persona.companyIdentity} as ${persona.assistantIdentity}.`,
    `Output language: ${language}.`,
    `ACTIVE tenant services/context: ${JSON.stringify(persona.profile?.services ?? [])}.`,
    `ACTIVE tenant tone: ${String(persona.configuration?.tone ?? '')}.`,
    `Approved ${resolved.kind} behavior: ${JSON.stringify(resolved.policy)}.`,
    `Current conversation context: ${String(conversationContext).slice(0, 2000)}.`,
    'Use only this tenant data. Do not invent identity, services, prices, geography, or claims. Produce only the customer-facing message.',
  ].join('\n');
}
