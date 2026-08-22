import crypto from 'crypto';

function normalized(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

export function crmContactIdentity({ tenantId, source, externalCustomerId = null, email = null, phone = null }) {
  const normalizedEmail = normalized(email);
  const normalizedPhone = typeof phone === 'string' && phone.replace(/[^+\d]/g, '') ? phone.replace(/[^+\d]/g, '') : null;
  const normalizedExternalId = normalized(externalCustomerId);
  let kind;
  let value;

  if (normalizedEmail) {
    kind = 'EMAIL';
    value = normalizedEmail;
  } else if (normalizedPhone) {
    kind = 'PHONE';
    value = normalizedPhone;
  } else if (normalizedExternalId) {
    kind = source === 'SAMCHEGUIDE' ? 'ANONYMOUS_SESSION' : 'EXTERNAL_CUSTOMER';
    value = normalizedExternalId;
  } else {
    throw new Error('CRM_CONTACT_IDENTITY_REQUIRED');
  }

  return {
    kind,
    identityHash: crypto.createHash('sha256').update(`${tenantId}:${kind}:${value}`).digest('hex'),
    displayName: null,
    email: normalizedEmail,
    phone: normalizedPhone,
  };
}

export function shouldCreateLeadForConversation({ existingLeadId }) {
  return !existingLeadId;
}

export async function publishCrmEvent(client, { tenantId, leadId = null, conversationId = null, type }) {
  await client.query('SELECT pg_notify($1, $2)', [
    'samche_crm_events',
    JSON.stringify({ tenant_id: tenantId, lead_id: leadId, conversation_id: conversationId, type }),
  ]);
}

export async function recordCrmActivity(client, {
  tenantId,
  leadId = null,
  conversationId = null,
  actorUserId = null,
  eventType,
  metadata = {},
}) {
  const inserted = await client.query(
    `INSERT INTO crm_activities
      (tenant_id, lead_id, conversation_id, actor_user_id, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [tenantId, leadId, conversationId, actorUserId, eventType, JSON.stringify(metadata)]
  );
  await publishCrmEvent(client, { tenantId, leadId, conversationId, type: eventType });
  return inserted.rows[0];
}

export async function ensureConversationCrmIdentity(client, {
  tenantId,
  conversationId,
  source = 'SAMCHEGUIDE',
  externalCustomerId = null,
}) {
  const conversationResult = await client.query(
    `SELECT id, tenant_id, customer_external_id, contact_id
       FROM conversations
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE`,
    [conversationId, tenantId]
  );
  const conversation = conversationResult.rows[0];
  if (!conversation) throw new Error('CRM_CONVERSATION_NOT_FOUND');

  const identity = crmContactIdentity({
    tenantId,
    source,
    externalCustomerId: externalCustomerId ?? conversation.customer_external_id,
  });
  const contactResult = await client.query(
    `INSERT INTO crm_contacts
      (tenant_id, identity_kind, identity_hash, display_name, email, phone, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, identity_hash)
     DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, identity.kind, identity.identityHash, identity.displayName, identity.email, identity.phone, source]
  );
  const contact = contactResult.rows[0];

  if (conversation.contact_id !== contact.id) {
    await client.query(
      `UPDATE conversations
          SET contact_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND tenant_id = $3`,
      [contact.id, conversationId, tenantId]
    );
  }

  const leadResult = await client.query(
    `SELECT id, tenant_id, contact_id, conversation_id
       FROM crm_leads
      WHERE tenant_id = $1 AND conversation_id = $2
      LIMIT 1`,
    [tenantId, conversationId]
  );
  const existingLead = leadResult.rows[0] ?? null;
  if (!shouldCreateLeadForConversation({ existingLeadId: existingLead?.id ?? null })) {
    return { contact, lead: existingLead, created: false };
  }

  const stageResult = await client.query(
    `SELECT id FROM crm_pipeline_stages
      WHERE tenant_id = $1 AND stage_key = 'NEW_LEAD'
      LIMIT 1`,
    [tenantId]
  );
  const stage = stageResult.rows[0];
  if (!stage) throw new Error('CRM_DEFAULT_PIPELINE_MISSING');

  const createdLead = await client.query(
    `INSERT INTO crm_leads
      (tenant_id, contact_id, conversation_id, source_channel, pipeline_stage_id, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     RETURNING *`,
    [tenantId, contact.id, conversationId, source, stage.id]
  );
  const lead = createdLead.rows[0];
  await recordCrmActivity(client, { tenantId, leadId: lead.id, conversationId, eventType: 'CONVERSATION_STARTED', metadata: { source } });
  await recordCrmActivity(client, { tenantId, leadId: lead.id, conversationId, eventType: 'LEAD_CREATED', metadata: { source } });
  return { contact, lead, created: true };
}

