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
test('canonical human-support acknowledgement communicates request, handoff, and team assistance across TR EN AR without topic injection', async () => {
  const canonicalRows = [
    ['human_support_default_topic', 'tr', 'Genel Destek', []],
    ['human_support_default_topic', 'en', 'General Support', []],
    ['human_support_default_topic', 'ar', 'الدعم العام', []],
    ['human_support_request', 'tr', `Canlı temsilci ile görüşme ilgili talebinizi aldım. Genel Destek konusuyla ilgili size en doğru desteği sağlayabilmek için sizi canlı müşteri temsilcimize aktarıyorum.
Talebiniz işlem sırasına alınacak, en kısa süre içinde canlı müşteri temsilcimize bağlanacaksınız.
Müşteri temsilcimize bağlanırken lütfen beklemede kalın ⏳.`, []],
    ['human_support_request', 'en', `I have received your request to speak with a live representative. In order to provide you with the most accurate support regarding General Support, I am transferring you to our live customer representative.
Your request will be queued, and you will be connected to our live customer representative shortly.
Please stay on the line while connecting to our representative ⏳.`, []],
    ['human_support_request', 'ar', `لقد تلقيت طلبك للتحدث مع ممثل مباشر. لنقدم لك الدعم الأنسب بخصوص الدعم العام، أقوم بتحويلك إلى ممثل خدمة العملاء المباشر لدينا.
سيتم وضع طلبك في قائمة الانتظار، وسيتم ربطك بممثل خدمة العملاء المباشر في أقرب وقت.
يرجى البقاء على اتصال أثناء الاتصال بممثلنا ⏳.`, []],
    ['human_session_warning', 'tr', 'Canlı destek talebiniz açık. Beklerken bu konuşmaya mesaj göndererek oturumu aktif tutabilirsiniz.', []],
    ['human_session_warning', 'en', 'Your live support request is open. You can send messages to this conversation while waiting to keep the session active.', []],
    ['human_session_warning', 'ar', 'طلب الدعم المباشر الخاص بك مفتوح. يمكنك إرسال رسائل في هذه المحادثة أثناء الانتظار للحفاظ على الجلسة نشطة.', []],
    ['human_takeover', 'tr', `DİKKAT ⚠️ Canlı temsilcimiz bu konuşmayı devralmıştır. Lütfen sohbete bağlanana kadar beklemede kalın ⏳

⚠️ Canlı temsilcimiz bu konuşmayı sonlandırmadığı sürece yapay zeka danışmanı devre dışıdır. 🔒`, []],
    ['human_takeover', 'en', `ATTENTION ⚠️ Our live representative has taken over this conversation. Please stay on the line until connected ⏳

⚠️ As long as our live representative does not end this conversation, the AI consultant is disabled. 🔒`, []],
    ['human_takeover', 'ar', `تنبيه ⚠️ تولى ممثلنا المباشر هذه المحادثة. يرجى البقاء على اتصال حتى يتم الربط ⏳

⚠️ طالما لم يقم ممثلنا المباشر بإنهاء هذه المحادثة، فإن المستشار الذكي معطل. 🔒`, []],
    ['return_to_ai', 'tr', `🔒 Canlı destek oturumu sona ermiştir.

Yapay zeka asistanımızla sohbete devam edebilir ya da canlı temsilciye tekrar bağlanmak isterseniz sohbet alanına 'canlı destek' yazmanız yeterlidir.
Ekibimiz size her zaman yardımcı olmaktan mutluluk duyacaktır.`, []],
    ['return_to_ai', 'en', `🔒 The live support session has ended.

You may continue chatting with our AI assistant, or if you wish to connect to a live representative again, simply type 'live support' in the chat.
Our team is always happy to assist you.`, []],
    ['return_to_ai', 'ar', `🔒 انتهت جلسة الدعم المباشر.

يمكنك متابعة الدردشة مع مساعد الذكاء الاصطناعي، أو إذا كنت ترغب في الاتصال بممثل مباشر مرة أخرى، فما عليك سوى كتابة 'دعم مباشر' في الدردشة.
يسعد فريقنا دائمًا بمساعدتك.`, []],
  ].map(([message_key, locale, body, allowed_variables]) => ({ message_key, locale, body, allowed_variables }));

  const trPolicy = await resolvePlatformHumanSupportPolicy({ database: databaseWith(canonicalRows), locale: 'tr' });
  const trAck = trPolicy.acknowledgement();
  assert.equal(trAck, `Canlı temsilci ile görüşme ilgili talebinizi aldım. Genel Destek konusuyla ilgili size en doğru desteği sağlayabilmek için sizi canlı müşteri temsilcimize aktarıyorum.
Talebiniz işlem sırasına alınacak, en kısa süre içinde canlı müşteri temsilcimize bağlanacaksınız.
Müşteri temsilcimize bağlanırken lütfen beklemede kalın ⏳.`);

  const enPolicy = await resolvePlatformHumanSupportPolicy({ database: databaseWith(canonicalRows), locale: 'en' });
  const enAck = enPolicy.acknowledgement('landscape planning');
  assert.equal(enAck, `I have received your request to speak with a live representative. In order to provide you with the most accurate support regarding General Support, I am transferring you to our live customer representative.
Your request will be queued, and you will be connected to our live customer representative shortly.
Please stay on the line while connecting to our representative ⏳.`);
  assert.doesNotMatch(enAck, /landscape planning/);

  const arPolicy = await resolvePlatformHumanSupportPolicy({ database: databaseWith(canonicalRows), locale: 'ar' });
  const arAck = arPolicy.acknowledgement();
  assert.match(arAck, /لقد تلقيت طلبك للتحدث مع ممثل مباشر/);
  assert.match(arAck, /الدعم العام/);
});

