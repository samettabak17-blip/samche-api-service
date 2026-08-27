import test from 'node:test';
import assert from 'node:assert/strict';
import { issuePublicWebChatSession, verifyPublicWebChatSession } from '../services/public-web-chat-session.js';

test('a web chat session is bound to an opaque public widget identity, not browser tenant identifiers', () => {
  const issued = issuePublicWebChatSession({
    secret: 'test-secret',
    widgetKey: 'widget_public_opaque_key',
    now: 100,
  });
  const verified = verifyPublicWebChatSession(issued.token, { secret: 'test-secret', now: 101 });

  assert.equal(verified.sessionId, issued.sessionId);
  assert.equal(verified.widgetKey, 'widget_public_opaque_key');
  assert.doesNotMatch(issued.token, /tenant|assistant/i);
});

test('a modified widget identity invalidates the public web chat session', () => {
  const issued = issuePublicWebChatSession({
    secret: 'test-secret',
    widgetKey: 'widget_public_opaque_key',
    now: 100,
  });
  const [payload, signature] = issued.token.split('.');
  const tampered = Buffer.from(JSON.stringify({ v: 1, sid: issued.sessionId, widget_key: 'other_widget', iat: 100, exp: 200 })).toString('base64url') + '.' + signature;

  assert.throws(() => verifyPublicWebChatSession(tampered, { secret: 'test-secret', now: 101 }), { code: 'WEB_CHAT_SESSION_INVALID' });
});

