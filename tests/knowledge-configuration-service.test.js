import test from 'node:test';
import assert from 'node:assert/strict';
import { activateAssistantConfigurationVersion } from '../services/knowledge-configuration-service.js';

test('activating an approved assistant configuration supersedes only the previously active version', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, status/i.test(sql)) return { rows: [{ id: params[0], status: 'APPROVED' }] };
      return { rows: [] };
    },
  };

  await activateAssistantConfigurationVersion({
    database,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    activatedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  });

  assert.match(calls[1].sql, /status = 'SUPERSEDED'/);
  assert.match(calls[2].sql, /status = 'ACTIVE'/);
  assert.match(calls[3].sql, /active_configuration_version_id/);
});
