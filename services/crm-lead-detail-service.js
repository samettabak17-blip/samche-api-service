// Read-only CRM lead detail projection. Every related record is correlated to
// the lead's tenant, so IDs from another tenant cannot be exposed by detail UI.
export async function getCrmLeadDetail(queryFn, { tenantId, leadId }) {
  const result = await queryFn(
    `SELECT l.*, c.first_name, c.last_name, c.display_name, c.email, c.phone, c.language, c.country,
            co.id AS company_id, co.name AS company_name, co.website AS company_website,
            co.industry AS company_industry, co.country AS company_country,
            s.name AS pipeline_stage, s.stage_key, u.email AS assigned_user_email,
            (
              SELECT jsonb_build_object(
                'id', a.id, 'analysis_hash', a.analysis_hash, 'summary', a.summary,
                'recommended_action', a.recommended_action, 'signals', a.signals,
                'reason_codes', a.reason_codes, 'provider', a.provider, 'model', a.model,
                'model_version', a.model_version, 'analyzed_at', a.analyzed_at
              )
                FROM crm_lead_analyses a
               WHERE a.tenant_id = l.tenant_id AND a.lead_id = l.id
               ORDER BY a.analyzed_at DESC, a.id DESC
               LIMIT 1
            ) AS latest_analysis,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', d.id, 'title', d.title, 'value', d.value, 'currency', d.currency,
                'status', d.status, 'pipeline_stage_id', d.pipeline_stage_id,
                'expected_close_date', d.expected_close_date, 'created_at', d.created_at, 'updated_at', d.updated_at
              ) ORDER BY d.updated_at DESC)
                FROM crm_deals d
               WHERE d.tenant_id = l.tenant_id AND d.lead_id = l.id
            ), '[]'::jsonb) AS deals,
            COALESCE((
              SELECT jsonb_agg(activity_row ORDER BY (activity_row->>'created_at') DESC)
                FROM (
                  SELECT jsonb_build_object(
                    'id', ca.id, 'event_type', ca.event_type, 'metadata', ca.metadata,
                    'created_at', ca.created_at, 'conversation_id', ca.conversation_id,
                    'actor_user_id', ca.actor_user_id, 'actor_email', actor.email
                  ) AS activity_row
                    FROM crm_activities ca
                    LEFT JOIN users actor ON actor.id = ca.actor_user_id
                   WHERE ca.tenant_id = l.tenant_id AND ca.lead_id = l.id
                   ORDER BY ca.created_at DESC, ca.id DESC
                   LIMIT 50
                ) latest_activities
            ), '[]'::jsonb) AS activities
       FROM crm_leads l
       JOIN crm_contacts c ON c.id = l.contact_id AND c.tenant_id = l.tenant_id
       JOIN crm_pipeline_stages s ON s.id = l.pipeline_stage_id AND s.tenant_id = l.tenant_id
       LEFT JOIN crm_companies co ON co.id = l.company_id AND co.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.assigned_user_id
      WHERE l.tenant_id = $1 AND l.id = $2`,
    [tenantId, leadId]
  );
  return result.rows[0] ?? null;
}
