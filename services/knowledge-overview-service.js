const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class KnowledgeOverviewError extends Error { constructor(code, message) { super(message); this.code = code; } }

export async function getKnowledgeOverview({ database, tenantId }) {
  if (!database?.query) throw new KnowledgeOverviewError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  if (!UUID_PATTERN.test(String(tenantId ?? ''))) throw new KnowledgeOverviewError('KNOWLEDGE_TENANT_INVALID', 'Tenant identifier is invalid');
  const result = await database.query(
    `SELECT
      (SELECT count(*) FROM knowledge_base_documents WHERE tenant_id = $1 AND enabled = TRUE AND processing_status = 'READY') AS ready_sources,
      (SELECT count(*) FROM knowledge_base_documents WHERE tenant_id = $1 AND enabled = TRUE AND processing_status IN ('UPLOADED', 'PROCESSING')) AS processing_sources,
      (SELECT count(*) FROM knowledge_base_documents WHERE tenant_id = $1 AND processing_status = 'FAILED') AS failed_sources,
      (SELECT count(*) FROM knowledge_candidates WHERE tenant_id = $1 AND status IN ('DRAFT', 'NEEDS_REVIEW')) AS review_candidates,
      (SELECT count(*) FROM knowledge_gaps WHERE tenant_id = $1 AND status IN ('DRAFT', 'NEEDS_REVIEW')) AS open_gaps,
      (SELECT count(*) FROM business_profile_versions WHERE tenant_id = $1 AND status IN ('DRAFT', 'NEEDS_REVIEW')) AS review_profiles,
      (SELECT count(*) FROM business_profiles WHERE tenant_id = $1 AND active_version_id IS NOT NULL) AS active_profile,
      (SELECT count(*) FROM assistant_knowledge_recommendations WHERE tenant_id = $1 AND status IN ('DRAFT', 'NEEDS_REVIEW')) AS review_recommendations,
      (SELECT count(*) FROM assistant_configuration_versions WHERE tenant_id = $1 AND status IN ('DRAFT', 'NEEDS_REVIEW')) AS review_configurations,
      (SELECT count(*) FROM assistant_configuration_versions WHERE tenant_id = $1 AND status = 'ACTIVE') AS active_configurations,
      (SELECT count(*) FROM ai_assistants WHERE tenant_id = $1 AND status = 'active') AS assistants`,
    [tenantId],
  );
  const row = result.rows[0] ?? {};
  return {
    sources: { ready: Number(row.ready_sources ?? 0), processing: Number(row.processing_sources ?? 0), failed: Number(row.failed_sources ?? 0) },
    reviewQueue: { candidates: Number(row.review_candidates ?? 0), profiles: Number(row.review_profiles ?? 0), recommendations: Number(row.review_recommendations ?? 0), configurations: Number(row.review_configurations ?? 0) },
    gaps: { open: Number(row.open_gaps ?? 0) },
    runtime: { activeProfile: Number(row.active_profile ?? 0) > 0, activeConfigurations: Number(row.active_configurations ?? 0), assistants: Number(row.assistants ?? 0) },
  };
}
