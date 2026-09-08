const NORMALIZED_EXTERNAL_ID_SQL = `
  regexp_replace(
    regexp_replace(lower(trim(external_channel_id)), '^whatsapp:\\s*', ''),
    '[^0-9]',
    '',
    'g'
  )
`;

export class WhatsAppChannelOwnershipError extends Error {
  constructor(code, message, details = {}) {
    super(message ?? code);
    this.name = 'WhatsAppChannelOwnershipError';
    this.code = code;
    this.details = details;
  }
}

export function normalizeWhatsAppExternalId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^whatsapp:\s*/i, '')
    .replace(/[^0-9]/g, '');
  if (!/^\d{6,32}$/.test(normalized)) {
    throw new WhatsAppChannelOwnershipError(
      'WHATSAPP_EXTERNAL_ID_INVALID',
      'A valid Meta WhatsApp phone-number ID is required'
    );
  }
  return normalized;
}

function integrationKey(externalChannelId) {
  return `whatsapp:${externalChannelId}`;
}

async function inTransaction(database, work) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('WHATSAPP_CHANNEL_TRANSACTION_ROLLBACK_FAILED code=' + String(rollbackError?.code ?? 'UNKNOWN').slice(0, 32));
    }
    throw error;
  } finally {
    client.release();
  }
}

async function lockExternalId(client, externalChannelId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [integrationKey(externalChannelId)]
  );
}

async function activeOwners(client, externalChannelId) {
  return client.query(
    `SELECT id, tenant_id, assistant_id, display_name, external_channel_id, status
       FROM tenant_channels
      WHERE channel_type = 'WHATSAPP'
        AND status = 'active'
        AND ${NORMALIZED_EXTERNAL_ID_SQL} = $1
      ORDER BY created_at, id
      FOR UPDATE`,
    [externalChannelId]
  );
}

async function requireEligibleAssistant(client, tenantId, assistantId) {
  if (!assistantId) return;
  const assistant = await client.query(
    `SELECT id, tenant_id, status
       FROM ai_assistants
      WHERE id = $1
        AND tenant_id = $2
        AND status = 'active'`,
    [assistantId, tenantId]
  );
  if (assistant.rowCount !== 1) {
    throw new WhatsAppChannelOwnershipError(
      'WHATSAPP_ASSISTANT_INELIGIBLE',
      'Assistant must be active and belong to the target tenant'
    );
  }
}

async function convergeIntegration(client, channel) {
  const externalChannelId = normalizeWhatsAppExternalId(channel.external_channel_id);
  await client.query(
    `INSERT INTO channel_integrations
       (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
     VALUES ($1, 'WHATSAPP', $2, $3, $4, $5)
     ON CONFLICT (integration_key) DO UPDATE SET
       integration_type = 'WHATSAPP',
       tenant_id = EXCLUDED.tenant_id,
       channel_id = EXCLUDED.channel_id,
       assistant_id = EXCLUDED.assistant_id,
       enabled = EXCLUDED.enabled,
       updated_at = CURRENT_TIMESTAMP`,
    [
      integrationKey(externalChannelId),
      channel.tenant_id,
      channel.id,
      channel.assistant_id,
      channel.status === 'active',
    ]
  );
}

