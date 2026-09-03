import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicConversationSessionError, issuePublicConversationSession, verifyPublicConversationSession } from '../services/public-conversation-session.js';

const secret = 'test-only-secret';

test('public conversation sessions are scoped to their opaque session identifier', () => {
  const issued = issuePublicConversationSession({ secret, now: 1000, ttlSeconds: 60 });
  assert.deepEqual(verifyPublicConversationSession(issued.token, { secret, now: 1030 }), { sessionId: issued.sessionId });
});

test('public conversation sessions reject invalid signatures and expired claims', () => {
  const issued = issuePublicConversationSession({ secret, now: 1000, ttlSeconds: 60 });
  assert.throws(() => verifyPublicConversationSession(issued.token, { secret: 'other', now: 1030 }), PublicConversationSessionError);
  assert.throws(() => verifyPublicConversationSession(issued.token, { secret, now: 1061 }), (error) => error instanceof PublicConversationSessionError && error.code === 'PUBLIC_SESSION_EXPIRED');
});

test('public Guide sessions bind to one hostname/channel scope and reject a tenant switch', () => {
  const scope = { domainId: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222', assistantId: '33333333-3333-4333-8333-333333333333', channelId: '44444444-4444-4444-8444-444444444444' };
  const issued = issuePublicConversationSession({ secret, now: 1000, ttlSeconds: 60, scope });
  assert.deepEqual(verifyPublicConversationSession(issued.token, { secret, now: 1030, expectedScope: scope }), { sessionId: issued.sessionId });
  assert.throws(
    () => verifyPublicConversationSession(issued.token, { secret, now: 1030, expectedScope: { ...scope, tenantId: '55555555-5555-4555-8555-555555555555' } }),
    (error) => error instanceof PublicConversationSessionError && error.code === 'PUBLIC_SESSION_SCOPE_MISMATCH',
  );
});
