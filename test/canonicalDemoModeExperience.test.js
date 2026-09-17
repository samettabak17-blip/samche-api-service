import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDemoEntryIntent,
  normalizeDemoModeConfig,
  formatWhatsAppDemoIntroduction,
  formatWebChatDemoWelcome,
  formatGuideDemoWelcome,
  buildDemoRuntimeGuidance,
} from '../services/tenant-demo-mode-service.js';
import {
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';
import {
  planWhatsAppDeterministicSocialResponse,
} from '../services/whatsapp-deterministic-social-response-service.js';
import {
  buildWhatsAppActivePersonaTenantContext,
} from '../services/whatsapp-tenant-context-service.js';

test('1. demo-enabled tenant receives demo introduction on WhatsApp', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
    business_context: 'For this demonstration, Blue Dune represents an event management company.',
  });
  assert.equal(demoConfig.enabled, true);

  const introEn = formatWhatsAppDemoIntroduction({ demoMode: demoConfig, language: 'en' });
  assert.ok(introEn.includes('Welcome to the SamChe AI Demo'));
  assert.ok(introEn.includes('Blue Dune AI'));
  assert.ok(introEn.includes('event management company'));
  assert.ok(introEn.includes("I'm planning a corporate event for 150 guests in Dubai. Can you help?"));

  const tenantContext = {
    companyName: 'Blue Dune',
    assistantName: 'Blue Dune AI',
    demoMode: demoConfig,
    deterministicTemplates: { first_contact: { en: 'Hello' } },
  };

  const plan = planWhatsAppDeterministicSocialResponse({
    tenant: tenantContext,
    communicationLanguage: 'en',
    currentInboundMessage: 'Hello, I would like to try the SamChe AI demo.',
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: true,
  });

  assert.ok(plan);
  assert.equal(plan.kind, 'DEMO_ENTRY_INTRODUCTION');
  assert.equal(plan.shouldInvokeGemini, false);
  assert.ok(plan.content.includes('Welcome to the SamChe AI Demo'));
  assert.ok(plan.content.includes('Blue Dune AI'));
});
test('1b. demo-entry intent activates even in ongoing conversation (firstAssistantResponse: false)', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
    business_context: 'For this demonstration, Blue Dune represents an event management company.',
  });

  const tenantContext = {
    companyName: 'Blue Dune',
    assistantName: 'Blue Dune AI',
    demoMode: demoConfig,
    deterministicTemplates: { first_contact: { en: 'Hello' } },
  };

  const plan = planWhatsAppDeterministicSocialResponse({
    tenant: tenantContext,
    communicationLanguage: 'en',
    currentInboundMessage: 'Hello, I would like to try the SamChe AI demo.',
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: false,
  });

  assert.ok(plan);
  assert.equal(plan.kind, 'DEMO_ENTRY_INTRODUCTION');
  assert.equal(plan.shouldInvokeGemini, false);
  assert.ok(plan.content.includes('Welcome to the SamChe AI Demo'));
  assert.ok(plan.content.includes('Blue Dune AI'));
});


test('2. demo-disabled tenant does NOT mention SamChe', () => {
  const disabledConfig = normalizeDemoModeConfig({ enabled: false });
  assert.equal(disabledConfig.enabled, false);

  const nullIntro = formatWhatsAppDemoIntroduction({ demoMode: disabledConfig, language: 'en' });
  assert.equal(nullIntro, null);

  const nullWebChat = formatWebChatDemoWelcome({ demoMode: disabledConfig, language: 'en' });
  assert.equal(nullWebChat, null);

  const nullGuide = formatGuideDemoWelcome({ demoMode: disabledConfig, language: 'en' });
  assert.equal(nullGuide, null);

  const tenantContext = {
    companyName: 'Acme Logistics',
    assistantName: 'Acme Concierge',
    demoMode: disabledConfig,
    deterministicTemplates: {
      first_contact: { en: "Hello, I'm {{assistantName}} for {{companyName}}." },
      social: { greeting: { en: 'Hello! How can I help you today?' } },
    },
  };

  // When customer says demo-entry phrase to a non-demo tenant, it must NOT return demo intro
  const planDemoPhrase = planWhatsAppDeterministicSocialResponse({
    tenant: tenantContext,
    communicationLanguage: 'en',
    currentInboundMessage: 'Hello, I would like to try the SamChe AI demo.',
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: true,
  });
  // Topic-present without demo-mode enabled proceeds to normal business path (null deterministic response)
  assert.equal(planDemoPhrase, null);

  // Normal greeting returns white-label greeting without mentioning SamChe
  const planGreeting = planWhatsAppDeterministicSocialResponse({
    tenant: tenantContext,
    communicationLanguage: 'en',
    currentInboundMessage: 'Hello',
    currentIntent: 'GREETING_ONLY',
    firstAssistantResponse: true,
  });
  assert.ok(planGreeting);
  assert.equal(planGreeting.kind, 'FIRST_CONTACT_GREETING');
  assert.ok(!planGreeting.content.toLowerCase().includes('samche'));
  assert.ok(planGreeting.content.includes('Acme Concierge'));
  assert.ok(planGreeting.content.includes('Acme Logistics'));
});


