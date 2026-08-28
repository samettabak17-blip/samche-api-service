import test from 'node:test';
import assert from 'node:assert/strict';
import { activateAssistantConfigurationVersion, approveAssistantConfigurationVersion, approveBusinessProfileVersion, resolveActiveAssistantKnowledgeConfiguration, rollbackAssistantConfigurationVersion, updateAssistantConfigurationReview } from '../services/knowledge-configuration-service.js';

test('activating an approved assistant configuration supersedes only the previously active version', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, status/i.test(sql)) return { rows: [{ id: params[0], status: 'APPROVED' }] };
      if (/status = 'ACTIVE'/i.test(sql)) return { rows: [{ id: 'old-version' }] };
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

  assert.ok(calls.some(({ sql }) => /status = 'SUPERSEDED'/.test(sql)));
  assert.ok(calls.some(({ sql }) => /status = 'ACTIVE'/.test(sql)));
  assert.ok(calls.some(({ sql }) => /active_configuration_version_id/.test(sql)));
});

test('active runtime resolution includes only the tenant active approved Business Profile version', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] };
    },
  };

  await resolveActiveAssistantKnowledgeConfiguration({
    database,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });

  assert.match(calls[0].sql, /business_profile_versions profile_version/i);
  assert.match(calls[0].sql, /profile_version\.status = 'APPROVED'/i);
  assert.match(calls[0].sql, /profile_version\.profile_data AS active_business_profile/i);
  assert.match(calls[0].sql, /profile_version\.id = configuration\.source_profile_version_id/i);
});

test('approving configuration preserves the existing runtime assignment until explicit activation', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/RETURNING id/i.test(sql)) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    },
  };

  await approveAssistantConfigurationVersion({
    database,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    approvedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  });

  assert.ok(calls.some(({ sql }) => /SET status = 'APPROVED'/.test(sql)));
  assert.equal(calls.some(({ sql }) => /active_configuration_version_id/.test(sql)), false);
});

test('approving a profile records historical approval without activating it', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/RETURNING profile_id/i.test(sql)) return { rows: [{ profile_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }] };
      return { rows: [] };
    },
  };

  await approveBusinessProfileVersion({
    database,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    approvedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  });

  assert.ok(calls.some(({ sql }) => /SET status = 'APPROVED'/.test(sql)));
  assert.ok(calls.some(({ sql }) => /approved_version_id/.test(sql)));
  assert.equal(calls.some(({ sql }) => /active_version_id/.test(sql)), false);
  assert.match(calls.find(({ sql }) => /UPDATE business_profile_versions/.test(sql)).sql, /identity_resolution_status <> 'IDENTITY_RESOLUTION_REQUIRED'/i);
});

test('unresolved identity conflict cannot be approved', async () => {
  const database = { query: async () => ({ rows: [] }) };
  await assert.rejects(approveBusinessProfileVersion({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', approvedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), (error) => error.code === 'KNOWLEDGE_PROFILE_NOT_REVIEWABLE');
});

test('unresolved identity conflict cannot be activated', async () => {
  const database = { query: async (sql) => /SELECT profile_id/.test(sql) ? { rows: [{ profile_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'APPROVED', identity_resolution_status: 'IDENTITY_RESOLUTION_REQUIRED' }] } : { rows: [] } };
  const { activateBusinessProfileVersion } = await import('../services/knowledge-configuration-service.js');
  await assert.rejects(activateBusinessProfileVersion({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', activatedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), (error) => error.code === 'KNOWLEDGE_PROFILE_IDENTITY_UNRESOLVED');
});

test('edits only NEEDS_REVIEW configuration data without activating it', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0], status: 'NEEDS_REVIEW', configuration_data: params[3] }] };
  } };
  const configurationData = { tone: 'concise' };
  const result = await updateAssistantConfigurationReview({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', configurationData });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.match(calls[0].sql, /status = 'NEEDS_REVIEW'/i);
  assert.equal(calls.some(({ sql }) => /active_configuration_version_id/.test(sql)), false);
});

test('explicit rollback reactivates only a SUPERSEDED configuration target', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SELECT id, status/i.test(sql)) return { rows: [{ id: params[0], status: 'SUPERSEDED' }] };
    if (/status = 'ACTIVE'/i.test(sql)) return { rows: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }] };
    return { rows: [] };
  } };
  const result = await rollbackAssistantConfigurationVersion({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', activatedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.supersedesVersionId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  assert.ok(calls.some(({ sql }) => /active_configuration_version_id/.test(sql)));
});

