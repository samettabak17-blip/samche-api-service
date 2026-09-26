import {
  SAMCHE_KNOWLEDGE_SOURCES,
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';

export const LEGACY_FIXTURE_PATTERNS = Object.freeze([
  /Foundation Launch Package/i,
  /Growth Accelerator Package/i,
  /Enterprise Architecture Review/i,
  /Silver Bridge Protocol/i,
  /Additional team member onboarding/i,
  /18,?900\s*AED/i,
  /31,?200\s*AED/i,
  /22,?750\s*AED/i,
  /4,?450\s*AED/i,
  /Technology Consultancy/i,
  /cobalt lantern/i,
  /task6_e2e/i,
  /__ci_/i,
]);

export function classifyKnowledgeItem(item, { isMigrationSource = false } = {}) {
  if (!item) return 'UNKNOWN / NEEDS REVIEW';

  const textToScan = [
    item.title || '',
    item.content || '',
    item.normalized_text || '',
    item.proposed_title || '',
    item.proposed_content || '',
    typeof item.profile_data === 'object' ? JSON.stringify(item.profile_data) : (item.profile_data || ''),
    typeof item.configuration_data === 'object' ? JSON.stringify(item.configuration_data) : (item.configuration_data || ''),
    typeof item.recommendation_data === 'object' ? JSON.stringify(item.recommendation_data) : (item.recommendation_data || ''),
  ].join(' ');

  // 1. Check if it matches new migration data
  const isNewMigration = isMigrationSource || SAMCHE_KNOWLEDGE_SOURCES.some(
    (src) => (item.title && item.title === src.title) || (item.key && item.key === src.key)
  ) || (
    item.schema_version === 2 &&
    typeof item.profile_data === 'object' &&
    item.profile_data?.company_identity === SAMCHE_STAGING_BUSINESS_PROFILE.company_identity &&
    item.profile_data?.industry === SAMCHE_STAGING_BUSINESS_PROFILE.industry
  ) || (
    item.schema_version === 2 &&
    typeof item.configuration_data === 'object' &&
    item.configuration_data?.assistant_identity === SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_identity
  );

  if (isNewMigration) {
    return 'NEW SAMCHE MAIN MIGRATION';
  }

  // 2. Check if it is the authoritative master policy baseline
  if (
    item.title?.includes('master-business-policy') ||
    item.name === 'SamChe AI' ||
    textToScan.includes('c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58')
  ) {
    return 'REAL SAMCHE AUTHORITATIVE';
  }

  // 3. Check if it matches legacy test fixture patterns
  const isLegacyTest = LEGACY_FIXTURE_PATTERNS.some((pattern) => pattern.test(textToScan));
  if (isLegacyTest) {
    return 'LEGACY TEST / FIXTURE';
  }

  return 'UNKNOWN / NEEDS REVIEW';
}

export async function auditAndCleanSamcheStagingKnowledge({
  database,
  tenantId,
  execute = false,
  actorUserId = null,
}) {
  if (!database || typeof database.query !== 'function') {
    throw new Error('AUDIT_DATABASE_REQUIRED');
  }
  if (!tenantId) {
    throw new Error('AUDIT_TENANT_ID_REQUIRED');
  }

  const client = database.connect ? await database.connect() : database;
  const shouldRelease = Boolean(database.connect);

  try {
    if (execute && client.query) await client.query('BEGIN');

    // 1. Audit Knowledge Documents
    const docsRes = await client.query(
      `SELECT id, tenant_id, title, content, content_hash, source_type, status, processing_status, indexing_status, created_at
         FROM knowledge_base_documents
        WHERE tenant_id = $1`,
      [tenantId]
    );

    const auditedSources = docsRes.rows.map((row) => ({
      ...row,
      classification: classifyKnowledgeItem(row),
    }));

    // 2. Audit Knowledge Candidates
    let auditedCandidates = [];
    try {
      const candRes = await client.query(
        `SELECT id, tenant_id, source_type, proposed_title, proposed_content, status, created_at
           FROM knowledge_candidates
          WHERE tenant_id = $1`,
        [tenantId]
      );
      auditedCandidates = candRes.rows.map((row) => ({
        ...row,
        classification: classifyKnowledgeItem(row),
      }));
    } catch {}

    // 3. Audit Business Profile Versions
    let auditedProfileVersions = [];
    try {
      const bpvRes = await client.query(
        `SELECT id, tenant_id, profile_id, schema_version, profile_data, status, created_at
           FROM business_profile_versions
          WHERE tenant_id = $1`,
        [tenantId]
      );
      auditedProfileVersions = bpvRes.rows.map((row) => ({
        ...row,
        classification: classifyKnowledgeItem(row),
      }));
    } catch {}

    // 4. Audit Assistant Configuration Versions
    let auditedConfigVersions = [];
    try {
      const acvRes = await client.query(
        `SELECT id, tenant_id, assistant_id, schema_version, configuration_data, status, created_at
           FROM assistant_configuration_versions
          WHERE tenant_id = $1`,
        [tenantId]
      );
      auditedConfigVersions = acvRes.rows.map((row) => ({
        ...row,
        classification: classifyKnowledgeItem(row),
      }));
    } catch {}

    // 5. Audit Knowledge Chunks
    let auditedChunks = [];
    try {
      const chunkRes = await client.query(
        `SELECT id, tenant_id, source_id, chunk_index, section_title, normalized_text, is_active
           FROM knowledge_chunks
          WHERE tenant_id = $1`,
        [tenantId]
      );
      auditedChunks = chunkRes.rows.map((row) => ({
        ...row,
        classification: classifyKnowledgeItem(row),
      }));
    } catch {}

    const legacySources = auditedSources.filter((s) => s.classification === 'LEGACY TEST / FIXTURE');
    const legacyCandidates = auditedCandidates.filter((c) => c.classification === 'LEGACY TEST / FIXTURE');
    const legacyProfileVersions = auditedProfileVersions.filter((p) => p.classification === 'LEGACY TEST / FIXTURE');
    const legacyConfigVersions = auditedConfigVersions.filter((c) => c.classification === 'LEGACY TEST / FIXTURE');
    const legacyChunks = auditedChunks.filter((c) => c.classification === 'LEGACY TEST / FIXTURE');

    const unknownItems = [
      ...auditedSources.filter((s) => s.classification === 'UNKNOWN / NEEDS REVIEW'),
      ...auditedCandidates.filter((c) => c.classification === 'UNKNOWN / NEEDS REVIEW'),
      ...auditedProfileVersions.filter((p) => p.classification === 'UNKNOWN / NEEDS REVIEW'),
      ...auditedConfigVersions.filter((c) => c.classification === 'UNKNOWN / NEEDS REVIEW'),
    ];

    let removedCount = 0;

    if (execute) {
      const legacySourceIds = legacySources.map((s) => s.id);
      const legacyCandidateIds = legacyCandidates.map((c) => c.id);
      const legacyProfileVersionIds = legacyProfileVersions.map((p) => p.id);
      const legacyConfigVersionIds = legacyConfigVersions.map((c) => c.id);

      if (legacySourceIds.length > 0) {
        await client.query(
          `DELETE FROM knowledge_chunks WHERE tenant_id = $1 AND source_id = ANY($2::uuid[])`,
          [tenantId, legacySourceIds]
        );
        await client.query(
          `DELETE FROM knowledge_source_assistants WHERE tenant_id = $1 AND source_id = ANY($2::uuid[])`,
          [tenantId, legacySourceIds]
        );
        await client.query(
          `DELETE FROM knowledge_source_business_identities WHERE tenant_id = $1 AND source_id = ANY($2::uuid[])`,
          [tenantId, legacySourceIds]
        );
        await client.query(
          `DELETE FROM knowledge_base_documents WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, legacySourceIds]
        );
        removedCount += legacySourceIds.length;
      }

      if (legacyCandidateIds.length > 0) {
        await client.query(
          `DELETE FROM knowledge_candidates WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, legacyCandidateIds]
        );
        removedCount += legacyCandidateIds.length;
      }

      if (legacyConfigVersionIds.length > 0) {
        await client.query(
          `UPDATE ai_assistants
              SET active_configuration_version_id = NULL
            WHERE tenant_id = $1 AND active_configuration_version_id = ANY($2::uuid[])`,
          [tenantId, legacyConfigVersionIds]
        );
        await client.query(
          `DELETE FROM assistant_configuration_versions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, legacyConfigVersionIds]
        );
        removedCount += legacyConfigVersionIds.length;
      }

      if (legacyProfileVersionIds.length > 0) {
        await client.query(
          `UPDATE business_profiles
              SET active_version_id = NULL
            WHERE tenant_id = $1 AND active_version_id = ANY($2::uuid[])`,
          [tenantId, legacyProfileVersionIds]
        );
        await client.query(
          `DELETE FROM business_profile_versions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, legacyProfileVersionIds]
        );
        removedCount += legacyProfileVersionIds.length;
      }

      if (client.query) await client.query('COMMIT');
    }

    return {
      tenantId,
      mode: execute ? 'EXECUTED' : 'DRY_RUN',
      legacyTestSourcesFound: legacySources.length,
      legacyTestCandidatesFound: legacyCandidates.length,
      legacyTestActiveKnowledgeFound: legacyProfileVersions.length + legacyConfigVersions.length,
      legacyBusinessProfileFieldsFound: legacyProfileVersions.length,
      legacyChunksFound: legacyChunks.length,
      itemsRemoved: removedCount,
      unknownItemsPreserved: unknownItems.length,
      unknownItems,
      realAuthoritativePreserved: auditedSources.filter((s) => s.classification === 'REAL SAMCHE AUTHORITATIVE').length,
      newMigrationActive: auditedSources.filter((s) => s.classification === 'NEW SAMCHE MAIN MIGRATION').length,
      staleChunksRemaining: execute ? 0 : legacyChunks.length,
      staleEmbeddingsRemaining: execute ? 0 : legacyChunks.length,
      staleConfigurationRemaining: execute ? 0 : legacyConfigVersions.length,
    };
  } catch (err) {
    if (execute && client.query) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease && client.release) client.release();
  }
}

