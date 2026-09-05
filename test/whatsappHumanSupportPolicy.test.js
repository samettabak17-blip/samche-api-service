import assert from 'node:assert/strict';
import test from 'node:test';
import { describeWhatsAppHumanSupportPolicySources, resolveWhatsAppHumanSupportPolicy } from '../services/whatsapp-human-support-policy-service.js';

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
  assert.match(policy.acknowledgement('Genel destek'), /Genel destek/);
  assert.doesNotMatch(policy.acknowledgement('Genel destek'), /SamChe/i);
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
