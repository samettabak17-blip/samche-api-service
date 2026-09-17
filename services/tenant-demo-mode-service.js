import { normalizeCommunicationLanguage } from './conversation-communication-language.js';

/**
 * services/tenant-demo-mode-service.js
 * Generic tenant-configured demo mode service.
 * Supports cross-channel demo experiences across WhatsApp, WebChat, and AI Guide.
 * Pure white-label by default; SamChe demo context is activated strictly when
 * demo_mode.enabled === true for the tenant.
 */

const DEFAULT_PLATFORM_NAME = 'SamChe AI';

const DEMO_KEYWORDS_EN = /\b(?:demo|demonstration|test|sample|trial)\b/i;
const DEMO_TRY_VERBS_EN = /\b(?:try|test|see|experience|start|explore|sample|check\s*out|show\s*me)\b/i;
const PLATFORM_NAME_REGEX = /samche(?:\s*ai)?/i;

const DEMO_KEYWORDS_TR = /\b(?:demo|demoyu|demosu|demosunu|deneme|tanıtım|tanitim)\b/i;
const DEMO_TRY_VERBS_TR = /\b(?:dene|denemek|denemek\s*istiyorum|test|görmek|gormek|başla|basla|incele)\b/i;

const DEMO_KEYWORDS_AR = /(?:ديمو|تجريب(?:ي|ية)?|عرض\s*تجريبي|نسخة\s*تجريبية)/u;
const DEMO_TRY_VERBS_AR = /(?:تجرب(?:ة|تها)|أريد\s*تجربة|اريد\s*تجربة|اختبار|مشاهد(?:ة)?|استكشاف)/u;

/**
 * Checks whether an inbound customer text expresses intent to test/start the demo.
 * Uses a fast, non-LLM, zero-token regex evaluation across EN, TR, AR.
 */
