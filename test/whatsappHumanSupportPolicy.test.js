import assert from 'node:assert/strict';
import test from 'node:test';
import { describeWhatsAppHumanSupportPolicySources, resolveWhatsAppHumanSupportPolicy, summarizeWhatsAppHumanSupportTopic } from '../services/whatsapp-human-support-policy-service.js';

const legacy = {
  human_support: {
    general_topic: { en: 'General support', tr: 'Genel destek' },
    transfer: { en: 'A colleague will help with {{topicSummary}}.', tr: '{{topicSummary}} için bir temsilci yardımcı olacak.' },
  },
};

test('uses an active channel handoff policy before its compatible legacy template', () => {
  const active = { human_support: { general_topic: { en: 'Active support' }, transfer: { en: 'Active {{topicSummary}}' } } };
  const policy = resolveWhatsAppHumanSupportPolicy({ activeTemplates: active, legacyTemplates: legacy, language: 'en' });
  assert.equal(policy.source, 'ACTIVE_CONFIGURATION');
  assert.equal(policy.acknowledgement('Topic'), 'Active Topic');
});

test('keeps an existing tenant handoff available when an active channel template is absent', () => {
  const policy = resolveWhatsAppHumanSupportPolicy({ activeTemplates: null, legacyTemplates: legacy, language: 'tr' });
  assert.equal(policy.source, 'LEGACY_COMPATIBILITY');
  assert.equal(policy.defaultTopic, 'Genel destek');
  assert.equal(policy.acknowledgement('Konu'), 'Konu için bir temsilci yardımcı olacak.');
});

test('keeps a valid historical acknowledgement ahead of an inherited generic active fallback', () => {
  const inheritedFallback = {
    human_support: {
      general_topic: { tr: 'Genel destek', en: 'General support', ar: 'الدعم العام' },
      transfer: {
        tr: 'Canlı destek talebinizi aldık. {{topicSummary}} konusunda bir ekip üyesi yardımcı olacaktır.',
        en: 'We have received your human-support request. A team member will assist you with {{topicSummary}}.',
        ar: 'تلقينا طلبك للدعم البشري. سيساعدك أحد أعضاء الفريق بخصوص {{topicSummary}}.',
      },
    },
  };
  const policy = resolveWhatsAppHumanSupportPolicy({ activeTemplates: inheritedFallback, legacyTemplates: legacy, language: 'tr' });
  assert.equal(policy.source, 'LEGACY_COMPATIBILITY');
  assert.equal(policy.acknowledgement('Konu'), 'Konu için bir temsilci yardımcı olacak.');
});

test('does not select the introduced generic fallback when it arrives through the legacy compatibility source', () => {
  const inheritedFallback = {
    human_support: {
      general_topic: { tr: 'Genel destek', en: 'General support', ar: 'الدعم العام' },
      transfer: {
        tr: 'Canlı destek talebinizi aldık. {{topicSummary}} konusunda bir ekip üyesi yardımcı olacaktır.',
        en: 'We have received your human-support request. A team member will assist you with {{topicSummary}}.',
        ar: 'تلقينا طلبك للدعم البشري. سيساعدك أحد أعضاء الفريق بخصوص {{topicSummary}}.',
      },
    },
  };
  const policy = resolveWhatsAppHumanSupportPolicy({ activeTemplates: null, legacyTemplates: inheritedFallback, language: 'tr' });
  assert.equal(policy.source, 'PLATFORM_DEFAULT');
  assert.match(policy.acknowledgement('şirket kuruluşu'), /Talebiniz işlem sırasına alınacak/);
});

test('uses one configured legacy language when the preferred language is absent', () => {
  const turkishOnlyLegacy = {
    human_support: {
      general_topic: { tr: 'Genel destek' },
      transfer: { tr: '{{topicSummary}} için bir temsilci yardımcı olacak.' },
    },
  };
  const policy = resolveWhatsAppHumanSupportPolicy({ activeTemplates: null, legacyTemplates: turkishOnlyLegacy, language: 'en' });
  assert.equal(policy.source, 'LEGACY_COMPATIBILITY');
  assert.equal(policy.language, 'tr');
  assert.equal(policy.acknowledgement('Konu'), 'Konu için bir temsilci yardımcı olacak.');
});

test('uses the neutral platform policy when a legacy policy is incomplete', () => {
  const policy = resolveWhatsAppHumanSupportPolicy({ activeTemplates: { human_support: { transfer: { en: 'x' } } }, legacyTemplates: null, language: 'en' });
  assert.equal(policy.source, 'PLATFORM_DEFAULT');
  assert.doesNotMatch(policy.acknowledgement('support'), /SamChe/i);
});

