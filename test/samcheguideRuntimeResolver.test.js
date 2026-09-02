import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSamcheguideRuntimeIntegration } from '../services/live-inbox-service.js';

function resolverClient(row) {
  return {
    async query(sql, parameters) {
      assert.match(sql, /tc\.assistant_id AS channel_assistant_id/);
      assert.deepEqual(parameters, ['SAMCHEGUIDE:staging']);
      return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
    },
  };
}

test('AI Guide resolves only an enabled active channel whose tenant and Assistant ownership agree', async () => {
  const integration = await resolveSamcheguideRuntimeIntegration({
    database: resolverClient({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      channel_id: '22222222-2222-4222-8222-222222222222',
      assistant_id: '33333333-3333-4333-8333-333333333333',
      channel_assistant_id: '33333333-3333-4333-8333-333333333333',
      channel_type: 'SAMCHEGUIDE',
      channel_status: 'active',
      assistant_status: 'active',
    }),
  });

  assert.equal(integration?.tenant_id, '11111111-1111-4111-8111-111111111111');
});

test('AI Guide fails closed before runtime resolution when its channel names a different Assistant', async () => {
  const integration = await resolveSamcheguideRuntimeIntegration({
    database: resolverClient({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      channel_id: '22222222-2222-4222-8222-222222222222',
      assistant_id: '33333333-3333-4333-8333-333333333333',
      channel_assistant_id: '44444444-4444-4444-8444-444444444444',
      channel_type: 'SAMCHEGUIDE',
      channel_status: 'active',
      assistant_status: 'active',
    }),
  });

  assert.equal(integration, null);
});
