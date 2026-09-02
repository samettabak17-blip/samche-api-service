import crypto from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KnowledgeSourceBusinessIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requiredUuid(value, code) {
  if (!UUID.test(String(value ?? ''))) {
    throw new KnowledgeSourceBusinessIdentityError(code, 'Business Identity assignment is invalid');
  }
  return String(value);
}

async function transaction(database, operation) {
  if (!database?.connect) throw new KnowledgeSourceBusinessIdentityError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Business Identity assignment is unavailable');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

export async function assignKnowledgeSourceBusinessIdentity({ database, tenantId, sourceId, businessIdentityId, assignedBy }) {
  requiredUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requiredUuid(sourceId, 'KNOWLEDGE_SOURCE_INVALID');
  requiredUuid(businessIdentityId, 'KNOWLEDGE_BUSINESS_IDENTITY_INVALID');
  requiredUuid(assignedBy, 'KNOWLEDGE_ASSIGNER_INVALID');

  return transaction(database, async (client) => {
    const source = await client.query(
      `SELECT id FROM knowledge_base_documents
        WHERE id = $1 AND tenant_id = $2 AND enabled = TRUE`,
      [sourceId, tenantId],
    );
    if (!source.rowCount) throw new KnowledgeSourceBusinessIdentityError('KNOWLEDGE_SOURCE_NOT_FOUND', 'Knowledge source was not found');

    const identity = await client.query(
      `SELECT id, display_name FROM business_identities
        WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
      [businessIdentityId, tenantId],
    );
    if (!identity.rowCount) throw new KnowledgeSourceBusinessIdentityError('KNOWLEDGE_BUSINESS_IDENTITY_NOT_FOUND', 'Business Identity was not found');

    const existing = await client.query(
      `SELECT business_identity_id FROM knowledge_source_business_identities
        WHERE tenant_id = $1 AND source_id = $2
        ORDER BY business_identity_id FOR UPDATE`,
      [tenantId, sourceId],
    );
    const previousIds = (existing.rows ?? []).map((row) => String(row.business_identity_id));
    if (previousIds.length === 1 && previousIds[0] === businessIdentityId) {
      return { source_id: sourceId, business_identity: identity.rows[0], changed: false };
    }

    // Preserve historical evidence identity before a future source reassignment.
    // Only exactly-one existing direct identity is deterministic enough to snapshot.
    if (previousIds.length === 1) {
      await client.query(
        `UPDATE knowledge_candidate_image_evidence
            SET business_identity_id = $3
          WHERE tenant_id = $1 AND source_id = $2 AND business_identity_id IS NULL`,
        [tenantId, sourceId, previousIds[0]],
      );
    }
    await client.query(
      `DELETE FROM knowledge_source_business_identities
        WHERE tenant_id = $1 AND source_id = $2`,
      [tenantId, sourceId],
    );
    await client.query(
      `INSERT INTO knowledge_source_business_identities
         (tenant_id, source_id, business_identity_id, assigned_by_user_id, assigned_at, assignment_origin)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'HUMAN_CONFIRMED_SOURCE_IDENTITY')`,
      [tenantId, sourceId, businessIdentityId, assignedBy],
    );
    await client.query(
      `INSERT INTO knowledge_source_business_identity_assignment_events
         (id, tenant_id, source_id, previous_business_identity_id, new_business_identity_id, changed_by_user_id, change_origin)
       VALUES ($1, $2, $3, $4::uuid, $5, $6, 'HUMAN_CONFIRMED_SOURCE_IDENTITY')`,
      [crypto.randomUUID(), tenantId, sourceId, previousIds.length === 1 ? previousIds[0] : null, businessIdentityId, assignedBy],
    );
    return { source_id: sourceId, business_identity: identity.rows[0], changed: true };
  });
}