test('an explicit ACTIVE human-support disable remains authoritative over legacy compatibility data', () => {
  const legacy = {
    human_support: {
      general_topic: { tr: 'Destek talebi' },
      transfer: { tr: 'Ekibimiz {{topicSummary}} için sizinle ilgilenecek.' },
    },
  };
  assert.equal(resolveWhatsAppHumanSupportPolicy({
    activeTemplates: { human_support: { enabled: false } },
    legacyTemplates: legacy,
    language: 'tr',
  }), null);
});

test('uses the generic platform handoff policy when an enabled integration has no historical policy record', () => {
  const policy = resolveWhatsAppHumanSupportPolicy({ activeTemplates: null, legacyTemplates: null, language: 'tr' });
  assert.equal(policy.source, 'PLATFORM_DEFAULT');
  assert.equal(policy.language, 'tr');
  assert.match(policy.acknowledgement('şirket kuruluşu'), /Canlı temsilci ile görüşme ilgili talebinizi aldım/);
  assert.match(policy.acknowledgement('şirket kuruluşu'), /şirket kuruluşu konusuyla ilgili/);
  assert.match(policy.acknowledgement('şirket kuruluşu'), /Talebiniz işlem sırasına alınacak/);
  assert.match(policy.acknowledgement('şirket kuruluşu'), /beklemede kalın/);
  assert.doesNotMatch(policy.acknowledgement('şirket kuruluşu'), /Bu sohbet oturumu sona ermiştir/);
  assert.doesNotMatch(policy.acknowledgement('Genel destek'), /SamChe/i);
});

test('platform lifecycle messages are separate deterministic localized events with English fallback', () => {
  const tr = resolveWhatsAppHumanSupportPolicy({ activeTemplates: null, legacyTemplates: null, language: 'tr' });
  const ar = resolveWhatsAppHumanSupportPolicy({ activeTemplates: null, legacyTemplates: null, language: 'ar' });
  const unsupported = resolveWhatsAppHumanSupportPolicy({ activeTemplates: null, legacyTemplates: null, language: 'de' });

  assert.match(tr.lifecycleMessage('human_support_request', 'Nişan organizasyonu'), /Nişan organizasyonu konusuyla ilgili/);
  assert.doesNotMatch(tr.lifecycleMessage('human_support_request', 'Nişan organizasyonu'), /Bu sohbet oturumu sona ermiştir/);
  assert.match(tr.lifecycleMessage('human_session_warning'), /5 dakika sonra sona erecektir/);
  assert.match(tr.lifecycleMessage('human_takeover'), /konuşmayı devralmıştır/);
  assert.match(tr.lifecycleMessage('return_to_ai'), /Bu sohbet oturumu sona ermiştir/);
  assert.match(ar.lifecycleMessage('human_takeover'), /الدردشة|المحادثة/);
  assert.match(unsupported.lifecycleMessage('return_to_ai'), /chat session has ended/i);
});

test('uses the most recent known customer topic when the human request itself has no topic', () => {
  const topic = summarizeWhatsAppHumanSupportTopic({
    text: 'canlı destek istiyorum',
    conversationHistory: [
      { sender_type: 'CUSTOMER', content: 'Şirket kuruluşu hakkında bilgi almak istiyorum.' },
      { sender_type: 'ASSISTANT', content: 'Size yardımcı olabilirim.' },
      { sender_type: 'CUSTOMER', content: 'canlı destek istiyorum' },
    ],
    fallback: 'Genel destek',
  });
  assert.equal(topic, 'Şirket kuruluşu hakkında bilgi almak istiyorum.');
});

test('uses the safe configured fallback without inventing a topic when no customer topic exists', () => {
  assert.equal(summarizeWhatsAppHumanSupportTopic({
    text: 'canlı destek istiyorum', conversationHistory: [], fallback: 'Genel destek',
  }), 'Genel destek');
});

test('reports only safe policy-source availability metadata', () => {
  assert.deepEqual(describeWhatsAppHumanSupportPolicySources({ activeTemplates: null, legacyTemplates: legacy, language: 'tr' }), {
    active_present: false,
    active_explicitly_disabled: false,
    active_usable: false,
    legacy_present: true,
    legacy_explicitly_disabled: false,
    legacy_usable: true,
  });
});
