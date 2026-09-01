import pg from 'pg';
import { assertVerifiedTls, strictTlsConfig } from './staging-task6-e2e-support.js';

const identityName = String(process.env.TASK6_AUDIT_IDENTITY_NAME ?? '').trim();
if (!identityName || !process.env.STAGING_DATABASE_URL) throw new Error('CANDIDATE_PROVENANCE_AUDIT_INPUT_REQUIRED');

const client = new pg.Client(strictTlsConfig(process.env.STAGING_DATABASE_URL));
try {
  await client.connect();
  assertVerifiedTls(client);
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  const identities = await client.query(
    `SELECT id, tenant_id, display_name
       FROM business_identities
      WHERE lower(display_name) = lower($1) AND status = 'ACTIVE'`,
    [identityName],
  );
  if (identities.rowCount !== 1) {
    console.log(JSON.stringify({ identity_name: identityName, matched_identity_count: identities.rowCount, candidate_count: 0, candidates: [] }));
    await client.query('ROLLBACK');
    process.exitCode = 0;
  } else {
  const result = await client.query(
    `WITH selected_identity AS (
       SELECT id, tenant_id, display_name
         FROM business_identities
        WHERE lower(display_name) = lower($1) AND status = 'ACTIVE'
     ), candidate_scope AS (
       SELECT candidate.id AS candidate_id, candidate.tenant_id, candidate.status,
              candidate.approved_source_id AS materialized_source_id,
              materialized.title AS materialized_source_title
         FROM knowledge_candidates candidate
         JOIN selected_identity identity ON identity.tenant_id = candidate.tenant_id
         LEFT JOIN knowledge_base_documents materialized
           ON materialized.id = candidate.approved_source_id
          AND materialized.tenant_id = candidate.tenant_id
        WHERE candidate.status = 'APPROVED'
          AND EXISTS (
            SELECT 1 FROM knowledge_candidate_image_evidence image
             WHERE image.tenant_id = candidate.tenant_id AND image.candidate_id = candidate.id
          )
     )
     SELECT candidate.candidate_id, candidate.tenant_id, candidate.status,
            candidate.materialized_source_id, candidate.materialized_source_title,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'evidence_id', image.id, 'segment_id', image.segment_id,
              'original_source_id', image.source_id, 'original_source_title', original.title,
              'original_identity_ids', COALESCE(original_ids.ids, '[]'::jsonb),
              'materialized_identity_ids', COALESCE(materialized_ids.ids, '[]'::jsonb),
              'provenance_row_exists', provenance.materialized_source_id IS NOT NULL
            )) FILTER (WHERE image.id IS NOT NULL), '[]'::json) AS evidence
       FROM candidate_scope candidate
       LEFT JOIN knowledge_candidate_image_evidence image
         ON image.tenant_id = candidate.tenant_id AND image.candidate_id = candidate.candidate_id
       LEFT JOIN knowledge_base_documents original
         ON original.id = image.source_id AND original.tenant_id = image.tenant_id
       LEFT JOIN knowledge_materialized_source_provenance provenance
         ON provenance.tenant_id = candidate.tenant_id
        AND provenance.materialized_source_id = candidate.materialized_source_id
        AND provenance.candidate_id = candidate.candidate_id
        AND provenance.original_source_id = image.source_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(DISTINCT link.business_identity_id) AS ids
           FROM knowledge_source_business_identities link
          WHERE link.tenant_id = candidate.tenant_id AND link.source_id = image.source_id
       ) original_ids ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(DISTINCT link.business_identity_id) AS ids
           FROM knowledge_source_business_identities link
          WHERE link.tenant_id = candidate.tenant_id AND link.source_id = candidate.materialized_source_id
       ) materialized_ids ON TRUE
      GROUP BY candidate.candidate_id, candidate.tenant_id, candidate.status,
               candidate.materialized_source_id, candidate.materialized_source_title
      ORDER BY candidate.candidate_id`,
    [identityName],
  );
  console.log(JSON.stringify({ identity_name: identityName, matched_identity_count: 1, business_identity: identities.rows[0], candidate_count: result.rowCount, candidates: result.rows }));
  await client.query('ROLLBACK');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(String(error?.message ?? 'CANDIDATE_PROVENANCE_AUDIT_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 120));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
