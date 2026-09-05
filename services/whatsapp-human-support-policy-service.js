function textAt(value, language) {
  const candidate = value && typeof value === 'object' && typeof value[language] === 'string'
    ? value[language].trim()
    : '';
  return candidate || null;
}

function configuredLanguages(generalTopic, transfer, preferredLanguage) {
  const shared = Object.keys(generalTopic || {}).filter((language) => textAt(generalTopic, language) && textAt(transfer, language));
  return [...new Set([preferredLanguage, 'en', 'tr', 'ar', ...shared])];
}

function policyFromTemplates(templates, language, source) {
  const humanSupport = templates?.human_support;
  if (humanSupport?.enabled === false) return null;
  for (const configuredLanguage of configuredLanguages(humanSupport?.general_topic, humanSupport?.transfer, language)) {
    const defaultTopic = textAt(humanSupport?.general_topic, configuredLanguage);
    const transfer = textAt(humanSupport?.transfer, configuredLanguage);
    if (!defaultTopic || !transfer || !transfer.includes('{{topicSummary}}')) continue;
    return {
      source,
      language: configuredLanguage,
      defaultTopic,
      acknowledgement(topicSummary) {
        const topic = typeof topicSummary === 'string' && topicSummary.trim() ? topicSummary.trim().slice(0, 255) : defaultTopic;
        return transfer.replaceAll('{{topicSummary}}', topic);
      },
    };
  }
  return null;
}

// ACTIVE tenant configuration is authoritative.  The legacy assistant column
// remains a scoped, read-only compatibility source until backfill completes.
export function resolveWhatsAppHumanSupportPolicy({ activeTemplates = null, legacyTemplates = null, language = 'en' } = {}) {
  if (activeTemplates?.human_support?.enabled === false) return null;
  return policyFromTemplates(activeTemplates, language, 'ACTIVE_CONFIGURATION')
    ?? policyFromTemplates(legacyTemplates, language, 'LEGACY_COMPATIBILITY');
}

export function summarizeWhatsAppHumanSupportTopic({ text, fallback }) {
  const value = String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return fallback;
  return value.slice(0, 255);
}
