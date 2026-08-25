import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const templates = JSON.parse(readFileSync(new URL('../policies/samche-whatsapp-deterministic-responses.json', import.meta.url), 'utf8'));
const languages = ['tr', 'en', 'ar'];

function assertLanguageVariants(group, path) {
  for (const language of languages) {
    assert.equal(typeof group?.[language], 'string', path + '.' + language);
    assert.ok(group[language].trim(), path + '.' + language);
  }
}

test('every customer-visible deterministic WhatsApp template has explicit TR EN AR variants', () => {
  assertLanguageVariants(templates.first_contact, 'first_contact');
  assertLanguageVariants(templates.social.greeting, 'social.greeting');
  assertLanguageVariants(templates.social.thanks, 'social.thanks');
  for (const key of ['general_topic', 'transfer', 'manual_takeover', 'warning_5m', 'timeout_close', 'return_to_ai']) {
    assertLanguageVariants(templates.human_support[key], 'human_support.' + key);
  }
});

test('general support fallback is localized rather than leaking Turkish into English or Arabic transfer text', () => {
  assert.equal(templates.human_support.general_topic.tr, 'Genel Destek');
  assert.equal(templates.human_support.general_topic.en, 'General Support');
  assert.equal(templates.human_support.general_topic.ar, 'الدعم العام');
  assert.doesNotMatch(templates.human_support.transfer.en.replace('{{topicSummary}}', templates.human_support.general_topic.en), /Genel Destek/);
  assert.doesNotMatch(templates.human_support.transfer.ar.replace('{{topicSummary}}', templates.human_support.general_topic.ar), /Genel Destek/);
});
