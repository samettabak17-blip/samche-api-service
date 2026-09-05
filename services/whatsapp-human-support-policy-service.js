function textAt(value, language) {
  const candidate = value && typeof value === 'object' && typeof value[language] === 'string'
    ? value[language].trim()
    : '';
  return candidate || null;
}

// Platform-owned neutral wording used only when an enabled WhatsApp
// integration has no historical policy record. It carries no tenant identity,
// commercial claim, or provider-specific behavior.
const PLATFORM_HUMAN_SUPPORT_TEMPLATES = Object.freeze({
  human_support: {
    general_topic: { tr: 'Genel destek', en: 'General support', ar: 'الدعم العام' },
    transfer: {
      tr: 'Canlı destek talebinizi aldık. {{topicSummary}} konusunda bir ekip üyesi yardımcı olacaktır.',
      en: 'We have received your human-support request. A team member will assist you with {{topicSummary}}.',
      ar: 'تلقينا طلبك للدعم البشري. سيساعدك أحد أعضاء الفريق بخصوص {{topicSummary}}.',
    },
  },
});

function isPlatformDefaultHandoff(templates) {
  const candidate = templates?.human_support;
  const platform = PLATFORM_HUMAN_SUPPORT_TEMPLATES.human_support;
  return ['tr', 'en', 'ar'].every((language) =>
    textAt(candidate?.general_topic, language) === platform.general_topic[language]
    && textAt(candidate?.transfer, language) === platform.transfer[language]
  );
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

function sourceAvailability(templates, language) {
  const humanSupport = templates?.human_support;
  return {
    present: Boolean(humanSupport && typeof humanSupport === 'object'),
    explicitlyDisabled: humanSupport?.enabled === false,
    usable: Boolean(policyFromTemplates(templates, language, 'DIAGNOSTIC')),
  };
}

export function describeWhatsAppHumanSupportPolicySources({ activeTemplates = null, legacyTemplates = null, language = 'en' } = {}) {
  const active = sourceAvailability(activeTemplates, language);
  const legacy = sourceAvailability(legacyTemplates, language);
  return {
    active_present: active.present,
    active_explicitly_disabled: active.explicitlyDisabled,
    active_usable: active.usable,
    legacy_present: legacy.present,
    legacy_explicitly_disabled: legacy.explicitlyDisabled,
    legacy_usable: legacy.usable,
  };
}

// ACTIVE tenant configuration is authoritative.  The legacy assistant column
// remains a scoped, read-only compatibility source until backfill completes.
export function resolveWhatsAppHumanSupportPolicy({ activeTemplates = null, legacyTemplates = null, language = 'en' } = {}) {
  if (activeTemplates?.human_support?.enabled === false || legacyTemplates?.human_support?.enabled === false) return null;
  const activePolicy = policyFromTemplates(activeTemplates, language, 'ACTIVE_CONFIGURATION');
  const legacyPolicy = policyFromTemplates(legacyTemplates, language, 'LEGACY_COMPATIBILITY');
  // An inherited platform fallback is not an explicit tenant override. Keep a
  // tenant's established wording when both records are present.
  return (activePolicy && !(legacyPolicy && isPlatformDefaultHandoff(activeTemplates)) ? activePolicy : legacyPolicy)
    ?? policyFromTemplates(PLATFORM_HUMAN_SUPPORT_TEMPLATES, language, 'PLATFORM_DEFAULT');
}

export function summarizeWhatsAppHumanSupportTopic({ text, fallback }) {
  const value = String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return fallback;
  return value.slice(0, 255);
}
