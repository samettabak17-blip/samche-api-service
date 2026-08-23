import express from 'express';
import { query } from '../config/db.js';
import { authenticateToken, requireTenantAccess } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';
import { canOperateCrmLead, canWriteCrm } from '../services/crm-permissions.js';
import { queueLeadQualification } from '../services/lead-qualification-runner.js';
import { getCrmLeadDetail } from '../services/crm-lead-detail-service.js';
import {
  getContact, getCrmOverviewMetrics, getDeal, getPipelineSummary, listCompanies, listContacts,
  listDeals, listLeads, listPipelineStages,
} from '../services/crm-read-service.js';
import {
  buildDealUpdate, dealStatusForStage, isIsoDate, isValidCurrency, isValidProbability,
  normalizeOptionalText, resolveDealReferences,
} from '../services/crm-deal-service.js';

const router = express.Router();
router.use(authenticateToken);

const roles = (req) => ({ systemRole: req.user.system_role, tenantRole: req.verified_tenant_role, userId: req.user.user_id });
const tenant = (req) => req.verified_tenant_id;
const id = (value) => typeof value === 'string' && isValidUUID(value);
const page = (req, res) => {
  const limit = Number(req.query.limit ?? 25);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    res.status(400).json({ error: 'limit must be 1-100 and offset must be non-negative' });
    return null;
  }
  return { limit, offset };
};
const write = (req, res) => {
  if (!canWriteCrm(roles(req))) {
    res.status(403).json({ error: 'CRM write access required' });
    return false;
  }
  return true;
};
const responseError = (res, err) => {
  if (err?.code === '23503' || err?.code === '23505' || err?.code === '23514') {
    return res.status(409).json({ error: 'Referenced CRM resource is not valid for this tenant' });
  }
  return res.status(500).json({ error: 'Server error' });
};

async function leadForTenant(tenantId, leadId) {
  const result = await query('SELECT * FROM crm_leads WHERE tenant_id = $1 AND id = $2', [tenantId, leadId]);
  return result.rows[0] ?? null;
}
async function defaultStage(tenantId) {
  const result = await query("SELECT id FROM crm_pipeline_stages WHERE tenant_id = $1 AND stage_key = 'NEW_LEAD'", [tenantId]);
  return result.rows[0]?.id ?? null;
}
function nonEmptyText(value, maxLength) {
  const text = normalizeOptionalText(value, maxLength);
  return text === null || text === undefined ? null : text;
}
function validDealBody(body, { creating = false } = {}) {
  if (creating && ((!id(body.contact_id) && !id(body.lead_id)) || !nonEmptyText(body.title, 255))) return 'contact_id or lead_id and title are required';
  if (body.contact_id !== undefined && body.contact_id !== null && !id(body.contact_id)) return 'Invalid contact ID';
  if (body.lead_id !== undefined && body.lead_id !== null && !id(body.lead_id)) return 'Invalid lead ID';
  if (body.pipeline_stage_id !== undefined && body.pipeline_stage_id !== null && !id(body.pipeline_stage_id)) return 'Invalid pipeline stage ID';
  if (body.owner_user_id !== undefined && body.owner_user_id !== null && !id(body.owner_user_id)) return 'Invalid owner user ID';
  if (body.title !== undefined && !nonEmptyText(body.title, 255)) return 'Invalid deal title';
  if (body.value !== undefined && body.value !== null && (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0)) return 'Invalid deal value';
  if (body.currency !== undefined && body.currency !== null && !isValidCurrency(body.currency)) return 'Currency must be a three-letter uppercase code';
  if (body.probability !== undefined && body.probability !== null && !isValidProbability(body.probability)) return 'Probability must be an integer from 0 to 100';
  if (body.expected_close_date !== undefined && body.expected_close_date !== null && !isIsoDate(body.expected_close_date)) return 'Invalid expected close date';
  if (body.source !== undefined && body.source !== null && nonEmptyText(body.source, 80) === null) return 'Invalid deal source';
  if (body.notes !== undefined && body.notes !== null && nonEmptyText(body.notes, 10000) === null) return 'Invalid deal notes';
  return null;
}
function normalizedDealBody(body) {
  return {
    ...body,
    title: body.title === undefined ? undefined : body.title.trim(),
    currency: body.currency === undefined || body.currency === null ? body.currency : body.currency.trim(),
    source: body.source === undefined || body.source === null ? body.source : body.source.trim(),
    notes: body.notes === undefined || body.notes === null ? body.notes : body.notes.trim(),
  };
}
function refError(res, code) {
  const messages = {
    CONTACT_NOT_FOUND: 'Contact is not valid for this tenant',
    LEAD_CONTACT_MISMATCH: 'Lead is not valid for this contact in this tenant',
    STAGE_NOT_FOUND: 'Pipeline stage is not valid for this tenant',
    OWNER_NOT_FOUND: 'Deal owner is not a member of this tenant',
  };
  return res.status(409).json({ error: messages[code] ?? 'Referenced CRM resource is not valid for this tenant' });
}

