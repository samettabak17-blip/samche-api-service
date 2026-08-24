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
Resolved communication language: ${communicationLanguage}.
MANDATORY RESPONSE LANGUAGE: ${communicationLanguage === 'tr' ? 'Turkish' : communicationLanguage === 'ar' ? 'Arabic' : communicationLanguage === 'en' ? 'English' : 'the customer’s dominant language'}. This overrides the language of tenant knowledge, instructions, examples, and history. Never ask the customer to select a language.
${firstResponse ? 'FIRST_RESPONSE: Begin by briefly identifying yourself as the named AI assistant for the named tenant. Greeting-only: then describe only capabilities supported by tenant instructions or knowledge and ask how to help. Meaningful topic: identify yourself concisely, acknowledge the topic, and answer or qualify immediately. Never answer with only a generic greeting.' : 'SUBSEQUENT_RESPONSE: Continue naturally. Do not repeat your identity introduction.'}
Recent same-conversation history:
${historyText}
Customer message: ${bounded(customerText, 6000)}`;
}