export function isDemoEntryIntent(customerText) {
  if (typeof customerText !== 'string') return false;
  const text = customerText.trim().toLowerCase();
  if (!text) return false;

  // SamChe mention combined with demo or test
  if (PLATFORM_NAME_REGEX.test(text)) {
    if (DEMO_KEYWORDS_EN.test(text) || DEMO_TRY_VERBS_EN.test(text) ||
        DEMO_KEYWORDS_TR.test(text) || DEMO_TRY_VERBS_TR.test(text) ||
        DEMO_KEYWORDS_AR.test(text) || DEMO_TRY_VERBS_AR.test(text)) {
      return true;
    }
  }

  // English demo-entry variations
  if (DEMO_KEYWORDS_EN.test(text) && (DEMO_TRY_VERBS_EN.test(text) || /\b(?:can\s*i|would\s*like|want\s*to|i'd\s*like|please|how\s*to)\b/i.test(text))) {
    return true;
  }
  if (/^(?:hello\s*,?\s*)?(?:(?:i\s*(?:would\s*like|want)\s*to\s*(?:try|see|test)|can\s*i\s*(?:try|test|see))\s*(?:the\s*)?(?:samche\s*(?:ai\s*)?)?(?:whatsapp\s*)?demo[\s!.,?:;]*)$/i.test(text)) {
    return true;
  }
  if (/^(?:samche\s*(?:ai\s*)?demo|try\s*(?:the\s*)?demo|test\s*(?:the\s*)?demo|whatsapp\s*demo|demo\s*mode|demo[\s!.,?:;]*)$/i.test(text)) {
    return true;
  }

  // Turkish demo-entry variations
  if (DEMO_KEYWORDS_TR.test(text) && (DEMO_TRY_VERBS_TR.test(text) || /\b(?:istiyorum|edebilir\s*miyim|görebilir\s*miyim|lütfen)\b/i.test(text))) {
    return true;
  }
  if (/^(?:merhaba\s*,?\s*)?(?:(?:samche\s*(?:ai\s*)?)?(?:whatsapp\s*)?demosunu\s*(?:denemek|test\s*etmek|görmek)\s*istiyorum[\s!.,?:;]*)$/i.test(text)) {
    return true;
  }
  if (/^(?:samche\s*(?:ai\s*)?demo|demo\s*dene|demoyu\s*dene|demo\s*testi|whatsapp\s*demosu|demo[\s!.,?:;]*)$/i.test(text)) {
    return true;
  }

  // Arabic demo-entry variations
  if (DEMO_KEYWORDS_AR.test(text) && (DEMO_TRY_VERBS_AR.test(text) || /(?:أود|اريد|هل\s*يمكنني|من\s*فضلك|لو\s*سمحت)/u.test(text))) {
    return true;
  }
  if (/^(?:مرحب(?:اً|ا)\s*،?\s*)?(?:(?:أود|اريد|أريد)\s*تجرب(?:ة|تها)\s*(?:عرض\s*)?(?:samche|سامتشي)?\s*(?:ai\s*)?(?:التجريبي|الديمو)[\s!.,?:;]*)$/iu.test(text)) {
    return true;
  }
  if (/^(?:عرض\s*تجريبي|تجربة\s*الديمو|تجربة\s*العرض|ديمو|samche\s*demo[\s!.,?:;]*)$/iu.test(text)) {
    return true;
  }

  return false;
}


/**
 * Normalizes generic demo-mode configuration.
 * Respects strict tenant isolation and white-label by returning { enabled: false }
 * whenever demo_mode is not explicitly enabled.
 */
export function normalizeDemoModeConfig(rawDemoMode, tenantProfile = null, assistantConfig = null) {
  if (!rawDemoMode || rawDemoMode.enabled !== true) {
    return { enabled: false };
  }

  const platformName = typeof rawDemoMode.platform_name === 'string' && rawDemoMode.platform_name.trim()
    ? rawDemoMode.platform_name.trim()
    : DEFAULT_PLATFORM_NAME;

  const businessName = typeof rawDemoMode.business_name === 'string' && rawDemoMode.business_name.trim()
    ? rawDemoMode.business_name.trim()
    : (tenantProfile?.company_display_name || tenantProfile?.company_identity || assistantConfig?.assistant_identity || 'Demo Business');

  const businessType = typeof rawDemoMode.business_type === 'string' && rawDemoMode.business_type.trim()
    ? rawDemoMode.business_type.trim()
    : (tenantProfile?.industry || tenantProfile?.business_type || 'business');

  const businessContext = typeof rawDemoMode.business_context === 'string' && rawDemoMode.business_context.trim()
    ? rawDemoMode.business_context.trim()
    : `For this demonstration, ${businessName} represents an event management company.`;

  const disclosure = typeof rawDemoMode.disclosure === 'string' && rawDemoMode.disclosure.trim()
    ? rawDemoMode.disclosure.trim()
    : `This is a demonstration experience powered by ${platformName}.`;

  const transitionBehavior = typeof rawDemoMode.transition_behavior === 'string' && rawDemoMode.transition_behavior.trim()
    ? rawDemoMode.transition_behavior.trim()
    : 'continue_as_tenant_assistant';

  const rawScenarios = Array.isArray(rawDemoMode.scenarios) ? rawDemoMode.scenarios : null;
  const scenarios = rawScenarios && rawScenarios.length > 0
    ? rawScenarios.map((s, idx) => ({
        id: String(s?.id || `scenario_${idx + 1}`).trim(),
        label: String(s?.label || s?.prompt || `Scenario ${idx + 1}`).trim(),
        prompt: String(s?.prompt || s?.label || '').trim(),
      })).filter((s) => s.label && s.prompt)
    : [
        {
          id: 'plan_event',
          label: 'Plan an Event',
          prompt: "I'm planning a corporate event for 150 guests in Dubai. Can you help?",
        },
        {
          id: 'ask_services',
          label: 'Ask About Services',
          prompt: 'I need help choosing the right event service.',
        },
        {
          id: 'customer_support',
          label: 'Try Customer Support',
          prompt: 'I have a problem with an existing booking.',
        },
        {
          id: 'request_human',
          label: 'Request a Human',
          prompt: 'I want to speak to a human.',
        },
      ];

  const translations = rawDemoMode.translations && typeof rawDemoMode.translations === 'object'
    ? rawDemoMode.translations
    : {};

  return {
    enabled: true,
    platform_name: platformName,
    business_name: businessName,
    business_type: businessType,
    business_context: businessContext,
    disclosure,
    transition_behavior: transitionBehavior,
    scenarios,
    translations,
  };
}

/**
 * Formats canonical WhatsApp demo introduction for the given language (en, tr, ar).
 */
export function formatWhatsAppDemoIntroduction({ demoMode, language = 'en' }) {
  if (!demoMode?.enabled) return null;

  const lang = normalizeCommunicationLanguage(language) || 'en';
  const custom = demoMode.translations?.[lang];
  const businessName = demoMode.business_name;
  const platformName = demoMode.platform_name || DEFAULT_PLATFORM_NAME;

  if (lang === 'tr') {
    if (typeof custom?.whatsapp_intro === 'string' && custom.whatsapp_intro.trim()) {
      return custom.whatsapp_intro.trim();
    }
    const scenarios = Array.isArray(custom?.scenarios) && custom.scenarios.length > 0
      ? custom.scenarios
      : [
          { label: 'Etkinlik Planla', prompt: "Dubai'de 150 kişilik bir kurumsal etkinlik planlıyorum. Yardımcı olabilir misiniz?" },
          { label: 'Hizmetleri Öğren', prompt: 'Doğru etkinlik hizmetini seçmek için yardıma ihtiyacım var.' },
          { label: 'Müşteri Desteği', prompt: 'Mevcut bir rezervasyonumla ilgili bir sorunum var.' },
          { label: 'Yetkiliye Bağlan', prompt: 'Bir insan yetkiliyle görüşmek istiyorum.' },
        ];
    const scenarioLines = scenarios.map((s) => `• "${s.prompt || s.label}"`).join('\n');
    const contextLine = demoMode.business_context || `Bu tanıtım için ${businessName} bir etkinlik yönetimi şirketini temsil etmektedir.`;
    return [
      `${platformName} Demosuna Hoş Geldiniz.`,
      `Şu anda ${platformName} platformu tarafından desteklenen demo işletme deneyimi ${businessName} AI ile iletişimdesiniz.`,
      contextLine,
      `Yapay zekanın iş sorularını yanıtlama, müşteri niyetini anlama, uygun hizmetleri önerme, potansiyel müşterileri niteleme, destek görüşmelerini yönetme ve gerektiğinde insan desteğine aktarma yeteneklerini deneyimleyebilirsiniz.`,
      `Örnek olarak şunları deneyebilirsiniz:\n${scenarioLines}`,
    ].join('\n\n');
  }

  if (lang === 'ar') {
    if (typeof custom?.whatsapp_intro === 'string' && custom.whatsapp_intro.trim()) {
      return custom.whatsapp_intro.trim();
    }
    const scenarios = Array.isArray(custom?.scenarios) && custom.scenarios.length > 0
      ? custom.scenarios
      : [
          { label: 'تخطيط فعالية', prompt: 'أخطط لتنظيم فعالية للشركات لـ 150 ضيفاً في دبي. هل يمكنك المساعدة؟' },
          { label: 'الاستفسار عن الخدمات', prompt: 'أحتاج إلى مساعدة في اختيار خدمة الفعاليات المناسبة.' },
          { label: 'تجربة الدعم الفني', prompt: 'لدي مشكلة في حجز حالي.' },
          { label: 'طلب موظف', prompt: 'أريد التحدث مع موظف بشري.' },
        ];
    const scenarioLines = scenarios.map((s) => `• "${s.prompt || s.label}"`).join('\n');
    const contextLine = demoMode.business_context || `في هذا العرض التجريبي، يمثل ${businessName} شركة لإدارة الفعاليات.`;

    return [
      `مرحباً بكم في عرض ${platformName} التجريبي.`,
      `أنت تتفاعل الآن مع ${businessName} AI، تجربة أعمال توضيحية مدعومة بمنصة ${platformName}.`,
      contextLine,
      `يمكنك تجربة كيفية إجابة الذكاء الاصطناعي على أسئلة الأعمال، وفهم نية العميل، والتوصية بالخدمات المناسبة، وتأهيل العملاء المحتملين، وإدارة محادثات الدعم، والتحويل إلى المساعدة البشرية عند الحاجة.`,
      `جرّب السؤال عن:\n${scenarioLines}`,
    ].join('\n\n');
  }

  // Default to English
  if (typeof custom?.whatsapp_intro === 'string' && custom.whatsapp_intro.trim()) {
    return custom.whatsapp_intro.trim();
  }
  const scenarios = Array.isArray(custom?.scenarios) && custom.scenarios.length > 0
    ? custom.scenarios
    : (demoMode.scenarios || [
        { label: 'Plan an Event', prompt: "I'm planning a corporate event for 150 guests in Dubai. Can you help?" },
        { label: 'Ask About Services', prompt: 'I need help choosing the right event service.' },
        { label: 'Try Customer Support', prompt: 'I have a problem with an existing booking.' },
        { label: 'Request a Human', prompt: 'I want to speak to a human.' },
      ]);
  const scenarioLines = scenarios.map((s) => `• "${s.prompt || s.label}"`).join('\n');
  const contextLine = demoMode.business_context || `For this demonstration, ${businessName} represents an event management company.`;

  return [
    `Welcome to the ${platformName} Demo.`,
    `You're now interacting with ${businessName} AI, a demo business experience powered by the ${platformName} platform.`,
    contextLine,
    `You can experience how the AI can answer business questions, understand customer intent, recommend suitable services, qualify potential leads, handle support conversations, and transition to human assistance when needed.`,
    `Try asking:\n${scenarioLines}`,
  ].join('\n\n');
}

/**
 * Formats canonical WebChat demo welcome experience.
 * Returns { welcome_title, welcome_message, chips }.
 */
export function formatWebChatDemoWelcome({ demoMode, language = 'en' }) {
  if (!demoMode?.enabled) return null;

  const lang = normalizeCommunicationLanguage(language) || 'en';
  const custom = demoMode.translations?.[lang];
  const businessName = demoMode.business_name;
  const platformName = demoMode.platform_name || DEFAULT_PLATFORM_NAME;

  if (lang === 'tr') {
    const welcomeTitle = custom?.welcome_title || `${platformName} Demosuna Hoş Geldiniz`;
    const welcomeMessage = custom?.webchat_welcome || [
      `${platformName} Demosuna Hoş Geldiniz.`,
      `${platformName} tarafından desteklenen etkinlik yönetimi asistanı ${businessName} AI deneyimine başlamak üzeresiniz.`,
      `Gerçek bir müşteri gibi etkileşim kurmayı deneyin.`,
    ].join('\n\n');
    const chips = Array.isArray(custom?.chips) && custom.chips.length > 0
      ? custom.chips
      : ['Etkinlik Planla', 'Hizmetleri Öğren', 'Müşteri Desteği', 'Yetkiliye Bağlan'];
    return { welcome_title: welcomeTitle, welcome_message: welcomeMessage, chips };
  }

  if (lang === 'ar') {
    const welcomeTitle = custom?.welcome_title || `مرحباً بكم في عرض ${platformName} التجريبي`;
    const welcomeMessage = custom?.webchat_welcome || [
      `مرحباً بكم في عرض ${platformName} التجريبي.`,
      `أنت على وشك تجربة ${businessName} AI — مساعد إدارة الفعاليات المدعوم بـ ${platformName}.`,
      `جرّب التفاعل معه تماماً كعميل حقيقي.`,
    ].join('\n\n');
    const chips = Array.isArray(custom?.chips) && custom.chips.length > 0
      ? custom.chips
      : ['تخطيط فعالية', 'الاستفسار عن الخدمات', 'تجربة الدعم الفني', 'طلب موظف'];
    return { welcome_title: welcomeTitle, welcome_message: welcomeMessage, chips };
  }

  // Default to English
  const welcomeTitle = custom?.welcome_title || `Welcome to the ${platformName} Demo`;
  const welcomeMessage = custom?.webchat_welcome || [
    `Welcome to the ${platformName} Demo.`,
    `You're about to experience ${businessName} AI — an event management assistant powered by ${platformName}.`,
    `Try interacting with it just like a real customer.`,
  ].join('\n\n');
  const chips = Array.isArray(custom?.chips) && custom.chips.length > 0
    ? custom.chips
    : (demoMode.scenarios?.map((s) => s.label) || ['Plan an Event', 'Ask About Services', 'Try Customer Support', 'Request a Human']);
  return { welcome_title: welcomeTitle, welcome_message: welcomeMessage, chips };
}

/**
 * Formats canonical AI Guide demo welcome experience.
 * Returns { welcome_title, welcome_message, hero_title, hero_message }.
 */
export function formatGuideDemoWelcome({ demoMode, language = 'en' }) {
  if (!demoMode?.enabled) return null;

  const lang = normalizeCommunicationLanguage(language) || 'en';
  const custom = demoMode.translations?.[lang];
  const businessName = demoMode.business_name;
  const platformName = demoMode.platform_name || DEFAULT_PLATFORM_NAME;

  if (lang === 'tr') {
    const title = custom?.welcome_title || `${platformName} Demosuna Hoş Geldiniz`;
    const message = custom?.guide_welcome ||
      `${platformName} Demosuna Hoş Geldiniz. ${platformName} tarafından desteklenen etkinlik yönetimi rehberi ${businessName} AI'ı inceliyorsunuz. Bu tanıtım, ${platformName}'ın bir etkinlik yönetimi işletmesi için nasıl yapılandırılabileceğini gösterir. Sorular sorun, planlama seçeneklerini keşfedin veya etkileşimli araçları deneyin.`;
    return { welcome_title: title, welcome_message: message, hero_title: title, hero_message: message };
  }

  if (lang === 'ar') {
    const title = custom?.welcome_title || `مرحباً بكم في عرض ${platformName} التجريبي`;
    const message = custom?.guide_welcome ||
      `مرحباً بكم في عرض ${platformName} التجريبي. أنت تستكشف ${businessName} AI — دليل إدارة الفعاليات المدعوم بـ ${platformName}. يوضح هذا العرض التجريبي كيفية تكوين ${platformName} لشركة إدارة فعاليات. اطرح الأسئلة، واستكشف خيارات التخطيط، أو جرب الأدوات التفاعلية.`;
    return { welcome_title: title, welcome_message: message, hero_title: title, hero_message: message };
  }

  // Default to English
  const title = custom?.welcome_title || `Welcome to the ${platformName} Demo`;
  const message = custom?.guide_welcome ||
    `Welcome to the ${platformName} Demo. You're exploring ${businessName} AI — an event management guide powered by ${platformName}. This demonstration shows how ${platformName} can be configured for an event management business. Ask questions, explore planning options, or try the interactive tools.`;
  return { welcome_title: title, welcome_message: message, hero_title: title, hero_message: message };
}

/**
 * Builds demo-mode runtime guidance instruction for LLM system prompt.
 * Directs model to respond authoritatively as the tenant assistant after initial demo introduction.
 */
export function buildDemoRuntimeGuidance({ demoMode, companyIdentity }) {
  if (!demoMode?.enabled) return '';
  const platformName = demoMode.platform_name || DEFAULT_PLATFORM_NAME;
  const businessName = companyIdentity || demoMode.business_name || 'the business';

  return [
    `DEMO MODE OPERATING INSTRUCTION:`,
    `This assistant is operating in demonstration mode on the ${platformName} platform for ${businessName}.`,
    `The initial demo context and disclosure have already been established with the visitor.`,
    `In all subsequent responses, act naturally, professionally, and authoritatively as the AI assistant for ${businessName}.`,
    `Do NOT repeat or advertise ${platformName} branding in your ongoing business answers; demonstrate the platform's intelligence through grounded, professional customer service, qualification, and helpful recommendations based strictly on the active Business Profile and approved Knowledge.`,
  ].join('\n');
}