test('3. WhatsApp demo-entry intent works without exact-string dependency', () => {
  // English variations
  assert.equal(isDemoEntryIntent('Hello, I would like to try the SamChe AI demo.'), true);
  assert.equal(isDemoEntryIntent('I want to try the demo'), true);
  assert.equal(isDemoEntryIntent('Can I test SamChe AI?'), true);
  assert.equal(isDemoEntryIntent("I'd like to see the WhatsApp demo"), true);
  assert.equal(isDemoEntryIntent('SamChe AI demo'), true);
  assert.equal(isDemoEntryIntent('try demo'), true);
  assert.equal(isDemoEntryIntent('can i try the demo please?'), true);
  assert.equal(isDemoEntryIntent('test demo'), true);

  // Turkish variations
  assert.equal(isDemoEntryIntent('SamChe AI demosunu denemek istiyorum'), true);
  assert.equal(isDemoEntryIntent('Demoyu denemek istiyorum'), true);
  assert.equal(isDemoEntryIntent('Demoyu test edebilir miyim?'), true);
  assert.equal(isDemoEntryIntent('WhatsApp demosunu görmek istiyorum'), true);
  assert.equal(isDemoEntryIntent('SamChe AI demo'), true);
  assert.equal(isDemoEntryIntent('demoyu dene'), true);
  assert.equal(isDemoEntryIntent('demo testi'), true);

  // Arabic variations
  assert.equal(isDemoEntryIntent('مرحباً، أود تجربة عرض SamChe AI التجريبي'), true);
  assert.equal(isDemoEntryIntent('أريد تجربة العرض التجريبي'), true);
  assert.equal(isDemoEntryIntent('هل يمكنني اختبار SamChe AI؟'), true);
  assert.equal(isDemoEntryIntent('عرض تجريبي'), true);
  assert.equal(isDemoEntryIntent('تجربة الديمو'), true);

  // Negative tests (regular business inquiries must NOT match demo entry intent)
  assert.equal(isDemoEntryIntent("I'm planning a corporate event for 150 guests in Dubai. Can you help?"), false);
  assert.equal(isDemoEntryIntent('What services do you offer?'), false);
  assert.equal(isDemoEntryIntent('How much is the deposit?'), false);
  assert.equal(isDemoEntryIntent('I have a problem with my booking'), false);
  assert.equal(isDemoEntryIntent('Can I speak with a human?'), false);
  assert.equal(isDemoEntryIntent('Hello'), false);
  assert.equal(isDemoEntryIntent('Teşekkürler'), false);
  assert.equal(isDemoEntryIntent('شكراً'), false);
});

test('4. EN demo introduction correct', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
    business_context: 'For this demonstration, Blue Dune represents an event management company.',
  });

  const intro = formatWhatsAppDemoIntroduction({ demoMode: demoConfig, language: 'en' });
  assert.ok(intro.startsWith('Welcome to the SamChe AI Demo.'));
  assert.ok(intro.includes("You're now interacting with Blue Dune AI"));
  assert.ok(intro.includes('powered by the SamChe AI platform.'));
  assert.ok(intro.includes('Blue Dune represents an event management company.'));
  assert.ok(intro.includes('Try asking:'));
  assert.ok(intro.includes('• "I\'m planning a corporate event for 150 guests in Dubai. Can you help?"'));
  assert.ok(intro.includes('• "I need help choosing the right event service."'));
  assert.ok(intro.includes('• "I have a problem with an existing booking."'));
  assert.ok(intro.includes('• "I want to speak to a human."'));
});

