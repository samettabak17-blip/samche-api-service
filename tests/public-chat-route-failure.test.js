process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ||= 'test-jwt-secret-at-least-32-chars-long';
process.env.OPENAI_API_KEY ||= 'test-openai-key';
process.env.GEMINI_API_KEY ||= 'test-gemini-key';
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { app, chatPostHandler } = await import('../app.js');

const REPLIES = Object.freeze({
  tr: 'Şu anda yanıt oluştururken geçici bir sorun yaşıyorum. Lütfen kısa bir süre sonra tekrar deneyin.',
  en: "I'm having a temporary problem generating a response. Please try again shortly.",
  ar: 'أواجه مشكلة مؤقتة أثناء إنشاء الرد. يُرجى المحاولة مرة أخرى بعد قليل.',
});

function providerError({ message, code, status, name }) {
  const error = new Error(message);
  if (code) error.code = code;
  if (status) error.status = status;
  if (name) error.name = name;
  error.response = { data: { raw: message } };
  return error;
}

test('/api/chat contains quota, timeout, 5xx, malformed, and unexpected failures with latest-message localization', async () => {
  const cases = [
    {
      name: 'quota',
      message: 'Bağlanılamadı uyarısı alıyorum',
      reply: REPLIES.tr,
      result: () => { throw providerError({ message: 'RAW_QUOTA RESOURCE_EXHAUSTED', code: 'RESOURCE_EXHAUSTED', status: 429 }); },
      forbidden: 'RAW_QUOTA',
    },
    {
      name: 'timeout',
      message: 'I am getting a connection failed warning',
      reply: REPLIES.en,
      result: () => { throw providerError({ message: 'RAW_TIMEOUT_BODY', name: 'AbortError' }); },
      forbidden: 'RAW_TIMEOUT_BODY',
    },
    {
      name: 'provider 5xx',
      message: 'أتلقى تحذيرًا بأن الاتصال تعذر',
      reply: REPLIES.ar,
      result: () => { throw providerError({ message: 'RAW_UPSTREAM_503', status: 503 }); },
      forbidden: 'RAW_UPSTREAM_503',
    },
    {
      name: 'malformed response',
      message: 'Hello, the connection failed',
      reply: REPLIES.en,
      result: () => ({ choices: [] }),
      forbidden: 'choices',
    },
    {
      name: 'unexpected exception',
      message: 'Bir sorun yaşıyorum',
      reply: REPLIES.tr,
      result: () => { throw providerError({ message: 'RAW_UNEXPECTED_STACK' }); },
      forbidden: 'RAW_UNEXPECTED_STACK',
    },
  ];

  const capturedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => capturedErrors.push(args.map(String).join(' '));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    for (const [index, sample] of cases.entries()) {
      app.locals.openaiClient = {
        chat: { completions: { create: async () => sample.result() } },
      };

      const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': `failure-test-${index}`,
          'X-Request-ID': `failure-request-${index}`,
        },
        body: JSON.stringify({ message: sample.message }),
      });
      const body = await response.json();

      assert.equal(response.status, 503, sample.name);
      assert.deepEqual(body, { error: 'TEMPORARY_RESPONSE_FAILURE', reply: sample.reply }, sample.name);
      assert.equal(JSON.stringify(body).includes(sample.forbidden), false, sample.name);
    }

    const logs = capturedErrors.join('\n');
    for (const sample of cases) assert.equal(logs.includes(sample.forbidden), false, sample.name);
    assert.match(logs, /PUBLIC_CHAT_FAILURE route=\/api\/chat/);
  } finally {
    console.error = originalConsoleError;
    delete app.locals.openaiClient;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('all public chat infrastructure failures use the shared localized boundary', () => {
  const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const guideChatStart = appSource.indexOf('app.post("/chat"');
  const guideChatEnd = appSource.indexOf('app.post("/:slug/chat"', guideChatStart);
  const webChatStart = appSource.indexOf('app.post("/api/chat"');
  const webChatEnd = appSource.indexOf('// C) WHATSAPP BOT', webChatStart);
  assert.ok(guideChatStart >= 0 && guideChatEnd > guideChatStart);
  assert.ok(webChatStart >= 0 && webChatEnd > webChatStart);
  const publicChatHandlers = `${appSource.slice(guideChatStart, guideChatEnd)}\n${appSource.slice(webChatStart, webChatEnd)}`;
  const forbiddenPublicDiagnostics = [
    'AI Guide assistant configuration is temporarily unavailable.',
    'Web Chat knowledge authority is temporarily unavailable.',
    'Web Chat assistant configuration is temporarily unavailable.',
    'Message could not be persisted. Please try again.',
    'Message could not be verified. Please try again.',
    'Knowledge changed while generating the response. Please retry.',
    'Response could not be delivered. Please try again.',
    'Sorry, I could not process that right now. Please try again.',
  ];

  for (const diagnostic of forbiddenPublicDiagnostics) {
    assert.equal(publicChatHandlers.includes(diagnostic), false, diagnostic);
  }
  assert.doesNotMatch(publicChatHandlers, /WEB_CHAT_INBOUND_PERSIST_WARN/);
});

test('/chat retains Guide request validation and contains an unexpected terminal failure without exposing it', async () => {
  const rawError = providerError({ message: 'RAW_GUIDE_PROVIDER_BODY', code: 'RESOURCE_EXHAUSTED', status: 429 });
  const body = {
    get text() { return 'Bağlanılamadı uyarısı alıyorum'; },
    get guide_module() { throw rawError; },
  };
  const req = {
    body,
    headers: { 'x-request-id': 'guide-failure-request' },
    get(name) { return this.headers[String(name).toLowerCase()]; },
    app: { locals: {} },
  };
  let statusCode = 200;
  let responseBody;
  const res = {
    status(value) { statusCode = value; return this; },
    json(value) { responseBody = value; return this; },
  };
  const capturedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => capturedErrors.push(args.map(String).join(' '));

  try {
    await chatPostHandler(req, res);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(statusCode, 503);
  assert.deepEqual(responseBody, { error: 'TEMPORARY_RESPONSE_FAILURE', reply: REPLIES.tr });
  assert.equal(JSON.stringify(responseBody).includes('RAW_GUIDE_PROVIDER_BODY'), false);
  assert.equal(capturedErrors.join('\n').includes('RAW_GUIDE_PROVIDER_BODY'), false);
  assert.match(capturedErrors.join('\n'), /PUBLIC_CHAT_FAILURE route=\/chat/);

  let validationStatus = 200;
  let validationBody;
  await chatPostHandler(
    { body: { text: '' }, app: { locals: {} }, get: () => undefined },
    {
      status(value) { validationStatus = value; return this; },
      json(value) { validationBody = value; return this; },
    },
  );
  assert.equal(validationStatus, 400);
  assert.deepEqual(validationBody, { error: 'Message text must be a non-empty string.' });
});
