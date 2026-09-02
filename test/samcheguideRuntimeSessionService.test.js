import assert from 'node:assert/strict';
import test from 'node:test';
import { samcheguideRuntimeSessionKey } from '../services/samcheguide-runtime-session-service.js';

test('AI Guide runtime memory is partitioned by tenant, Assistant, channel, and public session', () => {
  const base = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    assistantId: '22222222-2222-4222-8222-222222222222',
    channelId: '33333333-3333-4333-8333-333333333333',
    sessionId: 'opaque-session',
  };
  const baseKey = samcheguideRuntimeSessionKey(base);

  assert.match(baseKey, /^[a-f0-9]{64}$/);
  assert.notEqual(baseKey, samcheguideRuntimeSessionKey({ ...base, tenantId: '44444444-4444-4444-8444-444444444444' }));
  assert.notEqual(baseKey, samcheguideRuntimeSessionKey({ ...base, assistantId: '55555555-5555-4555-8555-555555555555' }));
  assert.notEqual(baseKey, samcheguideRuntimeSessionKey({ ...base, channelId: '66666666-6666-4666-8666-666666666666' }));
});