test('5. TR demo introduction correct', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
    business_context: 'Bu tanıtım için Blue Dune bir etkinlik yönetimi şirketini temsil etmektedir.',
  });

  const intro = formatWhatsAppDemoIntroduction({ demoMode: demoConfig, language: 'tr' });
  assert.ok(intro.startsWith('SamChe AI Demosuna Hoş Geldiniz.'));
  assert.ok(intro.includes('Blue Dune AI ile iletişimdesiniz.'));
  assert.ok(intro.includes('SamChe AI platformu tarafından desteklenen'));
  assert.ok(intro.includes('Blue Dune bir etkinlik yönetimi şirketini temsil etmektedir.'));
  assert.ok(intro.includes('Örnek olarak şunları deneyebilirsiniz:'));
  assert.ok(intro.includes('• "Dubai\'de 150 kişilik bir kurumsal etkinlik planlıyorum. Yardımcı olabilir misiniz?"'));
  assert.ok(intro.includes('• "Doğru etkinlik hizmetini seçmek için yardıma ihtiyacım var."'));
  assert.ok(intro.includes('• "Mevcut bir rezervasyonumla ilgili bir sorunum var."'));
  assert.ok(intro.includes('• "Bir insan yetkiliyle görüşmek istiyorum."'));
});

test('6. AR demo introduction correct', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
    business_context: 'في هذا العرض التجريبي، يمثل Blue Dune شركة لإدارة الفعاليات.',
  });

  const intro = formatWhatsAppDemoIntroduction({ demoMode: demoConfig, language: 'ar' });
  assert.ok(intro.startsWith('مرحباً بكم في عرض SamChe AI التجريبي.'));
  assert.ok(intro.includes('Blue Dune AI'));
  assert.ok(intro.includes('مدعومة بمنصة SamChe AI.'));
  assert.ok(intro.includes('يمثل Blue Dune شركة لإدارة الفعاليات.'));
  assert.ok(intro.includes('جرّب السؤال عن:'));
  assert.ok(intro.includes('• "أخطط لتنظيم فعالية للشركات لـ 150 ضيفاً في دبي. هل يمكنك المساعدة؟"'));
  assert.ok(intro.includes('• "أحتاج إلى مساعدة في اختيار خدمة الفعاليات المناسبة."'));
  assert.ok(intro.includes('• "لدي مشكلة في حجز حالي."'));
  assert.ok(intro.includes('• "أريد التحدث مع موظف بشري."'));
});

test('7. Blue Dune transition after intro uses Blue Dune persona and runtime guidance', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
    business_context: 'For this demonstration, Blue Dune represents an event management company.',
  });

  const tenantContext = {
    companyName: 'Blue Dune',
    assistantName: 'Blue Dune AI',
    demoMode: demoConfig,
    deterministicTemplates: { first_contact: { en: 'Hello' } },
  };

  // Turn 1: Customer sends demo entry
  const turn1Plan = planWhatsAppDeterministicSocialResponse({
    tenant: tenantContext,
    communicationLanguage: 'en',
    currentInboundMessage: 'Hello, I would like to try the SamChe AI demo.',
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: true,
  });
  assert.equal(turn1Plan.kind, 'DEMO_ENTRY_INTRODUCTION');

  // Turn 2: Customer asks a business event question
  const turn2Plan = planWhatsAppDeterministicSocialResponse({
    tenant: tenantContext,
    communicationLanguage: 'en',
    currentInboundMessage: "I'm planning a corporate event for 150 guests in Dubai. Can you help?",
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: false,
  });
  // Proceeds to Blue Dune AI LLM generation
  assert.equal(turn2Plan, null);

  // Runtime system instruction contains operating guidance
  const persona = {
    available: true,
    companyIdentity: 'Blue Dune',
    assistantIdentity: 'Blue Dune AI',
    demoMode: demoConfig,
    profile: { company_display_name: 'Blue Dune', industry: 'Event Management' },
    configuration: { assistant_identity: 'Blue Dune AI' },
  };

  const sysInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Lead time: 10 business days. Deposit: 40%.',
  });

  assert.ok(sysInstruction.includes('RUNTIME IDENTITY: You are Blue Dune AI, the AI assistant for Blue Dune.'));
  assert.ok(sysInstruction.includes('DEMO MODE OPERATING INSTRUCTION:'));
  assert.ok(sysInstruction.includes('Do NOT repeat or advertise SamChe AI branding in your ongoing business answers'));
});

