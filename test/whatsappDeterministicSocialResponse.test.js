import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planWhatsAppDeterministicSocialResponse } from '../services/whatsapp-deterministic-social-response-service.js';
import { classifyWhatsAppCurrentCustomerIntent } from '../services/whatsapp-tenant-context-service.js';

const templates = {
  first_contact: {
    tr: 'Merhaba, ben {{assistantName}}.\n\n{{companyName}} için buradayım.',
    en: 'Hello, I\'m {{assistantName}}.\n\nI am here for {{companyName}}.',
    ar: 'مرحبًا، أنا {{assistantName}}.\n\nأنا هنا لمساعدة {{companyName}}.',
  },
  social: {
    greeting: { tr: 'Merhaba, size nasıl yardımcı olabilirim?', en: 'Hello, how may I assist you?', ar: 'مرحبًا، كيف يمكنني مساعدتك؟' },
    thanks: { tr: 'Rica ederim. Başka bir konuda yardımcı olmamı isterseniz buradayım.', en: 'You are welcome. I am here if you need anything else.', ar: 'على الرحب والسعة. أنا هنا إذا احتجت إلى أي مساعدة أخرى.' },
  },
};

const tenant = {
  companyName: 'Example Company LLC',
  assistantName: 'Example AI',
  deterministicTemplates: templates,
};

test('new Turkish greeting returns the full tenant-configured welcome without Gemini', () => {
  const plan = planWhatsAppDeterministicSocialResponse({
    tenant,
    communicationLanguage: 'tr',
    currentInboundMessage: 'Merhaba',
    currentIntent: 'GREETING_ONLY',
    firstAssistantResponse: true,
  });

  assert.equal(plan.kind, 'FIRST_CONTACT_GREETING');
  assert.equal(plan.shouldInvokeGemini, false);
  assert.equal(plan.content, 'Merhaba, ben Example AI.\n\nExample Company LLC için buradayım.');
});

test('new English and Arabic greetings use configured zero-token welcome templates', () => {
  for (const language of ['en', 'ar']) {
    const plan = planWhatsAppDeterministicSocialResponse({
      tenant,
      communicationLanguage: language,
      currentIntent: 'GREETING_ONLY',
      firstAssistantResponse: true,
    });
    assert.equal(plan.kind, 'FIRST_CONTACT_GREETING');
    assert.equal(plan.shouldInvokeGemini, false);
    assert.match(plan.content, /Example AI/);
    assert.match(plan.content, /Example Company LLC/);
  }
});

test('a first message with a meaningful topic stays on the Gemini path', () => {
  const plan = planWhatsAppDeterministicSocialResponse({
    tenant,
    communicationLanguage: 'tr',
    currentIntent: 'TOPIC_PRESENT',
    firstAssistantResponse: true,
  });

  assert.equal(plan, null);
});

test('later social-only messages use short zero-token templates without repeating identity', () => {
  const greeting = planWhatsAppDeterministicSocialResponse({
    tenant,
    communicationLanguage: 'tr',
    currentIntent: 'GREETING_ONLY',
    firstAssistantResponse: false,
  });
  const thanks = planWhatsAppDeterministicSocialResponse({
    tenant,
    communicationLanguage: 'tr',
    currentIntent: 'THANKS_ONLY',
    firstAssistantResponse: false,
  });

  assert.equal(greeting.kind, 'SOCIAL_GREETING');
  assert.equal(greeting.shouldInvokeGemini, false);
  assert.doesNotMatch(greeting.content, /Example AI|Example Company LLC/);
  assert.equal(thanks.kind, 'SOCIAL_THANKS');
  assert.equal(thanks.shouldInvokeGemini, false);
});

test('a tenant without deterministic templates cannot receive another tenant response', () => {
  const plan = planWhatsAppDeterministicSocialResponse({
    tenant: { companyName: 'Tenant B LLC', assistantName: 'Tenant B AI', deterministicTemplates: null },
    communicationLanguage: 'tr',
    currentIntent: 'GREETING_ONLY',
    firstAssistantResponse: true,
  });

  assert.equal(plan, null);
});

test('SamChe WhatsApp first-contact template renders the approved Turkish welcome exactly', () => {
  const samcheTemplates = JSON.parse(
    readFileSync(new URL('../policies/samche-whatsapp-deterministic-responses.json', import.meta.url), 'utf8')
  );
  const plan = planWhatsAppDeterministicSocialResponse({
    tenant: {
      companyName: 'SamChe Company LLC',
      assistantName: 'SamChe AI',
      deterministicTemplates: samcheTemplates,
    },
    communicationLanguage: 'tr',
    currentInboundMessage: 'Merhaba',
    currentIntent: 'GREETING_ONLY',
    firstAssistantResponse: true,
  });

  assert.equal(plan.content, `Merhaba, ben SamChe AI.

SamChe Company LLC'nin yapay zeka destekli danışmanıyım ve size yardımcı olmak için buradayım.

Dubai’de şirket kuruluşu, iş planları, iş geliştirme, dijital büyüme, yapay zeka çözümleri, oturum seçenekleri, yaşam maliyetleri ve şirket kuruluşu sonrasında sunduğumuz hizmetler ile ilgili tüm sorularınızı yanıtlayabilirim. Size nasıl yardımcı olabilirim?`);
});

