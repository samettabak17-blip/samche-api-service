import { parseCustomerHumanSupportRequest } from './human-support-intent.js';

function textAt(value, language) {
  const candidate = value && typeof value === 'object' && typeof value[language] === 'string'
    ? value[language].trim()
    : '';
  return candidate || null;
}

// Platform-owned deterministic wording used only when an enabled WhatsApp
// integration has no historical policy record. It carries no tenant identity,
// commercial claim, or provider-specific behavior.
const PLATFORM_HUMAN_SUPPORT_TEMPLATES = Object.freeze({
  human_support: {
    general_topic: { tr: 'Genel destek', en: 'General support', ar: 'الدعم العام' },
    transfer: {
      tr: 'Canlı temsilci ile görüşme ilgili talebinizi aldım. {{topicSummary}} konusuyla ilgili size en doğru desteği sağlayabilmek için sizi canlı müşteri temsilcimize aktarıyorum.\n\nTalebiniz işlem sırasına alınacak, en kısa süre içinde canlı müşteri temsilcimize bağlanacaksınız.\n\nMüşteri temsilcimize bağlanırken lütfen beklemede kalın ⌛️.\n\n🔒 Bu sohbet oturumu sona ermiştir.\n\nBaşka sorularınız varsa veya ek yardıma ihtiyacınız olursa, lütfen istediğiniz zaman tekrar bizimle iletişime geçmekten çekinmeyin. Canlı Destek Ekibimiz size yardımcı olmaktan mutluluk duyacaktır.',
      en: 'I have received your request to speak with a live representative. Regarding {{topicSummary}}, I am transferring you to our live customer representative to provide the most accurate support.\n\nYour request has been queued, and you will be connected to our live customer representative as soon as possible.\n\nPlease stay on hold while we connect you ⌛️.\n\n🔒 This chat session has ended.\n\nIf you have further questions or need additional assistance, please feel free to reach out again anytime. Our Live Support Team will be happy to assist you.',
      ar: 'لقد تلقيت طلبك للتحدث مع ممثل مباشر. بخصوص {{topicSummary}}، أقوم بتحويلك إلى ممثل خدمة العملاء المباشر لدينا لتقديم الدعم الأنسب لك.\n\nسيتم وضع طلبك في قائمة الانتظار، وسيتم توصيلك بممثلنا المباشر في أقرب وقت ممكن.\n\nيرجى البقاء على الخط أثناء الاتصال بممثل خدمة العملاء لدينا ⌛️.\n\n🔒 انتهت جلسة الدردشة هذه.\n\nإذا كانت لديك أسئلة أخرى أو احتجت إلى مساعدة إضافية، فلا تتردد في الاتصال بنا مرة أخرى في أي وقت. سيسعد فريق الدعم المباشر لدينا بمساعدتك.',
    },
  },
});

// This is the exact short-lived platform fallback introduced by migration 062.
// It is intentionally recognized as inherited policy, not tenant-authored copy.
const INHERITED_GENERIC_HANDOFF = Object.freeze({
  general_topic: { tr: 'Genel destek', en: 'General support', ar: 'الدعم العام' },
  transfer: {
    tr: 'Canlı destek talebinizi aldık. {{topicSummary}} konusunda bir ekip üyesi yardımcı olacaktır.',
    en: 'We have received your human-support request. A team member will assist you with {{topicSummary}}.',
    ar: 'تلقينا طلبك للدعم البشري. سيساعدك أحد أعضاء الفريق بخصوص {{topicSummary}}.',
  },
});

function isInheritedGenericHandoff(templates) {
  const candidate = templates?.human_support;
  const platform = INHERITED_GENERIC_HANDOFF;
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
  // The migration fallback is not tenant-authored wording regardless of which
  // compatibility boundary supplied it. Keep only established tenant policy.
  return (activePolicy && !isInheritedGenericHandoff(activeTemplates) ? activePolicy : null)
    ?? (legacyPolicy && !isInheritedGenericHandoff(legacyTemplates) ? legacyPolicy : null)
    ?? policyFromTemplates(PLATFORM_HUMAN_SUPPORT_TEMPLATES, language, 'PLATFORM_DEFAULT');
}

function topicText(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
}

export function summarizeWhatsAppHumanSupportTopic({ text, conversationHistory = [], fallback }) {
  const current = topicText(text);
  const request = parseCustomerHumanSupportRequest(current);
  if (current && (!request.requested || request.hasMeaningfulContext)) return current;
  for (const message of [...conversationHistory].reverse()) {
    if (!['CUSTOMER', 'USER'].includes(String(message?.sender_type ?? message?.role ?? '').toUpperCase())) continue;
    const candidate = topicText(message?.content ?? message?.text);
    if (candidate && !parseCustomerHumanSupportRequest(candidate).requested) return candidate;
  }
  return topicText(fallback) || null;
}
