import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublicChatFailure,
  logPublicChatFailure,
  resolvePublicChatLanguage,
} from '../services/public-chat-failure.js';

const EXPECTED_REPLIES = Object.freeze({
  tr: 'Şu anda yanıt oluştururken geçici bir sorun yaşıyorum. Lütfen kısa bir süre sonra tekrar deneyin.',
  en: "I'm having a temporary problem generating a response. Please try again shortly.",
  ar: 'أواجه مشكلة مؤقتة أثناء إنشاء الرد. يُرجى المحاولة مرة أخرى بعد قليل.',
});

test('latest customer message selects the public failure language before fallback locale', () => {
  const cases = [
    { latestMessage: 'Bağlanılamadı uyarısı alıyorum', fallbackLocale: 'en', expected: 'tr' },
    { latestMessage: 'Hello, the connection failed', fallbackLocale: 'tr', expected: 'en' },
    { latestMessage: 'أتلقى تحذيرًا بأن الاتصال فشل', fallbackLocale: 'en', expected: 'ar' },
  ];

  for (const sample of cases) {
    assert.equal(resolvePublicChatLanguage(sample), sample.expected, sample.latestMessage);
  }
});

test('ambiguous latest message uses only bounded fallback locales and otherwise defaults to English', () => {
  assert.equal(resolvePublicChatLanguage({ latestMessage: '???', fallbackLocale: 'ar' }), 'ar');
  assert.equal(resolvePublicChatLanguage({ latestMessage: '123', fallbackLocale: 'tr-TR' }), 'tr');
  assert.equal(resolvePublicChatLanguage({ latestMessage: '...', fallbackLocale: 'fr' }), 'en');
  assert.equal(resolvePublicChatLanguage({ latestMessage: '', fallbackLocale: undefined }), 'en');
});

test('public failure payload contains only a stable code and exact localized customer reply', () => {
  for (const [language, reply] of Object.entries(EXPECTED_REPLIES)) {
    assert.deepEqual(
      buildPublicChatFailure({ latestMessage: '...', fallbackLocale: language }),
      { error: 'TEMPORARY_RESPONSE_FAILURE', reply },
    );
  }
});

test('diagnostic logging normalizes provider failures without retaining raw error content', () => {
  const cases = [
    { error: Object.assign(new Error('quota body RESOURCE_EXHAUSTED'), { code: 'RESOURCE_EXHAUSTED', status: 429 }), code: 'RATE_LIMITED', status: 429 },
    { error: Object.assign(new Error('request timed out'), { name: 'AbortError' }), code: 'TIMEOUT', status: null },
    { error: Object.assign(new Error('upstream body'), { statusCode: 503 }), code: 'UPSTREAM_5XX', status: 503 },
    { error: Object.assign(new Error('bad shape'), { code: 'PROVIDER_RESPONSE_INVALID' }), code: 'INVALID_RESPONSE', status: null },
    { error: new Error('unexpected'), code: 'UNEXPECTED', status: null },
  ];

  for (const sample of cases) {
    const lines = [];
    logPublicChatFailure({
      logger: { error: (line) => lines.push(line) },
      route: '/api/chat',
      stage: 'provider_response',
      correlationId: 'req-123',
      error: sample.error,
    });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /^PUBLIC_CHAT_FAILURE route=\/api\/chat stage=provider_response correlation_id=req-123 code=[A-Z0-9_]+(?: status=\d{3})?$/);
    assert.match(lines[0], new RegExp(`code=${sample.code}(?: |$)`));
    if (sample.status) assert.match(lines[0], new RegExp(`status=${sample.status}$`));
    else assert.doesNotMatch(lines[0], / status=/);
  }
});

test('malicious provider data cannot appear in public payloads or sanitized diagnostics', () => {
  const rawSecrets = [
    'RESOURCE_EXHAUSTED',
    'AIza-secret-key',
    'stack trace line 1',
    'gemini',
    '{"quota":{"limit":0}}',
  ];
  const raw = rawSecrets.join('\n');
  const error = Object.assign(new Error(raw), {
    code: raw,
    status: 429,
    response: { data: raw },
    stack: raw,
  });
  const lines = [];

  const payload = buildPublicChatFailure({ latestMessage: 'Merhaba', fallbackLocale: 'en' });
  logPublicChatFailure({
    logger: { error: (line) => lines.push(line) },
    route: '/api/chat\nsecret=true',
    stage: 'provider\nraw_body',
    correlationId: 'req-123\nAuthorization=Bearer-secret',
    error,
  });

  const publicAndLog = `${JSON.stringify(payload)}\n${lines.join('\n')}`;
  for (const secret of rawSecrets) assert.equal(publicAndLog.includes(secret), false, secret);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('\n'), false);
});