test('the live WhatsApp path returns after guarded deterministic delivery before entering the substantive model path', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const deterministicBranch = app.indexOf('const deterministicSocialResponse = planWhatsAppDeterministicSocialResponse');
  const substantiveModelBranch = app.indexOf("logWhatsAppTiming('model_request_started')");

  assert.ok(deterministicBranch >= 0);
  assert.ok(substantiveModelBranch > deterministicBranch);
  const deterministicSource = app.slice(deterministicBranch, substantiveModelBranch);
  assert.match(deterministicSource, /await persistAndSendWhatsAppAssistant\(whatsappInbox, cleanFrom, deterministicSocialResponse\.content\)/);
  assert.match(deterministicSource, /model_invoked=0/);
  assert.match(deterministicSource, /return;/);
  assert.doesNotMatch(deterministicSource, /LANGUAGE_COMPLIANCE_RETRY/);
});

test('the persisted first-contact decision uses only current knowledge-authority history', () => {
  const inbox = readFileSync(new URL('../services/whatsapp-live-inbox-service.js', import.meta.url), 'utf8');

  assert.match(inbox, /loadCurrentProviderHistory\(client/);
  assert.match(inbox, /assistantId:\s*knowledgeAuthority\?\.assistantId/);
  assert.match(inbox, /version:\s*knowledgeAuthority\?\.version/);
  assert.match(inbox, /isFirstAssistantResponse\s*=\s*!conversationHistory\.some\(\(message\) => message\.sender_type === 'ASSISTANT'\)/);
  assert.doesNotMatch(inbox, /SELECT EXISTS\(\s*SELECT 1\s*FROM conversation_messages/s);
});



test('a later Arabic greeting is zero-token social handling and never repeats the full first-contact identity', () => {
  const plan = planWhatsAppDeterministicSocialResponse({
    tenant,
    communicationLanguage: 'ar',
    currentIntent: 'GREETING_ONLY',
    firstAssistantResponse: false,
  });

  assert.equal(plan.kind, 'SOCIAL_GREETING');
  assert.equal(plan.shouldInvokeGemini, false);
  assert.doesNotMatch(plan.content, /Example AI|Example Company LLC/);
});

test('clear language changes do not alter persisted first-response semantics', () => {
  for (const language of ['tr', 'en', 'ar']) {
    const plan = planWhatsAppDeterministicSocialResponse({
      tenant,
      communicationLanguage: language,
      currentIntent: 'GREETING_ONLY',
      firstAssistantResponse: false,
    });
    assert.equal(plan.kind, 'SOCIAL_GREETING');
    assert.equal(plan.shouldInvokeGemini, false);
  }
});


test('deterministic templates use the recognized current inbound language, never stale substantive history', () => {
  const cases = [
    ['tr', 'Hi', 'GREETING_ONLY', 'en'], ['tr', 'Hello', 'GREETING_ONLY', 'en'], ['tr', 'Hola', 'GREETING_ONLY', 'en'],
    ['ar', 'Bonjour', 'GREETING_ONLY', 'en'], ['en', 'Merhaba', 'GREETING_ONLY', 'tr'], ['es', 'mrb', 'GREETING_ONLY', 'tr'],
    ['en', 'مرحبا', 'GREETING_ONLY', 'ar'], ['tr', 'Thanks', 'THANKS_ONLY', 'en'], ['tr', 'Gracias', 'THANKS_ONLY', 'en'],
    ['ar', 'Merci', 'THANKS_ONLY', 'en'], ['en', 'Teşekkür ederim', 'THANKS_ONLY', 'tr'], ['en', 'شكرا', 'THANKS_ONLY', 'ar'],
  ];
  for (const [history, inbound, currentIntent, expected] of cases) {
    const plan = planWhatsAppDeterministicSocialResponse({
      tenant,
      communicationLanguage: history,
      currentInboundMessage: inbound,
      currentIntent,
      firstAssistantResponse: false,
    });
    assert.equal(plan.shouldInvokeGemini, false, inbound);
    assert.equal(
      plan.content,
      templates.social[currentIntent === 'THANKS_ONLY' ? 'thanks' : 'greeting'][expected],
      inbound,
    );
  }
});


test('recognizes non-Turkish/non-Arabic deterministic social variants before the substantive model path', () => {
  for (const value of ['hola', 'bonjour', 'hallo', 'ciao', 'thanks', 'gracias', 'merci', 'danke']) {
    assert.notEqual(classifyWhatsAppCurrentCustomerIntent(value), 'TOPIC_PRESENT', value);
  }
});

test('hola uses the English zero-token template even after Arabic history', () => {
  const plan = planWhatsAppDeterministicSocialResponse({
    tenant,
    communicationLanguage: 'ar',
    currentInboundMessage: 'hola',
    currentIntent: 'GREETING_ONLY',
    firstAssistantResponse: false,
  });
  assert.equal(plan.content, templates.social.greeting.en);
  assert.equal(plan.shouldInvokeGemini, false);
});
