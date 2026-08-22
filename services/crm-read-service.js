// CRM read paths deliberately have no dependency on qualification execution.
// They are kept separate so listing/viewing CRM data can never invoke a model.

export async function listLeads(queryFn, { tenantId, limit, offset, temperature, stageId, assignedUserId }) {
  const values = [tenantId];
  const where = ['l.tenant_id = $1'];
  if (temperature) {
    values.push(temperature);
    where.push(`l.temperature = $${values.length}`);
  }
  if (stageId) {
    values.push(stageId);
    where.push(`l.pipeline_stage_id = $${values.length}`);
  }
  if (assignedUserId) {
    values.push(assignedUserId);
    where.push(`l.assigned_user_id = $${values.length}`);
  }
  values.push(limit, offset);
  const result = await queryFn(
    `SELECT l.*, c.display_name, c.email, c.phone, s.name AS pipeline_stage, s.stage_key,
            u.email AS assigned_user_email, COUNT(*) OVER() AS total
       FROM crm_leads l
       JOIN crm_contacts c ON c.id = l.contact_id AND c.tenant_id = l.tenant_id
       JOIN crm_pipeline_stages s ON s.id = l.pipeline_stage_id AND s.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.assigned_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.last_activity_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { items: result.rows, total: Number(result.rows[0]?.total ?? 0), limit, offset };
}

export async function getLead(queryFn, { tenantId, leadId }) {
  const result = await queryFn(
    `SELECT l.*, c.first_name, c.last_name, c.display_name, c.email, c.phone, c.language, c.country,
            s.name AS pipeline_stage, s.stage_key, u.email AS assigned_user_email
       FROM crm_leads l
       JOIN crm_contacts c ON c.id = l.contact_id AND c.tenant_id = l.tenant_id
       JOIN crm_pipeline_stages s ON s.id = l.pipeline_stage_id AND s.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.assigned_user_id
      WHERE l.tenant_id = $1 AND l.id = $2`,
    [tenantId, leadId]
  );
  return result.rows[0] ?? null;
}

export async function listContacts(queryFn, { tenantId, limit, offset }) {
  const result = await queryFn(
    'SELECT *, COUNT(*) OVER() AS total FROM crm_contacts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [tenantId, limit, offset]
  );
  return { items: result.rows, total: Number(result.rows[0]?.total ?? 0), limit, offset };
}

export async function getContact(queryFn, { tenantId, contactId }) {
  const result = await queryFn('SELECT * FROM crm_contacts WHERE tenant_id = $1 AND id = $2', [tenantId, contactId]);
  return result.rows[0] ?? null;
}

export async function listCompanies(queryFn, { tenantId, limit, offset }) {
  const result = await queryFn(
    'SELECT *, COUNT(*) OVER() AS total FROM crm_companies WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [tenantId, limit, offset]
  );
  return { items: result.rows, total: Number(result.rows[0]?.total ?? 0), limit, offset };
}

export async function listPipelineStages(queryFn, { tenantId }) {
  const result = await queryFn('SELECT * FROM crm_pipeline_stages WHERE tenant_id = $1 ORDER BY position', [tenantId]);
  return result.rows;
}

export async function listDeals(queryFn, { tenantId, limit, offset }) {
  const result = await queryFn(
    `SELECT d.*, l.contact_id, s.name AS pipeline_stage, COUNT(*) OVER() AS total
       FROM crm_deals d
       JOIN crm_leads l ON l.id = d.lead_id AND l.tenant_id = d.tenant_id
       JOIN crm_pipeline_stages s ON s.id = d.pipeline_stage_id AND s.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1
      ORDER BY d.updated_at DESC
      LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset]
  );
  return { items: result.rows, total: Number(result.rows[0]?.total ?? 0), limit, offset };
}

