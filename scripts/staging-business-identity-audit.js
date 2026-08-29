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
    `SELECT identity.id AS business_identity_id, identity.display_name, identity.normalized_identity,
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
  console.log(JSON.stringify({
    business_identity: { display_name: selected.display_name, stored_normalized_identity: selected.normalized_identity, recomputed_normalized_identity: normalizeBusinessIdentity(selected.display_name) },
    source: { title: selected.title, content_hash_matches: candidates.map((item) => item.current_hash_match), document_identity_mentions: identityMentions },
    candidate_count: candidates.length,
    candidates,
  }));
  await client.query('ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(/TLS/.test(String(error?.message)) ? 'TLS_VERIFICATION_FAILED' : String(error?.message ?? 'IDENTITY_AUDIT_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 120));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
