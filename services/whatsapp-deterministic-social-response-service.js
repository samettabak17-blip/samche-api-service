function languageTemplate(templates, language) {
  if (!templates || typeof templates !== 'object') return null;
  return typeof templates[language] === 'string' ? templates[language] : null;
}

function renderIdentityTemplate(template, tenant) {
  if (typeof template !== 'string' || !template) return null;
  const assistantName = String(tenant?.assistantName ?? '');
  const companyName = String(tenant?.companyName ?? '');
  if (!assistantName || !companyName) return null;
  return template
    .replaceAll('{{assistantName}}', assistantName)
    .replaceAll('{{companyName}}', companyName);
}

export function planWhatsAppDeterministicSocialResponse({
  tenant,
  communicationLanguage,
  currentIntent,
  firstAssistantResponse,
}) {
  const templates = tenant?.deterministicTemplates;
  const language = String(communicationLanguage ?? 'und');

  if (firstAssistantResponse && currentIntent === 'GREETING_ONLY') {
    const content = renderIdentityTemplate(languageTemplate(templates?.first_contact, language), tenant);
    return content ? { kind: 'FIRST_CONTACT_GREETING', content, shouldInvokeGemini: false } : null;
  }

  if (!firstAssistantResponse && currentIntent === 'GREETING_ONLY') {
    const content = languageTemplate(templates?.social?.greeting, language);
    return content ? { kind: 'SOCIAL_GREETING', content, shouldInvokeGemini: false } : null;
  }

  if (!firstAssistantResponse && currentIntent === 'THANKS_ONLY') {
    const content = languageTemplate(templates?.social?.thanks, language);
    return content ? { kind: 'SOCIAL_THANKS', content, shouldInvokeGemini: false } : null;
  }

  return null;
}




