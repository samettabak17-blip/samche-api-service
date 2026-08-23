const stageStatuses = Object.freeze({
  WON: 'won',
  LOST: 'lost',
});

export function dealStatusForStage(stageKey) {
  return stageStatuses[stageKey] ?? 'open';
}

export function isValidCurrency(value) {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

export function isValidProbability(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

export function normalizeOptionalText(value, maxLength) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

export async function resolveDealReferences(queryFn, { tenantId, contactId, leadId, stageId, ownerUserId }) {
  const contact = await queryFn(
    'SELECT id FROM crm_contacts WHERE tenant_id = $1 AND id = $2',
    [tenantId, contactId],
  );
  if (!contact.rowCount) return { error: 'CONTACT_NOT_FOUND' };

  if (leadId) {
    const lead = await queryFn(
      'SELECT id FROM crm_leads WHERE tenant_id = $1 AND id = $2 AND contact_id = $3',
      [tenantId, leadId, contactId],
    );
    if (!lead.rowCount) return { error: 'LEAD_CONTACT_MISMATCH' };
  }

  const stage = await queryFn(
    'SELECT id, stage_key FROM crm_pipeline_stages WHERE tenant_id = $1 AND id = $2',
    [tenantId, stageId],
  );
  if (!stage.rowCount) return { error: 'STAGE_NOT_FOUND' };

  if (ownerUserId) {
    const owner = await queryFn(
      'SELECT user_id FROM tenant_users WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, ownerUserId],
    );
    if (!owner.rowCount) return { error: 'OWNER_NOT_FOUND' };
  }

  return { contactId, leadId: leadId ?? null, stage: stage.rows[0], ownerUserId: ownerUserId ?? null };
}

export function buildDealUpdate(payload) {
  const allowed = [
    ['title', 'title'],
    ['value', 'value'],
    ['currency', 'currency'],
    ['probability', 'probability'],
    ['expected_close_date', 'expected_close_date'],
    ['owner_user_id', 'owner_user_id'],
    ['source', 'source'],
    ['notes', 'notes'],
  ];
  const fields = [];
  const values = [];
  for (const [input, column] of allowed) {
    if (Object.prototype.hasOwnProperty.call(payload, input)) {
      values.push(payload[input]);
      fields.push(`${column} = $${values.length}`);
    }
  }
  if (!fields.length) return null;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  return { fields, values };
}