test('8. tenant Business Profile/Knowledge remains authoritative in demo mode', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
  });

  const persona = {
    available: true,
    companyIdentity: 'Blue Dune Event Management LLC',
    assistantIdentity: 'Blue Dune AI Assistant',
    demoMode: demoConfig,
    profile: {
      company_display_name: 'Blue Dune Event Management LLC',
      policies: 'Deposit 40% required. Minimum lead time 10 business days.',
      procedures: 'Falcon Gate Protocol escalation after 2 hours.',
    },
    configuration: {
      assistant_identity: 'Blue Dune AI Assistant',
      customer_handling: 'Provide concierge event coordination.',
    },
  };

  const instruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Catering is coordinated exclusively through approved third-party vendors.',
  });

  assert.ok(instruction.includes('TENANT-SPECIFIC FACTUAL GROUNDING POLICY'));
  assert.ok(instruction.includes('Deposit 40% required'));
  assert.ok(instruction.includes('Falcon Gate Protocol'));
  assert.ok(instruction.includes('Catering is coordinated exclusively through approved third-party vendors.'));
});


test('9. WebChat welcome state uses generic demo configuration', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
  });

  const welcomeEn = formatWebChatDemoWelcome({ demoMode: demoConfig, language: 'en' });
  assert.equal(welcomeEn.welcome_title, 'Welcome to the SamChe AI Demo');
  assert.ok(welcomeEn.welcome_message.includes('Welcome to the SamChe AI Demo.'));
  assert.ok(welcomeEn.welcome_message.includes('experience Blue Dune AI — an event management assistant powered by SamChe AI.'));
  assert.ok(welcomeEn.welcome_message.includes('Try interacting with it just like a real customer.'));
  assert.deepEqual(welcomeEn.chips, ['Plan an Event', 'Ask About Services', 'Try Customer Support', 'Request a Human']);

  const welcomeTr = formatWebChatDemoWelcome({ demoMode: demoConfig, language: 'tr' });
  assert.equal(welcomeTr.welcome_title, 'SamChe AI Demosuna Hoş Geldiniz');
  assert.ok(welcomeTr.welcome_message.includes('SamChe AI Demosuna Hoş Geldiniz.'));
  assert.ok(welcomeTr.welcome_message.includes('Blue Dune AI'));
  assert.deepEqual(welcomeTr.chips, ['Etkinlik Planla', 'Hizmetleri Öğren', 'Müşteri Desteği', 'Yetkiliye Bağlan']);

  const welcomeAr = formatWebChatDemoWelcome({ demoMode: demoConfig, language: 'ar' });
  assert.equal(welcomeAr.welcome_title, 'مرحباً بكم في عرض SamChe AI التجريبي');
  assert.ok(welcomeAr.welcome_message.includes('Blue Dune AI'));
  assert.deepEqual(welcomeAr.chips, ['تخطيط فعالية', 'الاستفسar عن الخدمات'.replace('ar', 'ار'), 'تجربة الدعم الفني', 'طلب موظف']);
});

test('10. AI Guide welcome state uses generic demo configuration', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
  });

  const guideEn = formatGuideDemoWelcome({ demoMode: demoConfig, language: 'en' });
  assert.equal(guideEn.welcome_title, 'Welcome to the SamChe AI Demo');
  assert.ok(guideEn.welcome_message.includes('SamChe AI Demo'));
  assert.ok(guideEn.welcome_message.includes('Blue Dune AI — an event management guide powered by SamChe AI'));
  assert.equal(guideEn.hero_title, 'Welcome to the SamChe AI Demo');

  const guideTr = formatGuideDemoWelcome({ demoMode: demoConfig, language: 'tr' });
  assert.equal(guideTr.welcome_title, 'SamChe AI Demosuna Hoş Geldiniz');
  assert.ok(guideTr.welcome_message.includes('Blue Dune AI'));

  const guideAr = formatGuideDemoWelcome({ demoMode: demoConfig, language: 'ar' });
  assert.equal(guideAr.welcome_title, 'مرحباً بكم في عرض SamChe AI التجريبي');
  assert.ok(guideAr.welcome_message.includes('Blue Dune AI'));
});


