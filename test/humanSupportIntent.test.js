import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCustomerHumanSupportRequest } from '../services/human-support-intent.js';
import { readFileSync } from 'node:fs';

test('bare customer support request has no meaningful topic and needs no topic-summary model call', () => {
  assert.deepEqual(parseCustomerHumanSupportRequest('canlı destek'), {
    requested: true,
    hasMeaningfulContext: false,
  });
});

test('customer support request with topic permits exactly one legacy topic-summary call', () => {
  assert.deepEqual(parseCustomerHumanSupportRequest('Dubai şirket kurulumu fiyatı için canlı destek istiyorum'), {
    requested: true,
    hasMeaningfulContext: true,
  });
});

test('business topic without an explicit support request stays on the normal AI route', () => {
  assert.deepEqual(parseCustomerHumanSupportRequest('Dubai şirket kurulumu fiyatı nedir?'), {
    requested: false,
    hasMeaningfulContext: false,
  });
});


test('support request parsing is independent of the current response language', () => {
  for (const text of [
    'canlı destek istiyorum şirket kurulumu için',
    'I need live support for company setup',
    'أريد دعم مباشر بخصوص تأسيس شركة',
  ]) {
    assert.equal(parseCustomerHumanSupportRequest(text).requested, true, text);
  }
});


test('recognizes semantic Turkish and English requests for a human operator', () => {
  assert.equal(parseCustomerHumanSupportRequest('bir insanla görüşmek istiyorum').requested, true);
  assert.equal(parseCustomerHumanSupportRequest('connect me to an agent').requested, true);
  assert.equal(parseCustomerHumanSupportRequest('temsilciye bağlanmak istiyorum').requested, true);
  assert.equal(parseCustomerHumanSupportRequest('müşteri hizmetleri').requested, true);
  assert.equal(parseCustomerHumanSupportRequest('customer support').requested, true);
});

test('WhatsApp human handoff precedes provider work and optional side effects cannot block it', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const handoffStart = app.indexOf('const humanSupportRequest = parseCustomerHumanSupportRequest(text);');
  const providerStart = app.indexOf('runtime = await resolveChannelAssistantRuntime({', handoffStart);
  const handoff = app.slice(handoffStart, providerStart);
  assert.ok(handoffStart >= 0 && providerStart > handoffStart);
  assert.match(handoff, /catch\s*\{\s*activeTemplates = null;/);
  assert.match(handoff, /requestCustomerHumanSupport/);
  assert.match(handoff, /await sendMessage\(cleanFrom, acknowledgement\)/);
  assert.match(handoff, /sendMessageToTelegram\([\s\S]*?\)\.catch\(\(\) => \{\}\)/);

  const runner = readFileSync(new URL('../services/lead-qualification-runner.js', import.meta.url), 'utf8');
  assert.match(runner, /queueMicrotask\(\(\) => \{[\s\S]*?void runLeadQualification[\s\S]*?\.catch/);
});