router.get('/:tenantId/leads', requireTenantAccess, async (req, res) => {
  const p = page(req, res); if (!p) return;
  if (req.query.temperature && !['HOT', 'WARM', 'COLD', 'UNQUALIFIED'].includes(req.query.temperature)) return res.status(400).json({ error: 'Invalid temperature' });
  if (req.query.stage && !id(req.query.stage)) return res.status(400).json({ error: 'Invalid stage ID' });
  if (req.query.assigned_user_id && !id(req.query.assigned_user_id)) return res.status(400).json({ error: 'Invalid assigned user ID' });
  if (req.query.conversation_id && !id(req.query.conversation_id)) return res.status(400).json({ error: 'Invalid conversation ID' });
  const source = typeof req.query.source === 'string' ? req.query.source.trim() : '';
  if (req.query.source && (!source || source.length > 80)) return res.status(400).json({ error: 'Invalid source' });
  try {
    return res.json(await listLeads(query, { tenantId: tenant(req), ...p, temperature: req.query.temperature, stageId: req.query.stage, assignedUserId: req.query.assigned_user_id, source: source || undefined, conversationId: req.query.conversation_id }));
  } catch (err) { return responseError(res, err); }
});

router.post('/:tenantId/leads', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  const t = tenant(req), body = req.body ?? {};
  if (!id(body.contact_id)) return res.status(400).json({ error: 'Valid contact_id is required' });
  if (body.company_id && !id(body.company_id)) return res.status(400).json({ error: 'Invalid company_id' });
  if (body.conversation_id && !id(body.conversation_id)) return res.status(400).json({ error: 'Invalid conversation_id' });
  try {
    const stage = body.pipeline_stage_id || await defaultStage(t);
    if (!stage) return res.status(409).json({ error: 'Default pipeline is unavailable' });
    const result = await query(
      'INSERT INTO crm_leads (tenant_id, contact_id, company_id, conversation_id, source_channel, pipeline_stage_id, intent, service_interest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [t, body.contact_id, body.company_id ?? null, body.conversation_id ?? null, body.source_channel ?? null, stage, body.intent ?? null, body.service_interest ?? null],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) { return responseError(res, err); }
});

router.get('/:tenantId/leads/:leadId', requireTenantAccess, async (req, res) => {
  if (!id(req.params.leadId)) return res.status(400).json({ error: 'Invalid lead ID' });
  try {
    const lead = await getCrmLeadDetail(query, { tenantId: tenant(req), leadId: req.params.leadId });
    return lead ? res.json(lead) : res.status(404).json({ error: 'Lead not found' });
  } catch (err) { return responseError(res, err); }
});

router.put('/:tenantId/leads/:leadId', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  if (!id(req.params.leadId)) return res.status(400).json({ error: 'Invalid lead ID' });
  const body = req.body ?? {};
  try {
    const result = await query(
      'UPDATE crm_leads SET intent = COALESCE($1,intent), service_interest = COALESCE($2,service_interest), budget_text = COALESCE($3,budget_text), timeline = COALESCE($4,timeline), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $5 AND id = $6 RETURNING *',
      [body.intent ?? null, body.service_interest ?? null, body.budget_text ?? null, body.timeline ?? null, tenant(req), req.params.leadId],
    );
    return result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ error: 'Lead not found' });
  } catch (err) { return responseError(res, err); }
});

