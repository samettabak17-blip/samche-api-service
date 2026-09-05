function localized(value, language) {
  if (!value || typeof value !== 'object') return null;
  const preferred = typeof value[language] === 'string' ? value[language].trim() : '';
  const fallback = typeof value.en === 'string' ? value.en.trim() : '';
  return preferred || fallback || null;
}

function policyFromTemplates(templates, language, source) {
  const humanSupport = templates?.human_support;
  if (humanSupport?.enabled === false) return null;
  const defaultTopic = localized(humanSupport?.general_topic, language);
  const transfer = localized(humanSupport?.transfer, language);
  if (!defaultTopic || !transfer || !transfer.includes('{{topicSummary}}')) return null;
  return {
    source,
    defaultTopic,
    acknowledgement(topicSummary) {
      const topic = typeof topicSummary === 'string' && topicSummary.trim() ? topicSummary.trim().slice(0, 255) : defaultTopic;
      return transfer.replaceAll('{{topicSummary}}', topic);
    },
  };
}

// ACTIVE tenant configuration is authoritative.  The legacy assistant column
// remains a scoped, read-only compatibility source until backfill completes.
export function resolveWhatsAppHumanSupportPolicy({ activeTemplates = null, legacyTemplates = null, language = 'en' } = {}) {
  return policyFromTemplates(activeTemplates, language, 'ACTIVE_CONFIGURATION')
    ?? policyFromTemplates(legacyTemplates, language, 'LEGACY_COMPATIBILITY');
}

export function summarizeWhatsAppHumanSupportTopic({ text, fallback }) {
  const value = String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return fallback;
  return value.slice(0, 255);
}
