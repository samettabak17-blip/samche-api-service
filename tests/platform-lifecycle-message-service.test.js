import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadPlatformLifecycleMessages,
  renderPlatformLifecycleMessage,
  resolvePlatformHumanSupportPolicy,
} from '../services/platform-lifecycle-message-service.js';

const rows = [
  ['human_support_default_topic', 'tr', 'Genel destek', []],
  ['human_support_default_topic', 'en', 'General support', []],
  ['human_support_default_topic', 'ar', 'الدعم العام', []],
  ['human_support_request', 'tr', '{TOPIC} için canlı destek talebiniz alındı.', ['TOPIC']],
  ['human_support_request', 'en', 'Your human-support request about {TOPIC} was received.', ['TOPIC']],
  ['human_support_request', 'ar', 'تم استلام طلب الدعم البشري بخصوص {TOPIC}.', ['TOPIC']],
  ['human_session_warning', 'tr', 'Canlı destek oturumu yakında sona erecek.', []],
  ['human_session_warning', 'en', 'The human-support session will end soon.', []],
  ['human_session_warning', 'ar', 'ستنتهي جلسة الدعم البشري قريبًا.', []],
  ['human_takeover', 'tr', 'Canlı temsilci konuşmayı devraldı.', []],
  ['human_takeover', 'en', 'A human representative has taken over.', []],
  ['human_takeover', 'ar', 'تولى ممثل بشري المحادثة.', []],
  ['return_to_ai', 'tr', 'AI asistanıyla devam edebilirsiniz.', []],
  ['return_to_ai', 'en', 'You may continue with the AI assistant.', []],
  ['return_to_ai', 'ar', 'يمكنك المتابعة مع مساعد الذكاء الاصطناعي.', []],
].map(([message_key, locale, body, allowed_variables]) => ({ message_key, locale, body, allowed_variables }));

function databaseWith(templateRows = rows) {
  return {
    async query(sql) {
      assert.match(sql, /FROM platform_lifecycle_message_templates/);
      return { rowCount: templateRows.length, rows: templateRows };
    },
  };
}

test('loads one complete DB-backed TR EN AR authority for fixed lifecycle messages', async () => {
  const templates = await loadPlatformLifecycleMessages({ database: databaseWith() });
  assert.equal(templates.human_takeover.tr.body, 'Canlı temsilci konuşmayı devraldı.');
  assert.equal(templates.return_to_ai.ar.body, 'يمكنك المتابعة مع مساعد الذكاء الاصطناعي.');
});

test('unsupported locale falls back to English and only approved TOPIC is interpolated', async () => {
  const templates = await loadPlatformLifecycleMessages({ database: databaseWith() });
  assert.equal(
    renderPlatformLifecycleMessage({ templates, key: 'human_support_request', locale: 'de', variables: { TOPIC: 'pricing' } }),
    'Your human-support request about pricing was received.',
  );
  assert.throws(
    () => renderPlatformLifecycleMessage({ templates, key: 'human_support_request', locale: 'en', variables: { TENANT: 'forbidden' } }),
    /PLATFORM_LIFECYCLE_VARIABLE_INVALID/,
  );
});

test('human-support policy is built only from canonical DB rows', async () => {
  const policy = await resolvePlatformHumanSupportPolicy({ database: databaseWith(), locale: 'tr' });
  assert.equal(policy.source, 'PLATFORM_DATABASE');
  assert.equal(policy.defaultTopic, 'Genel destek');
  assert.equal(policy.acknowledgement('sipariş'), 'sipariş için canlı destek talebiniz alındı.');
  assert.equal(policy.lifecycleMessage('human_takeover'), 'Canlı temsilci konuşmayı devraldı.');
});

test('missing locale or lifecycle key fails closed instead of selecting another authority', async () => {
  await assert.rejects(
    () => loadPlatformLifecycleMessages({ database: databaseWith(rows.filter((row) => !(row.message_key === 'return_to_ai' && row.locale === 'ar'))) }),
    /PLATFORM_LIFECYCLE_TEMPLATE_INCOMPLETE/,
  );
});