router.post('/:tenantId/leads/:leadId/rescore', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  if (!id(req.params.leadId)) return res.status(400).json({ error: 'Invalid lead ID' });
  const lead = await leadForTenant(tenant(req), req.params.leadId);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (!lead.conversation_id) return res.status(409).json({ error: 'Lead has no conversation to rescore' });
  queueLeadQualification({ tenantId: tenant(req), conversationId: lead.conversation_id, force: true });
  return res.status(202).json({ status: 'queued', lead_id: lead.id });
});

router.post('/:tenantId/leads/:leadId/assign', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  if (!id(req.params.leadId) || !id(req.body?.user_id)) return res.status(400).json({ error: 'Valid lead and user IDs are required' });
  try {
    const t = tenant(req);
    const member = await query('SELECT user_id FROM tenant_users WHERE tenant_id = $1 AND user_id = $2', [t, req.body.user_id]);
    if (!member.rowCount) return res.status(404).json({ error: 'Tenant user not found' });
    const result = await query('UPDATE crm_leads SET assigned_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $2 AND id = $3 RETURNING *', [req.body.user_id, t, req.params.leadId]);
    return result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ error: 'Lead not found' });
  } catch (err) { return responseError(res, err); }
});

router.post('/:tenantId/leads/:leadId/stage', requireTenantAccess, async (req, res) => {
  if (!id(req.params.leadId) || !id(req.body?.pipeline_stage_id)) return res.status(400).json({ error: 'Valid lead and pipeline_stage IDs are required' });
  try {
    const t = tenant(req), lead = await leadForTenant(t, req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!canOperateCrmLead({ ...roles(req), action: 'stage', assignedUserId: lead.assigned_user_id })) return res.status(403).json({ error: 'Lead stage update is not permitted' });
    const stage = await query('SELECT * FROM crm_pipeline_stages WHERE tenant_id = $1 AND id = $2', [t, req.body.pipeline_stage_id]);
    if (!stage.rowCount) return res.status(404).json({ error: 'Pipeline stage not found' });
    const result = await query(
      "UPDATE crm_leads SET pipeline_stage_id = $1, status = CASE WHEN $2 = 'WON' THEN 'converted' WHEN $2 = 'LOST' THEN 'closed' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $3 AND id = $4 RETURNING *",
      [stage.rows[0].id, stage.rows[0].stage_key, t, lead.id],
    );
    return res.json(result.rows[0]);
  } catch (err) { return responseError(res, err); }
});