export async function configureWhatsAppChannel({
  database,
  tenantId,
  channelId = null,
  displayName,
  externalChannelId,
  assistantId = null,
  status = 'active',
}) {
  const normalizedExternalId = normalizeWhatsAppExternalId(externalChannelId);
  return inTransaction(database, async (client) => {
    await lockExternalId(client, normalizedExternalId);
    const ownership = await activeOwners(client, normalizedExternalId);
    if (ownership.rowCount > 1) {
      throw new WhatsAppChannelOwnershipError(
        'WHATSAPP_CHANNEL_OWNERSHIP_AMBIGUOUS',
        'WhatsApp channel ownership is ambiguous and requires platform review'
      );
    }
    const activeOwner = ownership.rows[0] ?? null;
    if (activeOwner && activeOwner.tenant_id !== tenantId) {
      throw new WhatsAppChannelOwnershipError(
        'WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT',
        'This WhatsApp channel is already owned by another tenant',
        {
          ownership: 'OTHER_TENANT',
          transferRequired: true,
          sourceChannelId: activeOwner.id,
          sourceTenantId: activeOwner.tenant_id,
          externalChannelId: normalizedExternalId,
        }
      );
    }

    if (status === 'active' && !assistantId) {
      throw new WhatsAppChannelOwnershipError(
        'WHATSAPP_ASSISTANT_REQUIRED',
        'An active WhatsApp channel requires an eligible target-tenant assistant'
      );
    }
    await requireEligibleAssistant(client, tenantId, assistantId);

    let channel;
    if (channelId) {
      const updated = await client.query(
        `UPDATE tenant_channels
            SET display_name = $1,
                external_channel_id = $2,
                assistant_id = $3,
                status = $4,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $5
            AND tenant_id = $6
            AND channel_type = 'WHATSAPP'
          RETURNING *`,
        [displayName, normalizedExternalId, assistantId, status, channelId, tenantId]
      );
      if (updated.rowCount !== 1) {
        throw new WhatsAppChannelOwnershipError('WHATSAPP_CHANNEL_NOT_FOUND', 'WhatsApp channel not found');
      }
      channel = updated.rows[0];
    } else if (activeOwner) {
      const updated = await client.query(
        `UPDATE tenant_channels
            SET display_name = $1,
                external_channel_id = $2,
                assistant_id = $3,
                status = $4,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $5
            AND tenant_id = $6
          RETURNING *`,
        [displayName, normalizedExternalId, assistantId, status, activeOwner.id, tenantId]
      );
      channel = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO tenant_channels
           (channel_type, display_name, external_channel_id, assistant_id, status, tenant_id)
         VALUES ('WHATSAPP', $1, $2, $3, $4, $5)
         RETURNING *`,
        [displayName, normalizedExternalId, assistantId, status, tenantId]
      );
      channel = inserted.rows[0];
    }

    await convergeIntegration(client, channel);
    return channel;
  });
}

export async function transferWhatsAppChannelOwnership({
  database,
  actorSystemRole,
  actorUserId,
  targetTenantId,
  targetAssistantId,
  externalChannelId,
  expectedSourceChannelId,
  displayName = 'WhatsApp',
  confirmation,
}) {
  // Security invariant: only canonical platform-level authority (system_role === 'OWNER')
  // may execute a cross-tenant transfer. Ordinary tenant membership roles (tenant-level
  // OWNER, ADMIN, AGENT/MEMBER) possess system_role === 'CUSTOMER' and are rejected.
  if (actorSystemRole !== 'OWNER') {
    throw new WhatsAppChannelOwnershipError(
      'PLATFORM_OWNER_REQUIRED',
      'Platform OWNER authority is required for cross-tenant WhatsApp transfer'
    );
  }
  if (confirmation !== 'TRANSFER' || !expectedSourceChannelId || !actorUserId) {
    throw new WhatsAppChannelOwnershipError(
      'WHATSAPP_TRANSFER_CONFIRMATION_REQUIRED',
      'Explicit transfer confirmation and expected source channel are required'
    );
  }

  const normalizedExternalId = normalizeWhatsAppExternalId(externalChannelId);
  return inTransaction(database, async (client) => {
    await lockExternalId(client, normalizedExternalId);
    const ownership = await activeOwners(client, normalizedExternalId);
    if (ownership.rowCount === 0) {
      throw new WhatsAppChannelOwnershipError('WHATSAPP_CHANNEL_OWNER_NOT_FOUND', 'Active WhatsApp owner not found');
    }
    if (ownership.rowCount !== 1) {
      throw new WhatsAppChannelOwnershipError(
        'WHATSAPP_CHANNEL_OWNERSHIP_AMBIGUOUS',
        'WhatsApp channel ownership is ambiguous and cannot be transferred'
      );
    }

    const source = ownership.rows[0];
    if (source.id !== expectedSourceChannelId) {
      throw new WhatsAppChannelOwnershipError(
        'WHATSAPP_CHANNEL_OWNER_CHANGED',
        'WhatsApp channel owner changed before transfer confirmation'
      );
    }
    if (source.tenant_id === targetTenantId) {
      throw new WhatsAppChannelOwnershipError(
        'WHATSAPP_TRANSFER_SAME_TENANT',
        'The WhatsApp channel already belongs to the target tenant'
      );
    }

    const targetTenant = await client.query(
      `SELECT id, status
         FROM tenants
        WHERE id = $1
          AND status = 'active'
        FOR UPDATE`,
      [targetTenantId]
    );
    if (targetTenant.rowCount !== 1) {
      throw new WhatsAppChannelOwnershipError('WHATSAPP_TARGET_TENANT_INELIGIBLE', 'Target tenant must be active');
    }
    await requireEligibleAssistant(client, targetTenantId, targetAssistantId);

    const targetCandidates = await client.query(
      `SELECT *
         FROM tenant_channels
        WHERE tenant_id = $1
          AND channel_type = 'WHATSAPP'
          AND status = 'inactive'
          AND ${NORMALIZED_EXTERNAL_ID_SQL} = $2
        ORDER BY updated_at DESC, id
        FOR UPDATE`,
      [targetTenantId, normalizedExternalId]
    );
    if (targetCandidates.rowCount > 1) {
      throw new WhatsAppChannelOwnershipError(
        'WHATSAPP_TARGET_CHANNEL_AMBIGUOUS',
        'Target tenant has ambiguous inactive WhatsApp channel records'
      );
    }

    await client.query(
      `UPDATE tenant_channels
          SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND tenant_id = $2`,
      [source.id, source.tenant_id]
    );
    await client.query(
      `UPDATE channel_integrations
          SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE channel_id = $1
          AND tenant_id = $2
          AND integration_type = 'WHATSAPP'`,
      [source.id, source.tenant_id]
    );

    let channel;
    if (targetCandidates.rowCount === 1) {
      const activated = await client.query(
        `UPDATE tenant_channels
            SET display_name = $1,
                external_channel_id = $2,
                assistant_id = $3,
                status = 'active',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
            AND tenant_id = $5
          RETURNING *`,
        [displayName, normalizedExternalId, targetAssistantId, targetCandidates.rows[0].id, targetTenantId]
      );
      channel = activated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO tenant_channels
           (channel_type, display_name, external_channel_id, assistant_id, status, tenant_id)
         VALUES ('WHATSAPP', $1, $2, $3, 'active', $4)
         RETURNING *`,
        [displayName, normalizedExternalId, targetAssistantId, targetTenantId]
      );
      channel = inserted.rows[0];
    }

    await convergeIntegration(client, channel);
    const audit = await client.query(
      `INSERT INTO whatsapp_channel_ownership_events
         (external_channel_id, source_tenant_id, source_channel_id,
          target_tenant_id, target_channel_id, actor_user_id, event_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'TRANSFERRED', $7::jsonb)
       RETURNING id`,
      [
        normalizedExternalId,
        source.tenant_id,
        source.id,
        targetTenantId,
        channel.id,
        actorUserId,
        JSON.stringify({ confirmation: 'TRANSFER' }),
      ]
    );

    return {
      channel,
      sourceChannelId: source.id,
      sourceTenantId: source.tenant_id,
      auditEventId: audit.rows[0].id,
      externalChannelId: normalizedExternalId,
    };
  });
}
