const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KnowledgeConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function uuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeConfigurationError(code, 'Knowledge configuration identifier is invalid');
  return String(value);
}

async function transaction(database, work) {
  if (!database?.query) throw new KnowledgeConfigurationError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  if (typeof database.connect !== 'function') return work(database);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveActiveAssistantKnowledgeConfiguration({ database, tenantId, assistantId }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID');
  const result = await database.query(
    `SELECT configuration.id, configuration.configuration_data, configuration.schema_version AS configuration_schema_version, configuration.source_profile_version_id,
            configuration.source_recommendation_id, configuration.activated_at,
            profile.active_version_id AS active_business_profile_version_id,
            profile_version.profile_data AS active_business_profile,
            profile_version.schema_version AS profile_schema_version
       FROM ai_assistants assistant
       LEFT JOIN assistant_configuration_versions configuration
         ON configuration.id = assistant.active_configuration_version_id
        AND configuration.tenant_id = assistant.tenant_id
        AND configuration.status = 'ACTIVE'
       LEFT JOIN business_profiles profile
         ON profile.tenant_id = assistant.tenant_id
        AND profile.active_version_id = configuration.source_profile_version_id
       LEFT JOIN business_profile_versions profile_version
         ON profile_version.id = configuration.source_profile_version_id
        AND profile_version.tenant_id = profile.tenant_id
        AND profile_version.status = 'APPROVED'
      WHERE assistant.id = $1 AND assistant.tenant_id = $2`,
    [assistantId, tenantId]
  );
  return result.rows[0] ?? null;
}

export async function approveAssistantConfigurationVersion({
  database,
  tenantId,
  assistantId,
  versionId,
  approvedBy,
}) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID');
  uuid(versionId, 'KNOWLEDGE_CONFIGURATION_INVALID');
  uuid(approvedBy, 'KNOWLEDGE_APPROVER_INVALID');

  return transaction(database, async (client) => {
    const result = await client.query(
      `UPDATE assistant_configuration_versions
          SET status = 'APPROVED', approved_by = $4, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND assistant_id = $3
          AND status IN ('DRAFT', 'NEEDS_REVIEW', 'APPROVED')
        RETURNING id, status`,
      [versionId, tenantId, assistantId, approvedBy]
    );
    if (!result.rows[0]) {
      throw new KnowledgeConfigurationError('KNOWLEDGE_CONFIGURATION_NOT_REVIEWABLE', 'Assistant configuration is not available for approval');
    }
    return result.rows[0];
  });
}