router.get('/:tenantId/contacts', requireTenantAccess, async (req, res) => {
  const p = page(req, res); if (!p) return;
  try { return res.json(await listContacts(query, { tenantId: tenant(req), ...p })); } catch (err) { return responseError(res, err); }
});
router.get('/:tenantId/contacts/:contactId', requireTenantAccess, async (req, res) => {
  if (!id(req.params.contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
  try {
    const contact = await getContact(query, { tenantId: tenant(req), contactId: req.params.contactId });
    return contact ? res.json(contact) : res.status(404).json({ error: 'Contact not found' });
  } catch (err) { return responseError(res, err); }
});
router.get('/:tenantId/companies', requireTenantAccess, async (req, res) => {
  const p = page(req, res); if (!p) return;
  try { return res.json(await listCompanies(query, { tenantId: tenant(req), ...p })); } catch (err) { return responseError(res, err); }
});

router.get('/:tenantId/pipelines', requireTenantAccess, async (req, res) => {
  try { return res.json(await listPipelineStages(query, { tenantId: tenant(req) })); } catch (err) { return responseError(res, err); }
});
router.get('/:tenantId/pipelines/summary', requireTenantAccess, async (req, res) => {
  try { return res.json(await getPipelineSummary(query, { tenantId: tenant(req) })); } catch (err) { return responseError(res, err); }
});
router.get('/:tenantId/crm/overview', requireTenantAccess, async (req, res) => {
  try { return res.json(await getCrmOverviewMetrics(query, { tenantId: tenant(req) })); } catch (err) { return responseError(res, err); }
});

router.get('/:tenantId/deals', requireTenantAccess, async (req, res) => {
  const p = page(req, res); if (!p) return;
  const queryFilters = req.query;
  if (queryFilters.stage && !id(queryFilters.stage)) return res.status(400).json({ error: 'Invalid stage ID' });
  if (queryFilters.contact_id && !id(queryFilters.contact_id)) return res.status(400).json({ error: 'Invalid contact ID' });
  if (queryFilters.owner_user_id && !id(queryFilters.owner_user_id)) return res.status(400).json({ error: 'Invalid owner user ID' });
  if (queryFilters.status && !['open', 'won', 'lost', 'closed'].includes(queryFilters.status)) return res.status(400).json({ error: 'Invalid deal status' });
  const source = typeof queryFilters.source === 'string' ? queryFilters.source.trim() : undefined;
  if (queryFilters.source && (!source || source.length > 80)) return res.status(400).json({ error: 'Invalid deal source' });
  try {
    return res.json(await listDeals(query, {
      tenantId: tenant(req), ...p, stageId: queryFilters.stage, contactId: queryFilters.contact_id,
      ownerUserId: queryFilters.owner_user_id, status: queryFilters.status, source,
      includeArchived: queryFilters.include_archived === 'true',
    }));
  } catch (err) { return responseError(res, err); }
});

router.get('/:tenantId/deals/:dealId', requireTenantAccess, async (req, res) => {
  if (!id(req.params.dealId)) return res.status(400).json({ error: 'Invalid deal ID' });
  try {
    const deal = await getDeal(query, { tenantId: tenant(req), dealId: req.params.dealId });
    return deal ? res.json(deal) : res.status(404).json({ error: 'Deal not found' });
  } catch (err) { return responseError(res, err); }
});

router.post('/:tenantId/deals', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  const t = tenant(req), raw = req.body ?? {};
  const body = normalizedDealBody(raw);
  const validationError = validDealBody(body, { creating: true });
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const stageId = body.pipeline_stage_id ?? await defaultStage(t);
    if (!stageId) return res.status(409).json({ error: 'Default pipeline is unavailable' });
    let contactId = body.contact_id ?? null;
    if (!contactId && body.lead_id) {
      const leadContact = await query('SELECT contact_id FROM crm_leads WHERE tenant_id = $1 AND id = $2', [t, body.lead_id]);
      contactId = leadContact.rows[0]?.contact_id ?? null;
    }
    if (!contactId) return res.status(409).json({ error: 'Lead is not valid for this tenant' });
    const refs = await resolveDealReferences(query, {
      tenantId: t, contactId, leadId: body.lead_id ?? null, stageId, ownerUserId: body.owner_user_id ?? null,
    });
    if (refs.error) return refError(res, refs.error);
    const result = await query(
      'INSERT INTO crm_deals (tenant_id, contact_id, lead_id, title, pipeline_stage_id, value, currency, probability, expected_close_date, owner_user_id, source, notes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [t, refs.contactId, refs.leadId, body.title, refs.stage.id, body.value ?? null, body.currency ?? null, body.probability ?? null, body.expected_close_date ?? null, refs.ownerUserId, body.source ?? null, body.notes ?? null, dealStatusForStage(refs.stage.stage_key)],
    );
    if (refs.leadId) await query("INSERT INTO crm_activities (tenant_id, lead_id, event_type, metadata) VALUES ($1,$2,'DEAL_CREATED',$3)", [t, refs.leadId, JSON.stringify({ deal_id: result.rows[0].id })]);
    return res.status(201).json(result.rows[0]);
  } catch (err) { return responseError(res, err); }
});

