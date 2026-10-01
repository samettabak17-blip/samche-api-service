import test from 'node:test';
import assert from 'node:assert/strict';
import { activateAssistantConfigurationVersion, approveAssistantConfigurationVersion, approveBusinessProfileVersion, createAssistantConfigurationRevision, resolveActiveAssistantKnowledgeConfiguration, rollbackAssistantConfigurationVersion, updateAssistantConfigurationReview } from '../services/knowledge-configuration-service.js';

test('editing an active configuration creates a review revision without changing runtime authority', async () => {
  const calls = [];
  const currentConfiguration = {
    assistant_identity: 'Meridian Client Advisor',
    company_context: { region: 'Dubai' },
    channel_adaptations: { instagram: { behavioral_prompt: 'OLD_PROMPT' } },
    future_unknown_field: { foo: 'bar' },
  };
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT configuration\.id/i.test(sql)) {
        return { rows: [{
          id: params[0],
          configuration_data: currentConfiguration,
          source_profile_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          source_recommendation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          schema_version: 2,
          status: 'ACTIVE',
        }] };
      }
      if (/INSERT INTO assistant_configuration_versions/i.test(sql)) {
        return { rows: [{ id: '99999999-9999-4999-8999-999999999999', status: 'NEEDS_REVIEW', configuration_data: params[2] }] };
      }
      return { rows: [] };
    },
  };

  const revision = await createAssistantConfigurationRevision({
    database,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  });

  assert.equal(revision.status, 'NEEDS_REVIEW');
  assert.deepEqual(revision.configuration_data, currentConfiguration);
  const insert = calls.find(({ sql }) => /INSERT INTO assistant_configuration_versions/i.test(sql));
  assert.equal(insert.params[1], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.deepEqual(insert.params[2], currentConfiguration);
  assert.equal(insert.params[6], 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(calls.some(({ sql }) => /active_configuration_version_id|SET status = 'ACTIVE'/i.test(sql)), false);
});

test('configuration edits reject destructive replacement without assistant identity', async () => {
  await assert.rejects(
    updateAssistantConfigurationReview({
      database: { query: async () => ({ rows: [] }) },
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      configurationData: { channel_adaptations: { instagram: { behavioral_prompt: 'NEW_PROMPT' } } },
    }),
    (error) => error.code === 'KNOWLEDGE_CONFIGURATION_RUNTIME_IDENTITY_REQUIRED',
  );
});

test('activating an approved assistant configuration supersedes only the previously active version', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT configuration\.id/i.test(sql)) return { rows: [{ id: params[0], status: 'APPROVED', configuration_data: { assistant_identity: 'Meridian Client Advisor' }, source_profile_version_id: 'profile-v1', current_active_profile_version_id: 'profile-v1' }] };
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
  assert.equal(calls.some(({ sql }) => /tenant_channels|channel_integrations/i.test(sql)), false);
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
      if (/SELECT configuration_data/i.test(sql)) return { rows: [{ configuration_data: { assistant_identity: 'Meridian Client Advisor' } }] };
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

test('configuration without an assistant identity cannot be approved', async () => {
  const database = { query: async (sql) => {
    if (/SELECT configuration_data/i.test(sql)) return { rows: [{ configuration_data: { tone: 'Concise' } }] };
    return { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] };
  } };
  await assert.rejects(
    approveAssistantConfigurationVersion({
      database,
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      approvedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    }),
    (error) => error.code === 'KNOWLEDGE_CONFIGURATION_RUNTIME_IDENTITY_REQUIRED',
  );
});

