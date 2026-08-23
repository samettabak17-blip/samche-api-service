// CRM read paths deliberately have no dependency on qualification execution.
// They are kept separate so listing/viewing CRM data can never invoke a model.

function pageResult(result, limit, offset) {
  return { items: result.rows, total: Number(result.rows[0]?.total ?? 0), limit, offset };
}

export async function listLeads(queryFn, { tenantId, limit, offset, temperature, stageId, assignedUserId, source, conversationId }) {
  const values = [tenantId];
  const where = ['l.tenant_id = $1'];
  if (temperature) { values.push(temperature); where.push('l.temperature = $' + values.length); }
  if (stageId) { values.push(stageId); where.push('l.pipeline_stage_id = $' + values.length); }
  if (assignedUserId) { values.push(assignedUserId); where.push('l.assigned_user_id = $' + values.length); }
  if (source) { values.push(source); where.push('l.source_channel = $' + values.length); }
  if (conversationId) { values.push(conversationId); where.push('l.conversation_id = $' + values.length); }
  values.push(limit, offset);
  const result = await queryFn(
    'SELECT l.*, c.display_name, c.email, c.phone, s.name AS pipeline_stage, s.stage_key, ' +
    'u.email AS assigned_user_email, COUNT(*) OVER() AS total ' +
    'FROM crm_leads l ' +
    'JOIN crm_contacts c ON c.id = l.contact_id AND c.tenant_id = l.tenant_id ' +
    'JOIN crm_pipeline_stages s ON s.id = l.pipeline_stage_id AND s.tenant_id = l.tenant_id ' +
    'LEFT JOIN users u ON u.id = l.assigned_user_id ' +
    'WHERE ' + where.join(' AND ') + ' ' +
    'ORDER BY l.last_activity_at DESC LIMIT $' + (values.length - 1) + ' OFFSET $' + values.length,
    values,
  );
  return pageResult(result, limit, offset);
}

export async function getLead(queryFn, { tenantId, leadId }) {
  const result = await queryFn(
    'SELECT l.*, c.first_name, c.last_name, c.display_name, c.email, c.phone, c.language, c.country, ' +
    's.name AS pipeline_stage, s.stage_key, u.email AS assigned_user_email ' +
    'FROM crm_leads l ' +
    'JOIN crm_contacts c ON c.id = l.contact_id AND c.tenant_id = l.tenant_id ' +
    'JOIN crm_pipeline_stages s ON s.id = l.pipeline_stage_id AND s.tenant_id = l.tenant_id ' +
    'LEFT JOIN users u ON u.id = l.assigned_user_id ' +
    'WHERE l.tenant_id = $1 AND l.id = $2',
    [tenantId, leadId],
  );
  return result.rows[0] ?? null;
}

export async function listContacts(queryFn, { tenantId, limit, offset }) {
  const result = await queryFn(
    'SELECT c.*, COUNT(d.id)::int AS deal_count, COUNT(*) OVER() AS total ' +
    'FROM crm_contacts c ' +
    'LEFT JOIN crm_deals d ON d.tenant_id = c.tenant_id AND d.contact_id = c.id AND d.archived_at IS NULL ' +
    'WHERE c.tenant_id = $1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT $2 OFFSET $3',
    [tenantId, limit, offset],
  );
  return pageResult(result, limit, offset);
}

export async function getContact(queryFn, { tenantId, contactId }) {
  const result = await queryFn('SELECT * FROM crm_contacts WHERE tenant_id = $1 AND id = $2', [tenantId, contactId]);
  const contact = result.rows[0];
  if (!contact) return null;
  const deals = await listDeals(queryFn, { tenantId, limit: 100, offset: 0, contactId });
  return { ...contact, deals: deals.items, deals_total: deals.total };
}

export async function listCompanies(queryFn, { tenantId, limit, offset }) {
  const result = await queryFn('SELECT *, COUNT(*) OVER() AS total FROM crm_companies WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',[tenantId, limit, offset]);
  return pageResult(result, limit, offset);
}

export async function listPipelineStages(queryFn, { tenantId }) {
  const result = await queryFn('SELECT * FROM crm_pipeline_stages WHERE tenant_id = $1 ORDER BY position', [tenantId]);
  return result.rows;
}