router.put('/:tenantId/deals/:dealId', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  if (!id(req.params.dealId)) return res.status(400).json({ error: 'Invalid deal ID' });
  const body = normalizedDealBody(req.body ?? {});
  const validationError = validDealBody(body);
  if (validationError) return res.status(400).json({ error: validationError });
  const update = buildDealUpdate(body);
  if (!update) return res.status(400).json({ error: 'No editable deal fields were provided' });
  try {
    const existing = await getDeal(query, { tenantId: tenant(req), dealId: req.params.dealId });
    if (!existing) return res.status(404).json({ error: 'Deal not found' });
    if (Object.prototype.hasOwnProperty.call(body, 'owner_user_id') && body.owner_user_id) {
      const refs = await resolveDealReferences(query, {
        tenantId: tenant(req), contactId: existing.contact_id, leadId: existing.lead_id, stageId: existing.pipeline_stage_id, ownerUserId: body.owner_user_id,
      });
      if (refs.error) return refError(res, refs.error);
    }
    update.values.push(tenant(req), req.params.dealId);
    const result = await query('UPDATE crm_deals SET ' + update.fields.join(', ') + ' WHERE tenant_id = $' + (update.values.length - 1) + ' AND id = $' + update.values.length + ' AND archived_at IS NULL RETURNING *', update.values);
    return result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ error: 'Deal not found' });
  } catch (err) { return responseError(res, err); }
});

router.post('/:tenantId/deals/:dealId/stage', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  if (!id(req.params.dealId) || !id(req.body?.pipeline_stage_id)) return res.status(400).json({ error: 'Valid deal and pipeline stage IDs are required' });
  try {
    const t = tenant(req);
    const deal = await getDeal(query, { tenantId: t, dealId: req.params.dealId });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    const refs = await resolveDealReferences(query, { tenantId: t, contactId: deal.contact_id, leadId: deal.lead_id, stageId: req.body.pipeline_stage_id, ownerUserId: deal.owner_user_id });
    if (refs.error) return refError(res, refs.error);
    const result = await query(
      'UPDATE crm_deals SET pipeline_stage_id = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $3 AND id = $4 AND archived_at IS NULL RETURNING *',
      [refs.stage.id, dealStatusForStage(refs.stage.stage_key), t, deal.id],
    );
    if (deal.lead_id) {
      const event = refs.stage.stage_key === 'WON' ? 'DEAL_WON' : refs.stage.stage_key === 'LOST' ? 'DEAL_LOST' : 'PIPELINE_STAGE_CHANGED';
      await query('INSERT INTO crm_activities (tenant_id, lead_id, event_type, metadata) VALUES ($1,$2,$3,$4)', [t, deal.lead_id, event, JSON.stringify({ deal_id: deal.id, pipeline_stage_id: refs.stage.id })]);
    }
    return res.json(result.rows[0]);
  } catch (err) { return responseError(res, err); }
});

router.delete('/:tenantId/deals/:dealId', requireTenantAccess, async (req, res) => {
  if (!write(req, res)) return;
  if (!id(req.params.dealId)) return res.status(400).json({ error: 'Invalid deal ID' });
  try {
    const result = await query('UPDATE crm_deals SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL RETURNING id', [tenant(req), req.params.dealId]);
    return result.rowCount ? res.status(204).send() : res.status(404).json({ error: 'Deal not found' });
  } catch (err) { return responseError(res, err); }
});

export default router;