test('approving a profile records historical approval without activating it', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT version\.profile_id/i.test(sql)) return { rows: [{ profile_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', schema_version: 2, identity_resolution_status: 'RESOLVED', business_identity_id: 'identity-v1', business_identity_status: 'ACTIVE', source_scope: { business_identity_id: 'identity-v1', source_ids: ['source-v1'] } }] };
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
  assert.equal(calls.some(({ sql }) => /tenant_channels|channel_integrations/i.test(sql)), false);
  assert.match(calls.find(({ sql }) => /SELECT version\.profile_id/.test(sql)).sql, /business_identity_status/i);
});

test('unresolved identity conflict cannot be approved', async () => {
  const database = { query: async () => ({ rows: [] }) };
  await assert.rejects(approveBusinessProfileVersion({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', approvedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), (error) => error.code === 'KNOWLEDGE_PROFILE_NOT_REVIEWABLE');
});

test('unresolved identity conflict cannot be activated', async () => {
  const database = { query: async (sql) => /SELECT version\.profile_id/.test(sql) ? { rows: [{ profile_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'APPROVED', schema_version: 2, identity_resolution_status: 'IDENTITY_RESOLUTION_REQUIRED' }] } : { rows: [] } };
  const { activateBusinessProfileVersion } = await import('../services/knowledge-configuration-service.js');
  await assert.rejects(activateBusinessProfileVersion({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', activatedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), (error) => error.code === 'KNOWLEDGE_PROFILE_IDENTITY_UNRESOLVED');
});

test('edits only NEEDS_REVIEW configuration data without activating it', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0], status: 'NEEDS_REVIEW', configuration_data: params[3] }] };
  } };
  const configurationData = { assistant_identity: 'Meridian Client Advisor', tone: 'concise' };
  const result = await updateAssistantConfigurationReview({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', configurationData });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.match(calls[0].sql, /status = 'NEEDS_REVIEW'/i);
  assert.equal(calls.some(({ sql }) => /active_configuration_version_id/.test(sql)), false);
});

test('preserves an Instagram behavioral prompt verbatim through edit, approval, and activation', async () => {
  const calls = [];
  const behavioralPrompt = `Instagram policy\n${'x'.repeat(64_000)}`;
  const configurationData = {
    assistant_identity: 'Meridian Client Advisor',
    channel_adaptations: {
      instagram: { behavioral_prompt: behavioralPrompt },
      whatsapp: { deterministic_templates: { welcome: 'Existing WhatsApp template' } },
    },
  };
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SET configuration_data = \$4/i.test(sql)) {
      return { rows: [{ id: params[0], status: 'NEEDS_REVIEW', configuration_data: params[3] }] };
    }
    if (/SELECT configuration_data/i.test(sql)) return { rows: [{ configuration_data: params[0] ? configurationData : null }] };
    if (/SET status = 'APPROVED'/i.test(sql)) return { rows: [{ id: params[0], status: 'APPROVED' }] };
    if (/SELECT configuration\.id/i.test(sql)) {
      return { rows: [{
        id: params[0], status: 'APPROVED', configuration_data: configurationData,
        source_profile_version_id: 'profile-v1', current_active_profile_version_id: 'profile-v1',
      }] };
    }
    return { rows: [] };
  } };
  const ids = {
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actorId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  };

  const review = await updateAssistantConfigurationReview({ database, ...ids, configurationData });
  await approveAssistantConfigurationVersion({ database, ...ids, approvedBy: ids.actorId });
  const activation = await activateAssistantConfigurationVersion({ database, ...ids, activatedBy: ids.actorId });

  assert.equal(review.configuration_data.channel_adaptations.instagram.behavioral_prompt, behavioralPrompt);
  assert.equal(review.configuration_data.channel_adaptations.instagram.behavioral_prompt.length, behavioralPrompt.length);
  assert.deepEqual(review.configuration_data.channel_adaptations.whatsapp, configurationData.channel_adaptations.whatsapp);
  assert.equal(activation.status, 'ACTIVE');
  assert.ok(calls.some(({ sql }) => /SET status = 'APPROVED'/.test(sql)));
  assert.ok(calls.some(({ sql }) => /SET status = 'ACTIVE'/.test(sql)));
  assert.equal(calls.some(({ sql }) => /tenant_channels|channel_integrations/i.test(sql)), false);
});

test('explicit rollback reactivates only a SUPERSEDED configuration target', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SELECT configuration\.id/i.test(sql)) return { rows: [{ id: params[0], status: 'SUPERSEDED', configuration_data: { assistant_identity: 'Meridian Client Advisor' }, source_profile_version_id: 'profile-v1', current_active_profile_version_id: 'profile-v1' }] };
    if (/status = 'ACTIVE'/i.test(sql)) return { rows: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }] };
    return { rows: [] };
  } };
  const result = await rollbackAssistantConfigurationVersion({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', activatedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.supersedesVersionId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  assert.ok(calls.some(({ sql }) => /active_configuration_version_id/.test(sql)));
});

test('configuration cannot activate when its source profile is no longer active', async () => {
  const database = { query: async (sql, params = []) => /SELECT configuration\.id/i.test(sql)
    ? { rows: [{ id: params[0], status: 'APPROVED', configuration_data: { assistant_identity: 'Meridian Client Advisor' }, source_profile_version_id: 'profile-old', current_active_profile_version_id: 'profile-new' }] }
    : { rows: [] } };
  await assert.rejects(activateAssistantConfigurationVersion({ database, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', activatedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), (error) => error.code === 'KNOWLEDGE_CONFIGURATION_PROFILE_NOT_ACTIVE');
});

test('configuration without an assistant identity cannot activate into the runtime pointer', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SELECT configuration\.id/i.test(sql)) {
      return { rows: [{
        id: params[0],
        status: 'APPROVED',
        configuration_data: { tone: 'Concise' },
        source_profile_version_id: 'profile-v1',
        current_active_profile_version_id: 'profile-v1',
      }] };
    }
    return { rows: [] };
  } };

  await assert.rejects(
    activateAssistantConfigurationVersion({
      database,
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      activatedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    }),
    (error) => error.code === 'KNOWLEDGE_CONFIGURATION_RUNTIME_IDENTITY_REQUIRED',
  );
  assert.equal(calls.some(({ sql }) => /active_configuration_version_id/.test(sql)), false);
});

