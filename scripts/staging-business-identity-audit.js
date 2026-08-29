import pg from 'pg';
import { assertVerifiedTls, strictTlsConfig } from './staging-task6-e2e-support.js';
import { normalizeBusinessIdentity } from '../services/business-identity-service.js';

const identityName = String(process.env.TASK6_AUDIT_IDENTITY_NAME ?? '').trim();
const sourceTitle = String(process.env.TASK6_AUDIT_SOURCE_TITLE ?? '').trim();
if (!identityName || !sourceTitle || !process.env.STAGING_DATABASE_URL) throw new Error('IDENTITY_AUDIT_INPUT_REQUIRED');

const client = new pg.Client(strictTlsConfig(process.env.STAGING_DATABASE_URL));
try {
  await client.connect();
  assertVerifiedTls(client);
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  const scope = await client.query(
    `SELECT identity.id AS business_identity_id, identity.tenant_id, identity.display_name, identity.normalized_identity,
            source.id AS source_id, source.title, source.content_hash, source.content
       FROM business_identities identity
       JOIN knowledge_base_documents source ON source.tenant_id = identity.tenant_id
      WHERE identity.display_name = $1 AND source.title = $2
        AND identity.status = 'ACTIVE' AND source.enabled = TRUE
        AND source.status = 'active' AND source.processing_status = 'READY'
        AND source.indexing_status = 'READY'`,
    [identityName, sourceTitle],
  );
  if (scope.rowCount !== 1) throw new Error('IDENTITY_AUDIT_SCOPE_NOT_UNIQUE');
  const selected = scope.rows[0];
  const evidence = await client.query(
    `SELECT detected_identity, normalized_detected_identity, confidence, safe_evidence,
            content_hash = $3 AS current_hash_match, provider, model, analysis_schema_version
       FROM business_identity_source_evidence
      WHERE business_identity_id = $1 AND source_id = $2
      ORDER BY updated_at DESC`,
    [selected.business_identity_id, selected.source_id, selected.content_hash],
  );
  const identityMentions = [...new Set(String(selected.content ?? '').match(/[\p{L}\p{N}&.'’-]+(?:\s+[\p{L}\p{N}&.'’-]+){0,7}\s+(?:L\.?L\.?C\.?|Ltd\.?|Limited|Inc\.?|Corporation|Company)/giu) ?? [])]
    .map((value) => value.replace(/\s+/g, ' ').trim()).slice(0, 12);
  const candidates = evidence.rows.map((row) => ({
    detected_identity: row.detected_identity || 'unknown',
    normalized_identity: row.normalized_detected_identity,
    confidence: Number(row.confidence),
    safe_evidence: row.safe_evidence,
    current_hash_match: row.current_hash_match,
    provider: row.provider,
    model: row.model,
    analysis_schema_version: row.analysis_schema_version,
  }));
  const generation = await client.query(
    `SELECT run.id AS run_id, run.request_fingerprint, run.business_identity_id, run.stage,
            run.provider, run.model, run.prompt_character_count, run.source_count, run.elapsed_ms,
            run.status AS run_status, run.error_code, run.target_id, run.created_at, run.completed_at,
            run.input_provenance->'source_ids' AS selected_source_ids,
            run.input_provenance->'source_hashes' AS selected_source_hashes,
            version.id AS version_id, version.profile_id, version.status AS version_status,
            version.identity_resolution_status, profile.active_version_id,
            (version.id = profile.active_version_id) AS is_active
       FROM knowledge_generation_runs run
       LEFT JOIN business_profile_versions version
         ON version.id = run.target_id AND version.tenant_id = run.tenant_id
       LEFT JOIN business_profiles profile
         ON profile.id = version.profile_id AND profile.tenant_id = version.tenant_id
      WHERE run.tenant_id = $1 AND run.business_identity_id = $2
        AND run.target_type = 'BUSINESS_PROFILE' AND run.source_count = 1
        AND run.input_provenance->'source_ids' = jsonb_build_array($3::text)
      ORDER BY run.created_at DESC
      LIMIT 5`,
    [selected.tenant_id, selected.business_identity_id, selected.source_id],
  );
  console.log(JSON.stringify({
    business_identity: { display_name: selected.display_name, stored_normalized_identity: selected.normalized_identity, recomputed_normalized_identity: normalizeBusinessIdentity(selected.display_name) },
    source: { title: selected.title, content_hash_matches: candidates.map((item) => item.current_hash_match), document_identity_mentions: identityMentions },
    candidate_count: candidates.length,
    candidates,
    generation_attempts: generation.rows,
  }));
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(/TLS/.test(String(error?.message)) ? 'TLS_VERIFICATION_FAILED' : String(error?.message ?? 'IDENTITY_AUDIT_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 120));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
