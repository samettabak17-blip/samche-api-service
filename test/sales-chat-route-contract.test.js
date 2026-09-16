import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerSalesChatRoute } from '../services/sales-chat-service.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('registers POST /api/sales-chat and maps service output to the response', async () => {
  let route;
  registerSalesChatRoute({
    app: { post(path, handler) { route = { path, handler }; } },
    service: { handle: async ({ body }) => ({ status: 200, body: { reply: body.userMessage } }) },
    rateLimiter: { allow: () => true },
  });
  const response = responseRecorder();
  await route.handler({ body: { userMessage: 'hello' }, ip: '203.0.113.8' }, response);
  assert.equal(route.path, '/api/sales-chat');
  assert.deepEqual(response.payload, { reply: 'hello' });
});

test('maps rate-limit rejection to a safe 429 response', async () => {
  let route;
  registerSalesChatRoute({
    app: { post(_path, handler) { route = handler; } },
    service: { handle: async () => { throw new Error('must not call service'); } },
    rateLimiter: { allow: () => false },
  });
  const response = responseRecorder();
  await route({ body: {}, ip: '203.0.113.8', socket: {} }, response);
  assert.equal(response.statusCode, 429);
  assert.deepEqual(response.payload, { error: 'Sales assistant is temporarily unavailable.' });
});

test('initializes the Sales Chat service before registering its Express route', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('const salesChatService = createSalesChatService') < source.indexOf('registerSalesChatRoute({ app'));
});
