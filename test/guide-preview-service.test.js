import test from 'node:test';
import assert from 'node:assert/strict';
import { issueGuidePreviewToken, verifyGuidePreviewToken, GuidePreviewError } from '../services/guide-preview-service.js';

const ids = { tenantId: '11111111-1111-4111-8111-111111111111', assistantId: '22222222-2222-4222-8222-222222222222', versionId: '33333333-3333-4333-8333-333333333333', actorUserId: '44444444-4444-4444-8444-444444444444' };

test('issues an opaque short-lived draft preview token and verifies its scope', () => {
  process.env.JWT_SECRET = 'test-preview-secret';
  const token = issueGuidePreviewToken({ ...ids, now: 1000, ttlSeconds: 300 });
  assert.ok(!token.includes(ids.tenantId));
  assert.deepEqual(verifyGuidePreviewToken(token, { now: 1001 }), { v: 1, purpose: 'GUIDE_DRAFT_PREVIEW', tenant_id: ids.tenantId, assistant_id: ids.assistantId, version_id: ids.versionId, actor_user_id: ids.actorUserId, iat: 1000, exp: 1300 });
});

test('rejects expired or tampered preview tokens', () => {
  process.env.JWT_SECRET = 'test-preview-secret';
  const token = issueGuidePreviewToken({ ...ids, now: 1000, ttlSeconds: 60 });
  assert.throws(() => verifyGuidePreviewToken(token, { now: 1061 }), GuidePreviewError);
  assert.throws(() => verifyGuidePreviewToken(`${token}x`), GuidePreviewError);
});
