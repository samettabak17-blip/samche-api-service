import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWhatsAppHumanSupportPolicy } from '../services/whatsapp-human-support-policy-service.js';

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

test('fails closed for incomplete policy instead of inventing tenant wording', () => {
  assert.equal(resolveWhatsAppHumanSupportPolicy({ activeTemplates: { human_support: { transfer: { en: 'x' } } }, legacyTemplates: null, language: 'en' }), null);
});