export async function listDeals(queryFn, { tenantId, limit, offset, stageId, contactId, ownerUserId, status, source, includeArchived = false }) {
  const values = [tenantId];
  const where = ['d.tenant_id = $1'];
  if (!includeArchived) where.push('d.archived_at IS NULL');
  if (stageId) { values.push(stageId); where.push('d.pipeline_stage_id = $' + values.length); }
  if (contactId) { values.push(contactId); where.push('d.contact_id = $' + values.length); }
  if (ownerUserId) { values.push(ownerUserId); where.push('d.owner_user_id = $' + values.length); }
  if (status) { values.push(status); where.push('d.status = $' + values.length); }
  if (source) { values.push(source); where.push('d.source = $' + values.length); }
  values.push(limit, offset);
  const result = await queryFn(
    'SELECT d.*, c.display_name AS contact_display_name, c.email AS contact_email, c.phone AS contact_phone, ' +
    'l.id AS lead_id, s.name AS pipeline_stage, s.stage_key, owner.email AS owner_email, COUNT(*) OVER() AS total ' +
    'FROM crm_deals d ' +
    'JOIN crm_contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id ' +
    'LEFT JOIN crm_leads l ON l.id = d.lead_id AND l.tenant_id = d.tenant_id ' +
    'JOIN crm_pipeline_stages s ON s.id = d.pipeline_stage_id AND s.tenant_id = d.tenant_id ' +
    'LEFT JOIN users owner ON owner.id = d.owner_user_id ' +
    'WHERE ' + where.join(' AND ') + ' ORDER BY d.updated_at DESC, d.id DESC ' +
    'LIMIT $' + (values.length - 1) + ' OFFSET $' + values.length,
    values,
  );
  return pageResult(result, limit, offset);
}

export async function getDeal(queryFn, { tenantId, dealId }) {
  const result = await queryFn(
    'SELECT d.*, c.display_name AS contact_display_name, c.email AS contact_email, c.phone AS contact_phone, ' +
    'l.id AS lead_id, s.name AS pipeline_stage, s.stage_key, owner.email AS owner_email ' +
    'FROM crm_deals d ' +
    'JOIN crm_contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id ' +
    'LEFT JOIN crm_leads l ON l.id = d.lead_id AND l.tenant_id = d.tenant_id ' +
    'JOIN crm_pipeline_stages s ON s.id = d.pipeline_stage_id AND s.tenant_id = d.tenant_id ' +
    'LEFT JOIN users owner ON owner.id = d.owner_user_id ' +
    'WHERE d.tenant_id = $1 AND d.id = $2 AND d.archived_at IS NULL',
    [tenantId, dealId],
  );
  return result.rows[0] ?? null;
}

export async function getPipelineSummary(queryFn, { tenantId }) {
  const result = await queryFn(
    'SELECT s.id, s.tenant_id, s.stage_key, s.name, s.position, s.is_terminal, ' +
    'COUNT(d.id)::int AS deal_count, COALESCE(SUM(d.value), 0) AS total_value ' +
    'FROM crm_pipeline_stages s ' +
    'LEFT JOIN crm_deals d ON d.tenant_id = s.tenant_id AND d.pipeline_stage_id = s.id AND d.archived_at IS NULL ' +
    'WHERE s.tenant_id = $1 GROUP BY s.id ORDER BY s.position',
    [tenantId],
  );
  return result.rows;
}

export async function getCrmOverviewMetrics(queryFn, { tenantId }) {
  const result = await queryFn(
    'WITH active_deals AS (SELECT d.*, s.stage_key FROM crm_deals d ' +
    'JOIN crm_pipeline_stages s ON s.id = d.pipeline_stage_id AND s.tenant_id = d.tenant_id ' +
    'WHERE d.tenant_id = $1 AND d.archived_at IS NULL) ' +
    'SELECT ' +
    '(SELECT COUNT(*)::int FROM crm_contacts WHERE tenant_id = $1) AS total_contacts, ' +
    '(SELECT COUNT(*)::int FROM active_deals WHERE stage_key NOT IN (\'WON\', \'LOST\')) AS open_deals, ' +
    '(SELECT COALESCE(SUM(value), 0) FROM active_deals WHERE stage_key NOT IN (\'WON\', \'LOST\')) AS pipeline_value, ' +
    '(SELECT COUNT(*)::int FROM active_deals WHERE stage_key = \'WON\') AS won_deals, ' +
    '(SELECT COALESCE(SUM(value), 0) FROM active_deals WHERE stage_key = \'WON\') AS won_revenue',
    [tenantId],
  );
  return result.rows[0];
}
