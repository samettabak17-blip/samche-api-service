import { canOperateConversation } from './conversation-permissions.js';

export async function resolveHumanSupportRecipients({ database, tenantId, conversationId, rule, target = null }) {
  const conversation = await database.query('SELECT assigned_agent_user_id FROM conversations WHERE id = $1 AND tenant_id = $2', [conversationId, tenantId]);
  if (!conversation.rowCount) return [];
  const assigned = conversation.rows[0].assigned_agent_user_id;
  const result = await database.query(
    `SELECT u.id, u.system_role, tu.tenant_role FROM users u JOIN tenant_users tu ON tu.user_id = u.id
      WHERE tu.tenant_id = $1 AND u.status = 'active'
        AND (($2 = 'ASSIGNED_OWNER' AND u.id = $3) OR ($2 = 'USER' AND u.id = $4) OR ($2 = 'ROLE' AND tu.tenant_role = $5))`,
    [tenantId, rule, assigned, target?.userId ?? null, target?.role ?? null]
  );
  if (rule === 'TEAM') return [];
  return [...new Map(result.rows.filter((user) => canOperateConversation({
    systemRole: user.system_role, tenantRole: user.tenant_role,
    action: rule === 'ASSIGNED_OWNER' ? 'send_message' : 'takeover',
    assignedAgentUserId: assigned, actorUserId: user.id,
  })).map((user) => [user.id, user])).values()];
}
