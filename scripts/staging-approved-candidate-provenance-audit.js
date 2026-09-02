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
  const jobs = await client.query(
    `SELECT job.id, job.source_id, job.status, job.attempts, job.last_error_code,
            job.metadata, job.created_at, job.updated_at
       FROM knowledge_processing_jobs job
       JOIN knowledge_base_documents source
         ON source.id = job.source_id AND source.tenant_id = job.tenant_id
      WHERE job.tenant_id = $1
        AND job.job_type = 'GENERATE_IMAGE_CANDIDATES'
        AND lower(source.title) = lower('whatsapp.png')
      ORDER BY job.created_at DESC LIMIT 10`,
    [identities.rows[0].tenant_id],
  );
  const recommendations = await client.query(
    `SELECT recommendation.id, recommendation.tenant_id, recommendation.assistant_id,
            recommendation.status,
            recommendation.evidence,
            recommendation.recommendation_data->'qualification_guidance' IS NOT NULL AS has_qualification_guidance
       FROM assistant_knowledge_recommendations recommendation
      WHERE recommendation.tenant_id = $1
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(recommendation.evidence) evidence_item
           WHERE evidence_item->>'source_id' IN (
             SELECT source.id::text FROM knowledge_base_documents source
              WHERE source.tenant_id = recommendation.tenant_id
                AND lower(source.title) = lower('whatsapp.png')
           )
        )
      ORDER BY recommendation.created_at DESC LIMIT 20`,
    [identities.rows[0].tenant_id],
  );
  const pendingCandidates = await client.query(
    `SELECT candidate.id, candidate.status, candidate.pii_redaction_status,
            candidate.image_semantic_version, candidate.approved_source_id,
            COUNT(image.id)::integer AS evidence_count,
            COUNT(image.id) FILTER (WHERE image.role = 'BUSINESS' AND image.evidence_kind = 'PRIMARY')::integer AS primary_business_evidence_count,
            COALESCE(array_agg(DISTINCT image.segment_order) FILTER (WHERE image.role = 'BUSINESS' AND image.evidence_kind = 'PRIMARY'), ARRAY[]::integer[]) AS primary_business_segment_orders,
            COUNT(DISTINCT image.business_identity_id) FILTER (WHERE image.business_identity_id IS NOT NULL)::integer AS snapshot_identity_count,
            COUNT(DISTINCT source_identity.business_identity_id) FILTER (WHERE source_identity.business_identity_id IS NOT NULL)::integer AS original_source_identity_count,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'id', materialized.id,
              'status', materialized.status,
              'enabled', materialized.enabled,
              'source_identity_link_count', COALESCE(materialized_identity.link_count, 0),
              'provenance_link_count', COALESCE(materialized_provenance.link_count, 0),
              'index_job_count', COALESCE(materialized_jobs.job_count, 0)
            )) FILTER (WHERE materialized.id IS NOT NULL), '[]'::json) AS matching_unapproved_materialized_sources
       FROM knowledge_candidates candidate
       JOIN knowledge_base_documents source
         ON source.tenant_id = candidate.tenant_id
        AND lower(source.title) = lower('whatsapp.png')
       LEFT JOIN knowledge_candidate_image_evidence image
         ON image.tenant_id = candidate.tenant_id
        AND image.candidate_id = candidate.id
        AND image.source_id = source.id
       LEFT JOIN knowledge_source_business_identities source_identity
         ON source_identity.tenant_id = image.tenant_id
        AND source_identity.source_id = image.source_id
       LEFT JOIN knowledge_base_documents materialized
         ON materialized.tenant_id = candidate.tenant_id
        AND materialized.source_type = 'CONVERSATION_CANDIDATE'
        AND materialized.content = candidate.proposed_content
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::integer AS link_count
           FROM knowledge_source_business_identities link
          WHERE link.tenant_id = materialized.tenant_id AND link.source_id = materialized.id
       ) materialized_identity ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::integer AS link_count
           FROM knowledge_materialized_source_provenance link
          WHERE link.tenant_id = materialized.tenant_id
            AND link.materialized_source_id = materialized.id
            AND link.candidate_id = candidate.id
       ) materialized_provenance ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::integer AS job_count
           FROM knowledge_processing_jobs job
          WHERE job.tenant_id = materialized.tenant_id AND job.source_id = materialized.id
       ) materialized_jobs ON TRUE
      WHERE candidate.tenant_id = $1
        AND candidate.status = 'NEEDS_REVIEW'
        AND candidate.proposed_title = 'Canonical image-derived business fact'
      GROUP BY candidate.id, candidate.status, candidate.pii_redaction_status,
               candidate.image_semantic_version, candidate.approved_source_id
      ORDER BY candidate.id`,
    [identities.rows[0].tenant_id],
  );
  const approvalFailures = await client.query(
    `SELECT diagnostic.candidate_id, diagnostic.materialized_source_id,
            diagnostic.original_source_id, diagnostic.phase, diagnostic.database_code,
            diagnostic.constraint_name, diagnostic.table_name, diagnostic.created_at
       FROM knowledge_candidate_approval_failure_diagnostics diagnostic
      WHERE diagnostic.tenant_id = $1
        AND EXISTS (
          SELECT 1
            FROM knowledge_candidate_image_evidence evidence
            JOIN knowledge_base_documents source
              ON source.id = evidence.source_id AND source.tenant_id = evidence.tenant_id
           WHERE evidence.tenant_id = diagnostic.tenant_id
             AND evidence.candidate_id = diagnostic.candidate_id
             AND lower(source.title) = lower('whatsapp.png')
        )
      ORDER BY diagnostic.created_at DESC
      LIMIT 10`,
    [identities.rows[0].tenant_id],
  );
  const result = await client.query(
    `WITH selected_identity AS (
       SELECT id, tenant_id, display_name
         FROM business_identities
        WHERE lower(display_name) = lower($1) AND status = 'ACTIVE'
     ), candidate_scope AS (
       SELECT candidate.id AS candidate_id, candidate.tenant_id, candidate.assistant_id, candidate.status,
              candidate.image_semantic_version,
              candidate.candidate_fingerprint,
              candidate.candidate_fingerprint IS NOT NULL AS candidate_fingerprint_present,
              candidate.approved_source_id AS materialized_source_id,
              materialized.title AS materialized_source_title
         FROM knowledge_candidates candidate
         JOIN selected_identity identity ON identity.tenant_id = candidate.tenant_id
         LEFT JOIN knowledge_base_documents materialized
           ON materialized.id = candidate.approved_source_id
          AND materialized.tenant_id = candidate.tenant_id
        WHERE candidate.status = 'APPROVED'
          AND candidate.proposed_title = 'Canonical image-derived business fact'
     )
     SELECT candidate.candidate_id, candidate.tenant_id, candidate.status,
            candidate.image_semantic_version, candidate.candidate_fingerprint_present,
            candidate.materialized_source_id, candidate.materialized_source_title,
            COUNT(image.id)::integer AS evidence_count,
            COALESCE(fingerprint_matches.match_count, 0)::integer AS deterministic_segment_match_count,
            COALESCE(fingerprint_matches.matches, '[]'::jsonb) AS deterministic_segment_matches,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'evidence_id', image.id, 'segment_id', image.segment_id,
              'original_source_id', image.source_id, 'original_source_title', original.title,
              'original_identity_ids', COALESCE(original_ids.ids, '[]'::jsonb),
              'original_identity_evidence', COALESCE(original_evidence.items, '[]'::jsonb),
              'materialized_identity_ids', COALESCE(materialized_ids.ids, '[]'::jsonb),
              'materialized_identity_evidence', COALESCE(materialized_evidence.items, '[]'::jsonb),
              'provenance_row_exists', provenance.materialized_source_id IS NOT NULL
            )) FILTER (WHERE image.id IS NOT NULL), '[]'::json) AS evidence
       FROM candidate_scope candidate
       LEFT JOIN knowledge_candidate_image_evidence image
         ON image.tenant_id = candidate.tenant_id AND image.candidate_id = candidate.candidate_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS match_count,
                jsonb_agg(jsonb_build_object(
                  'segment_id', segment.id,
                  'original_source_id', segment.source_id,
                  'original_source_title', matched_source.title,
                  'is_current', segment.is_current,
                  'original_identity_ids', COALESCE(matched_identity_ids.ids, '[]'::jsonb),
                  'original_identity_evidence', COALESCE(matched_identity_evidence.items, '[]'::jsonb)
                )) AS matches
           FROM knowledge_source_extraction_segments segment
           JOIN knowledge_base_documents matched_source
             ON matched_source.id = segment.source_id
            AND matched_source.tenant_id = segment.tenant_id
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(DISTINCT link.business_identity_id) AS ids
               FROM knowledge_source_business_identities link
              WHERE link.tenant_id = segment.tenant_id AND link.source_id = segment.source_id
           ) matched_identity_ids ON TRUE
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
               'business_identity_id', evidence.business_identity_id,
               'confidence', evidence.confidence,
               'matches_selected_identity', evidence.business_identity_id = $2::uuid
             )) AS items
               FROM business_identity_source_evidence evidence
              WHERE evidence.tenant_id = segment.tenant_id AND evidence.source_id = segment.source_id
           ) matched_identity_evidence ON TRUE
          WHERE segment.tenant_id = candidate.tenant_id
            AND segment.role = 'BUSINESS'
            AND matched_source.mime_type IN ('image/jpeg', 'image/png')
            AND candidate.candidate_fingerprint = encode(digest(
              candidate.tenant_id::text || ':' || COALESCE(candidate.assistant_id::text, '') || ':' ||
              segment.source_id::text || ':' || segment.extraction_hash || ':' || segment.segment_order::text,
              'sha256'
            ), 'hex')
       ) fingerprint_matches ON TRUE
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
         SELECT jsonb_agg(jsonb_build_object(
           'business_identity_id', evidence.business_identity_id,
           'confidence', evidence.confidence,
           'matches_selected_identity', evidence.business_identity_id = $2::uuid
         )) AS items
           FROM business_identity_source_evidence evidence
          WHERE evidence.tenant_id = image.tenant_id AND evidence.source_id = image.source_id
       ) original_evidence ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(DISTINCT link.business_identity_id) AS ids
           FROM knowledge_source_business_identities link
          WHERE link.tenant_id = candidate.tenant_id AND link.source_id = candidate.materialized_source_id
       ) materialized_ids ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'business_identity_id', evidence.business_identity_id,
           'confidence', evidence.confidence,
           'matches_selected_identity', evidence.business_identity_id = $2::uuid
         )) AS items
           FROM business_identity_source_evidence evidence
          WHERE evidence.tenant_id = candidate.tenant_id AND evidence.source_id = candidate.materialized_source_id
       ) materialized_evidence ON TRUE
      GROUP BY candidate.candidate_id, candidate.tenant_id, candidate.status,
               candidate.image_semantic_version, candidate.candidate_fingerprint_present,
               candidate.materialized_source_id, candidate.materialized_source_title,
               fingerprint_matches.match_count, fingerprint_matches.matches
      ORDER BY candidate.candidate_id`,
    [identityName, identities.rows[0].id],
  );
  console.log(JSON.stringify({
    identity_name: identityName,
    matched_identity_count: 1,
    business_identity: identities.rows[0],
    semantic_jobs: jobs.rows.map((job) => ({
      id: job.id,
      source_id: job.source_id,
      status: job.status,
      attempts: job.attempts,
      last_error_code: job.last_error_code,
      candidate_count: Number.isFinite(Number(job.metadata?.candidate_count)) ? Number(job.metadata.candidate_count) : null,
      behavior_recommendation_count: Number.isFinite(Number(job.metadata?.behavior_recommendation_count)) ? Number(job.metadata.behavior_recommendation_count) : null,
      warning_count: Array.isArray(job.metadata?.warnings) ? job.metadata.warnings.length : null,
      metadata_keys: job.metadata && typeof job.metadata === 'object' ? Object.keys(job.metadata).sort() : [],
      created_at: job.created_at,
      updated_at: job.updated_at,
    })),
    behavior_recommendations: recommendations.rows.map(({ evidence, ...row }) => ({ ...row, evidence_item_count: Array.isArray(evidence) ? evidence.length : null })),
    needs_review_candidates: pendingCandidates.rows,
    approval_failure_diagnostics: approvalFailures.rows,
    candidate_count: result.rowCount,
    candidates: result.rows,
  }));
  await client.query('ROLLBACK');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(String(error?.message ?? 'CANDIDATE_PROVENANCE_AUDIT_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 120));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
