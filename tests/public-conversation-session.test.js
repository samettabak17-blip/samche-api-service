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