export async function approveBusinessProfileVersion({ database, tenantId, versionId, approvedBy }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(versionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID');
  uuid(approvedBy, 'KNOWLEDGE_APPROVER_INVALID');

  return transaction(database, async (client) => {
    const result = await client.query(
      `UPDATE business_profile_versions
          SET status = 'APPROVED', reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
          AND status IN ('DRAFT', 'NEEDS_REVIEW', 'APPROVED')
          AND identity_resolution_status <> 'IDENTITY_RESOLUTION_REQUIRED'
        RETURNING profile_id, id, status`,
      [versionId, tenantId, approvedBy]
    );
    const version = result.rows[0];
    if (!version) {
      throw new KnowledgeConfigurationError('KNOWLEDGE_PROFILE_NOT_REVIEWABLE', 'Business Profile is not available for approval');
    }
    await client.query(
      `UPDATE business_profiles
          SET approved_version_id = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [version.profile_id, tenantId, versionId]
    );
    return version;
  });
}

async function activateConfigurationVersion({
  database,
  tenantId,
  assistantId,
  versionId,
  activatedBy,
  allowSuperseded = false,
}) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID');
  uuid(versionId, 'KNOWLEDGE_CONFIGURATION_INVALID');
  uuid(activatedBy, 'KNOWLEDGE_ACTIVATOR_INVALID');

  return transaction(database, async (client) => {
    const targetResult = await client.query(
      `SELECT id, status
         FROM assistant_configuration_versions
        WHERE id = $1 AND tenant_id = $2 AND assistant_id = $3
        FOR UPDATE`,
      [versionId, tenantId, assistantId]
    );
    const target = targetResult.rows[0];
    const allowedStatuses = allowSuperseded ? ['SUPERSEDED'] : ['APPROVED', 'ACTIVE'];
    if (!target || !allowedStatuses.includes(target.status)) {
      throw new KnowledgeConfigurationError('KNOWLEDGE_CONFIGURATION_NOT_APPROVED', 'Only an approved configuration can be activated');
    }

    const previousResult = await client.query(
      `SELECT id
         FROM assistant_configuration_versions
        WHERE tenant_id = $1 AND assistant_id = $2 AND status = 'ACTIVE' AND id <> $3
        FOR UPDATE`,
      [tenantId, assistantId, versionId]
    );
    const previousId = previousResult.rows[0]?.id ?? null;

    if (previousId) {
      await client.query(
        `UPDATE assistant_configuration_versions
            SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2`,
        [previousId, tenantId]
      );
    }

    await client.query(
      `UPDATE assistant_configuration_versions
          SET status = 'ACTIVE',
              activated_by = $4,
              activated_at = CURRENT_TIMESTAMP,
              supersedes_version_id = $5,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND assistant_id = $3`,
      [versionId, tenantId, assistantId, activatedBy, previousId]
    );

    await client.query(
      `UPDATE ai_assistants
          SET active_configuration_version_id = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [assistantId, tenantId, versionId]
    );
    return { id: versionId, supersedesVersionId: previousId, status: 'ACTIVE' };
  });
}

export async function activateAssistantConfigurationVersion(options) {
  return activateConfigurationVersion(options);
}

export async function rollbackAssistantConfigurationVersion(options) {
  return activateConfigurationVersion({ ...options, allowSuperseded: true });
}

export async function updateAssistantConfigurationReview({ database, tenantId, assistantId, versionId, configurationData }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID');
  uuid(versionId, 'KNOWLEDGE_CONFIGURATION_INVALID');
  if (!configurationData || typeof configurationData !== 'object' || Array.isArray(configurationData) || !Object.keys(configurationData).length) {
    throw new KnowledgeConfigurationError('KNOWLEDGE_CONFIGURATION_DATA_INVALID', 'Assistant configuration review data is invalid');
  }
  const result = await database.query(
    `UPDATE assistant_configuration_versions
        SET configuration_data = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND assistant_id = $3 AND status = 'NEEDS_REVIEW'
      RETURNING id, status, configuration_data`,
    [versionId, tenantId, assistantId, configurationData]
  );
  if (!result.rows[0]) throw new KnowledgeConfigurationError('KNOWLEDGE_CONFIGURATION_NOT_REVIEWABLE', 'Assistant configuration is not available for editing');
  return result.rows[0];
}

export async function activateBusinessProfileVersion({ database, tenantId, versionId, activatedBy }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(versionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID');
  uuid(activatedBy, 'KNOWLEDGE_ACTIVATOR_INVALID');

  return transaction(database, async (client) => {
    const versionResult = await client.query(
      `SELECT profile_id, status, identity_resolution_status
         FROM business_profile_versions
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE`,
      [versionId, tenantId]
    );
    const version = versionResult.rows[0];
    if (version?.identity_resolution_status === 'IDENTITY_RESOLUTION_REQUIRED') {
      throw new KnowledgeConfigurationError('KNOWLEDGE_PROFILE_IDENTITY_UNRESOLVED', 'Business Profile identity conflict must be resolved before activation');
    }
    if (!version || version.status !== 'APPROVED') {
      throw new KnowledgeConfigurationError('KNOWLEDGE_PROFILE_NOT_APPROVED', 'Only an approved Business Profile can be activated');
    }

    const current = await client.query(
      `SELECT active_version_id
         FROM business_profiles
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE`,
      [version.profile_id, tenantId]
    );
    const previousId = current.rows[0]?.active_version_id ?? null;

    await client.query(
      `UPDATE business_profiles
          SET active_version_id = $3, activated_by = $4, activated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [version.profile_id, tenantId, versionId, activatedBy]
    );
    await client.query(
      `UPDATE business_profile_versions
          SET activated_by = $3, activated_at = CURRENT_TIMESTAMP,
              superseded_by_version_id = NULL
        WHERE id = $1 AND tenant_id = $2`,
      [versionId, tenantId, activatedBy]
    );
    if (previousId && previousId !== versionId) {
      await client.query(
        `UPDATE business_profile_versions
            SET superseded_by_version_id = $3
          WHERE id = $1 AND tenant_id = $2`,
        [previousId, tenantId, versionId]
      );
    }
    return { id: versionId, supersedesVersionId: previousId, status: 'ACTIVE' };
  });
}

