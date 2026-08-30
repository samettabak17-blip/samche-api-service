import pg from 'pg';
import { assertVerifiedTls, strictTlsConfig } from './staging-task6-e2e-support.js';

const tenantId = String(process.env.TASK6_AUDIT_TENANT_ID ?? '').trim();
const profileVersionId = String(process.env.TASK6_AUDIT_PROFILE_VERSION_ID ?? '').trim();
if (!tenantId || !profileVersionId || !process.env.STAGING_DATABASE_URL) throw new Error('ASSISTANT_GENERATION_AUDIT_INPUT_REQUIRED');

const client = new pg.Client(strictTlsConfig(process.env.STAGING_DATABASE_URL));
try {
  await client.connect();
  assertVerifiedTls(client);
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  const context = await client.query(
    `SELECT version.id AS profile_version_id, version.status AS profile_status,
            profile.active_version_id, profile.business_identity_id,
            jsonb_array_length(COALESCE(version.source_scope->'source_ids','[]'::jsonb)) AS source_count,
            COALESCE(version.evidence->'source_hashes','[]'::jsonb) AS source_hashes,
            length(version.profile_data::text) AS profile_json_character_count
       FROM business_profile_versions version
       JOIN business_profiles profile ON profile.id=version.profile_id AND profile.tenant_id=version.tenant_id
      WHERE version.tenant_id=$1 AND version.id=$2`,
    [tenantId, profileVersionId],
  );
  if (context.rowCount !== 1) throw new Error('ASSISTANT_GENERATION_AUDIT_SCOPE_NOT_UNIQUE');
  const runs = await client.query(
    `SELECT run.id AS run_id, run.request_fingerprint, run.tenant_id,
            run.input_provenance->>'assistant_id' AS assistant_id,
            assistant.name AS assistant_name,
            run.input_provenance->>'profile_version_id' AS business_profile_version_id,
            run.input_provenance->'source_scope' AS source_scope,
            run.input_provenance->'source_hashes' AS source_hashes,
            run.provider, run.model, run.prompt_character_count, run.source_count,
            run.stage, run.elapsed_ms, run.status, run.error_code, run.target_id,
            run.created_at, run.completed_at,
            recommendation.id AS recommendation_id, recommendation.status AS recommendation_status
       FROM knowledge_generation_runs run
       LEFT JOIN ai_assistants assistant
         ON assistant.id=(run.input_provenance->>'assistant_id')::uuid AND assistant.tenant_id=run.tenant_id
       LEFT JOIN assistant_knowledge_recommendations recommendation
         ON recommendation.id=run.target_id AND recommendation.tenant_id=run.tenant_id
      WHERE run.tenant_id=$1 AND run.target_type='RECOMMENDATION'
        AND run.input_provenance->>'profile_version_id'=$2
      ORDER BY run.created_at DESC LIMIT 10`,
    [tenantId, profileVersionId],
  );
  const latest = runs.rows[0] ?? null;
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
    counts: counts.rows[0],
    stage_history_available: false,
    stage_history_note: 'The bounded run model stores the latest stage and total elapsed_ms, not an event ledger.',
  }));
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(/TLS/.test(String(error?.message)) ? 'TLS_VERIFICATION_FAILED' : String(error?.message ?? 'ASSISTANT_GENERATION_AUDIT_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 120));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
