function bounded(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

export function buildWhatsAppTenantPrompt({ tenant, history = [], customerText, communicationLanguage = 'und' }) {
  const firstResponse = !history.some((message) => message.sender_type === 'ASSISTANT');
  const knowledge = (tenant?.knowledge ?? []).map((item) => bounded(item, 3000)).filter(Boolean).join('\n');
  const historyText = history.slice(-8).map((message) => `${message.sender_type}: ${bounded(message.content, 1000)}`).join('\n');
  return `You are ${bounded(tenant?.assistantName, 255) || 'the AI advisor'} for ${bounded(tenant?.companyName, 255) || 'this company'}.
Tenant instructions: ${bounded(tenant?.systemPrompt, 6000)}
Tenant knowledge: ${knowledge || 'No additional tenant capability details are available.'}
Communication language: ${communicationLanguage}.
Respond naturally in the customer's dominant language, using the persisted language for short or mixed messages. Never ask the customer to select a language.
${firstResponse ? 'FIRST_RESPONSE_GREETING: If this is greeting-only, introduce the tenant and assistant once and describe only supported tenant capabilities. If it has a topic, introduce concisely then answer that topic directly.' : 'SUBSEQUENT_RESPONSE: Continue naturally. Do not repeat the introduction.'}
Recent same-conversation history:
${historyText}
Customer message: ${bounded(customerText, 6000)}`;
}
