function normalizedVersion(value) {
  if (value === null || value === undefined) return null;
  try {
    const version = BigInt(value);
    return version > 0n ? version : null;
  } catch {
    return null;
  }
}

function snapshotFromRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const assistantId = rows[0]?.assistant_id;
  const version = normalizedVersion(rows[0]?.knowledge_authority_version);
  if (!assistantId || version === null) return null;
  return { assistantId, version };
}

export async function resolveAssistantKnowledgeAuthority(client, { tenantId, assistantId }) {
  if (!tenantId || !assistantId) return null;
  const result = await client.query(
    `SELECT id AS assistant_id, knowledge_authority_version
       FROM ai_assistants
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'active'
      LIMIT 2`,
    [tenantId, assistantId],
  );
  return snapshotFromRows(result.rows);
}

export async function resolveConversationKnowledgeAuthority(client, { tenantId, conversationId }) {
  if (!tenantId || !conversationId) return null;
  const result = await client.query(
    `SELECT assistant.id AS assistant_id, assistant.knowledge_authority_version
       FROM conversations AS conversation
       JOIN tenant_channels AS channel
         ON channel.id = conversation.channel_id
        AND channel.tenant_id = conversation.tenant_id
       JOIN ai_assistants AS assistant
         ON assistant.id = channel.assistant_id
        AND assistant.tenant_id = channel.tenant_id
      WHERE conversation.tenant_id = $1
        AND conversation.id = $2
        AND channel.status = 'active'
        AND assistant.status = 'active'
      LIMIT 2`,
    [tenantId, conversationId],
  );
  return snapshotFromRows(result.rows);
}

export async function loadCurrentProviderHistory(client, {
  tenantId,
  conversationId,
  assistantId,
  version,
  limit = 12,
  excludeMessageId = null,
}) {
  const normalizedAuthorityVersion = normalizedVersion(version);
  if (!tenantId || !conversationId || !assistantId || normalizedAuthorityVersion === null) return [];
  const normalizedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 12, 1), 100);
  const result = await client.query(
    `SELECT sender_type, content
       FROM conversation_messages
      WHERE tenant_id = $1
        AND conversation_id = $2
        AND authority_assistant_id = $3
        AND knowledge_authority_version = $4
        AND ($6::uuid IS NULL OR id <> $6)
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
    [tenantId, conversationId, assistantId, normalizedAuthorityVersion.toString(), normalizedLimit, excludeMessageId],
  );
  return result.rows.reverse();
}

export function isSameKnowledgeAuthority(left, right) {
  if (!left || !right) return false;
  return left.assistantId === right.assistantId
    && normalizedVersion(left.version) === normalizedVersion(right.version);
}
