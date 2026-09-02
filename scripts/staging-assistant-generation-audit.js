import pg from 'pg';
import { assertVerifiedTls, strictTlsConfig } from './staging-task6-e2e-support.js';

const tenantId = String(process.env.TASK6_AUDIT_TENANT_ID ?? '').trim();
const profileVersionId = String(process.env.TASK6_AUDIT_PROFILE_VERSION_ID ?? '').trim();
const tenantName = String(process.env.TASK6_AUDIT_TENANT_NAME ?? '').trim();
const profileVersionPrefix = String(process.env.TASK6_AUDIT_PROFILE_VERSION_PREFIX ?? '').trim().toLowerCase();
const hasExactScope = Boolean(tenantId && profileVersionId);
const hasNamedScope = Boolean(tenantName && /^[a-f0-9]{8,36}$/.test(profileVersionPrefix));
if ((!hasExactScope && !hasNamedScope) || !process.env.STAGING_DATABASE_URL) throw new Error('ASSISTANT_GENERATION_AUDIT_INPUT_REQUIRED');

const client = new pg.Client(strictTlsConfig(process.env.STAGING_DATABASE_URL));
let auditPhase = 'CONNECT';
try {
  await client.connect();
  assertVerifiedTls(client);
  auditPhase = 'BEGIN_READ_ONLY';
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  auditPhase = 'RESOLVE_SCOPE';
  const namedScope = hasExactScope ? null : await client.query(
      `SELECT tenant.id AS tenant_id, version.id AS profile_version_id
         FROM tenants tenant
         JOIN business_profiles profile ON profile.tenant_id = tenant.id
         JOIN business_profile_versions version ON version.id = profile.active_version_id AND version.tenant_id = profile.tenant_id
        WHERE tenant.name = $1 AND lower(version.id::text) LIKE $2
        LIMIT 2`,
      [tenantName, `${profileVersionPrefix}%`],
    );
  if (!hasExactScope && namedScope.rowCount !== 1) throw new Error('ASSISTANT_GENERATION_AUDIT_SCOPE_NOT_UNIQUE');
  const resolvedScope = hasExactScope
    ? { tenant_id: tenantId, profile_version_id: profileVersionId }
    : namedScope.rows[0];
  const scopedTenantId = resolvedScope.tenant_id;
  const scopedProfileVersionId = resolvedScope.profile_version_id;
  auditPhase = 'PROFILE_CONTEXT';
  const context = await client.query(
    `SELECT version.id AS profile_version_id, version.status AS profile_status,
            profile.active_version_id, profile.business_identity_id,
            jsonb_array_length(COALESCE(version.source_scope->'source_ids','[]'::jsonb)) AS source_count,
            COALESCE(version.evidence->'source_hashes','[]'::jsonb) AS source_hashes,
            length(version.profile_data::text) AS profile_json_character_count
       FROM business_profile_versions version
       JOIN business_profiles profile ON profile.id=version.profile_id AND profile.tenant_id=version.tenant_id
      WHERE version.tenant_id=$1 AND version.id=$2`,
    [scopedTenantId, scopedProfileVersionId],
  );
  if (context.rowCount !== 1) throw new Error('ASSISTANT_GENERATION_AUDIT_SCOPE_NOT_UNIQUE');
  auditPhase = 'RECOMMENDATION_RUNS';
  const runs = await client.query(
    `SELECT run.id AS run_id, run.request_fingerprint, run.tenant_id,
            run.input_provenance->>'assistant_id' AS assistant_id,
            assistant.name AS assistant_name,
            run.input_provenance->>'profile_version_id' AS business_profile_version_id,
            run.input_provenance->'source_scope' AS source_scope,
            run.input_provenance->'source_hashes' AS source_hashes,
            run.provider, run.model, run.prompt_character_count, run.source_count,
            run.stage, run.elapsed_ms, run.provider_telemetry, run.status, run.error_code, run.target_id,
            run.created_at, run.completed_at,
            recommendation.id AS recommendation_id, recommendation.status AS recommendation_status
       FROM knowledge_generation_runs run
       LEFT JOIN ai_assistants assistant
         ON assistant.id = CASE WHEN run.input_provenance->>'assistant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                                THEN (run.input_provenance->>'assistant_id')::uuid END
        AND assistant.tenant_id=run.tenant_id
       LEFT JOIN assistant_knowledge_recommendations recommendation
         ON recommendation.id=run.target_id AND recommendation.tenant_id=run.tenant_id
      WHERE run.tenant_id=$1 AND run.target_type='RECOMMENDATION'
        AND run.input_provenance->>'profile_version_id'=$2
      ORDER BY run.created_at DESC LIMIT 10`,
    [scopedTenantId, scopedProfileVersionId],
  );
  const latest = runs.rows[0] ?? null;
  auditPhase = 'CONFIGURATION_RUNS';
  const configurationRuns = await client.query(
    `SELECT run.id AS run_id, run.request_fingerprint, run.tenant_id,
            run.input_provenance->>'assistant_id' AS assistant_id,
            assistant.name AS assistant_name,
            run.input_provenance->>'profile_version_id' AS business_profile_version_id,
            run.input_provenance->>'recommendation_id' AS recommendation_id,
            run.input_provenance->'source_scope' AS source_scope,
            run.input_provenance->'source_hashes' AS source_hashes,
            run.provider, run.model, run.prompt_character_count, run.source_count,
            run.stage, run.elapsed_ms, run.provider_telemetry, run.status, run.error_code, run.target_id,
            run.created_at, run.completed_at,
            configuration.id AS configuration_id, configuration.status AS configuration_status,
            configuration.source_recommendation_id, configuration.source_profile_version_id
       FROM knowledge_generation_runs run
       LEFT JOIN ai_assistants assistant
         ON assistant.id = CASE WHEN run.input_provenance->>'assistant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                                THEN (run.input_provenance->>'assistant_id')::uuid END
        AND assistant.tenant_id=run.tenant_id
       LEFT JOIN assistant_configuration_versions configuration
         ON configuration.id=run.target_id AND configuration.tenant_id=run.tenant_id
      WHERE run.tenant_id=$1 AND run.target_type='ASSISTANT_CONFIGURATION'
        AND run.input_provenance->>'profile_version_id'=$2
      ORDER BY run.created_at DESC LIMIT 10`,
    [scopedTenantId, scopedProfileVersionId],
  );
  const latestConfigurationRun = configurationRuns.rows[0] ?? null;
  auditPhase = 'RUNTIME';
  const runtime = await client.query(
    `SELECT ci.tenant_id, ci.assistant_id AS whatsapp_assistant_id,
            ci.channel_id, ci.enabled AS integration_enabled,
            channel.channel_type, channel.status AS channel_status,
            assistant.status AS assistant_status,
            assistant.active_configuration_version_id,
            assistant.knowledge_authority_version,
            configuration.id AS configuration_id,
            configuration.status AS configuration_status,
            configuration.schema_version AS configuration_schema_version,
            configuration.source_profile_version_id,
            configuration.source_recommendation_id,
            CASE WHEN NULLIF(btrim(configuration.configuration_data->>'assistant_identity'), '') IS NULL THEN false ELSE true END AS has_assistant_identity,
            profile.active_version_id AS active_business_profile_version_id,
            profile_version.status AS profile_version_status,
            profile_version.schema_version AS profile_schema_version,
            CASE WHEN NULLIF(btrim(COALESCE(profile_version.profile_data->>'company_identity', profile_version.profile_data->>'company_display_name')), '') IS NULL THEN false ELSE true END AS has_company_identity,
            (configuration.source_profile_version_id = profile.active_version_id) AS source_profile_matches_active
       FROM channel_integrations ci
       JOIN tenant_channels channel ON channel.id = ci.channel_id AND channel.tenant_id = ci.tenant_id
       JOIN ai_assistants assistant ON assistant.id = ci.assistant_id AND assistant.tenant_id = ci.tenant_id
       LEFT JOIN assistant_configuration_versions configuration
         ON configuration.id = assistant.active_configuration_version_id
        AND configuration.tenant_id = assistant.tenant_id
       LEFT JOIN business_profiles profile ON profile.tenant_id = assistant.tenant_id
       LEFT JOIN business_profile_versions profile_version
         ON profile_version.id = profile.active_version_id AND profile_version.tenant_id = profile.tenant_id
      WHERE ci.tenant_id = $1
        AND ci.integration_type = 'WHATSAPP'
        AND ci.enabled = TRUE
        AND channel.channel_type = 'WHATSAPP'
      ORDER BY ci.created_at ASC`,
    [scopedTenantId],
  );
  auditPhase = 'COUNTS';
  const counts = latest ? await client.query(
    `SELECT
       (SELECT count(*)::integer FROM knowledge_generation_runs WHERE tenant_id=$1 AND target_type='RECOMMENDATION' AND request_fingerprint=$2) AS exact_attempt_count,
       (SELECT count(*)::integer FROM assistant_knowledge_recommendations WHERE tenant_id=$1 AND assistant_id=$3) AS recommendation_count,
       (SELECT count(*)::integer FROM assistant_configuration_versions WHERE tenant_id=$1 AND assistant_id=$3) AS configuration_count`,
    [tenantId, latest.request_fingerprint, latest.assistant_id],
  ) : { rows: [{ exact_attempt_count: 0, recommendation_count: 0, configuration_count: 0 }] };
  console.log(JSON.stringify({
    profile_context: context.rows[0],
    latest_run: latest,
    latest_configuration_run: latestConfigurationRun,
    whatsapp_runtime_rows: runtime.rows,
    counts: counts.rows[0],
    stage_history_available: false,
    stage_history_note: 'The bounded run model stores the latest stage and total elapsed_ms, not an event ledger.',
  }));
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  const safeCode = String(error?.code ?? '').replace(/[^A-Z0-9_]/gi, '_').slice(0, 32);
  console.error(/TLS/.test(String(error?.message)) ? 'TLS_VERIFICATION_FAILED' : `ASSISTANT_GENERATION_AUDIT_FAILED phase=${auditPhase} code=${safeCode || 'UNKNOWN'}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