test('11. future generic demo tenant can use different industry/scenarios without code changes', () => {
  // Real estate demo tenant
  const realEstateDemo = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'MARQAS Real Estate',
    business_type: 'luxury property brokerage',
    business_context: 'For this demonstration, MARQAS represents a luxury real estate brokerage in Dubai.',
    scenarios: [
      { id: 'find_property', label: 'Find a Property', prompt: 'I want to invest in a 2-bedroom apartment in Downtown Dubai.' },
      { id: 'compare_projects', label: 'Compare Projects', prompt: 'Can you compare luxury waterfront developments?' },
      { id: 'investment_faq', label: 'Ask an Investment Question', prompt: 'What are the expected rental yields in Dubai Marina?' },
      { id: 'human_agent', label: 'Request an Agent', prompt: 'I want to speak with an investment consultant.' },
    ],
  });

  const reWhatsApp = formatWhatsAppDemoIntroduction({ demoMode: realEstateDemo, language: 'en' });
  assert.ok(reWhatsApp.includes('MARQAS Real Estate AI'));
  assert.ok(reWhatsApp.includes('luxury real estate brokerage in Dubai'));
  assert.ok(reWhatsApp.includes('I want to invest in a 2-bedroom apartment in Downtown Dubai.'));
  assert.ok(reWhatsApp.includes('Downtown Dubai'));

  const reWebChat = formatWebChatDemoWelcome({ demoMode: realEstateDemo, language: 'en' });
  assert.deepEqual(reWebChat.chips, ['Find a Property', 'Compare Projects', 'Ask an Investment Question', 'Request an Agent']);

  // E-commerce demo tenant
  const ecommerceDemo = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'TrendVault',
    business_type: 'online retail store',
    business_context: 'For this demonstration, TrendVault represents a high-growth fashion e-commerce brand.',
    scenarios: [
      { id: 'product_search', label: 'Find a Product', prompt: 'Show me trending summer jackets.' },
      { id: 'order_status', label: 'Track My Order', prompt: 'Where is order #94821?' },
      { id: 'returns_policy', label: 'Return Policy', prompt: 'How do I return an item?' },
      { id: 'live_agent', label: 'Request a Human', prompt: 'Connect me to support.' },
    ],
  });

  const ecWhatsApp = formatWhatsAppDemoIntroduction({ demoMode: ecommerceDemo, language: 'en' });
  assert.ok(ecWhatsApp.includes('TrendVault AI'));
  assert.ok(ecWhatsApp.includes('fashion e-commerce brand'));
  assert.ok(ecWhatsApp.includes('Show me trending summer jackets.'));

  const ecWebChat = formatWebChatDemoWelcome({ demoMode: ecommerceDemo, language: 'en' });
  assert.deepEqual(ecWebChat.chips, ['Find a Product', 'Track My Order', 'Return Policy', 'Request a Human']);
});

test('12. no cross-tenant demo configuration leakage', () => {
  const tenantDemo = normalizeDemoModeConfig({
    enabled: true,
    business_name: 'Blue Dune',
  });

  const tenantNormal = normalizeDemoModeConfig({
    enabled: false,
  });

  assert.equal(tenantDemo.enabled, true);
  assert.equal(tenantNormal.enabled, false);

  const demoContext = {
    companyName: 'Blue Dune',
    assistantName: 'Blue Dune AI',
    demoMode: tenantDemo,
    deterministicTemplates: { first_contact: { en: 'Hello' } },
  };

  const normalContext = {
    companyName: 'ClientCo',
    assistantName: 'ClientCo Bot',
    demoMode: tenantNormal,
    deterministicTemplates: {
      first_contact: { en: 'Hello from {{companyName}}' },
    },
  };

  // Demo tenant gets demo introduction
  const demoPlan = planWhatsAppDeterministicSocialResponse({
    tenant: demoContext,
    communicationLanguage: 'en',
    currentInboundMessage: 'Hello, I would like to try the SamChe AI demo.',
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: true,
  });
  assert.ok(demoPlan);
  assert.equal(demoPlan.kind, 'DEMO_ENTRY_INTRODUCTION');

  // Normal tenant under identical input never gets demo intro or SamChe branding
  const normalPlan = planWhatsAppDeterministicSocialResponse({
    tenant: normalContext,
    communicationLanguage: 'en',
    currentInboundMessage: 'Hello, I would like to try the SamChe AI demo.',
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: true,
  });
  assert.equal(normalPlan, null);
});

test('17. human handoff remains functional in demo mode', () => {
  const demoConfig = normalizeDemoModeConfig({
    enabled: true,
    platform_name: 'SamChe AI',
    business_name: 'Blue Dune',
  });

  // When customer asks for a human, it does NOT trigger demo entry
  const isDemo = isDemoEntryIntent('I want to speak to a human');
  assert.equal(isDemo, false);

  const isDemoTr = isDemoEntryIntent('Yetkiliye bağlanmak istiyorum');
  assert.equal(isDemoTr, false);

  const isDemoAr = isDemoEntryIntent('أريد التحدث مع موظف بشري');
  assert.equal(isDemoAr, false);
});


