import { canOperateConversation } from './conversation-permissions.js';

export async function resolveHumanSupportRecipients({ database, tenantId, conversationId, rule, target = null }) {
  const conversation = await database.query('SELECT assigned_agent_user_id FROM conversations WHERE id = $1 AND tenant_id = $2', [conversationId, tenantId]);
  if (!conversation.rowCount) return [];
  const assigned = conversation.rows[0].assigned_agent_user_id;
  const targetRole = target?.role ?? (rule === 'ROLE' ? 'ADMIN' : null);
  const result = await database.query(
    `SELECT u.id, u.system_role, tu.tenant_role FROM users u JOIN tenant_users tu ON tu.user_id = u.id
      WHERE tu.tenant_id = $1 AND (u.status = 'active' OR u.status = 'ACTIVE')
        AND (($2 = 'ASSIGNED_OWNER' AND u.id = $3) OR ($2 = 'USER' AND u.id = $4) OR ($2 = 'ROLE' AND tu.tenant_role = $5))`,
    [tenantId, rule, assigned, target?.userId ?? null, targetRole]
  );
  if (rule === 'TEAM') return [];
  const eligible = [...new Map(result.rows.filter((user) => canOperateConversation({
    systemRole: user.system_role, tenantRole: user.tenant_role,
    action: rule === 'ASSIGNED_OWNER' ? 'send_message' : 'takeover',
    assignedAgentUserId: assigned, actorUserId: user.id,
  })).map((user) => [user.id, user])).values()];

  // If rule is ASSIGNED_OWNER and the assigned operator has no active push subscription,
  // also include eligible tenant operators with active subscriptions so support requests
  // are never dropped without a real device notification.
  if (rule === 'ASSIGNED_OWNER' && eligible.length > 0) {
    const subCheck = await database.query(
      `SELECT 1 FROM push_notification_subscriptions
        WHERE tenant_id = $1 AND user_id = $2 AND enabled = TRUE LIMIT 1`,
      [tenantId, assigned]
    );
    if (subCheck.rowCount === 0) {
      const activeSubUsers = await database.query(
        `SELECT u.id, u.system_role, tu.tenant_role
           FROM users u
           JOIN tenant_users tu ON tu.user_id = u.id
           JOIN push_notification_subscriptions pns ON pns.user_id = u.id AND pns.tenant_id = tu.tenant_id AND pns.enabled = TRUE
          WHERE tu.tenant_id = $1 AND (u.status = 'active' OR u.status = 'ACTIVE')
            AND tu.tenant_role IN ('ADMIN', 'OWNER')`,
        [tenantId]
      );
      for (const row of activeSubUsers.rows) {
        if (!eligible.some((u) => u.id === row.id)) {
          eligible.push(row);
        }
      }
    }
  }

  console.info(
    'PUSH_RECIPIENT_DIAGNOSTIC RECIPIENT_RESOLVED=' + (eligible.length > 0 ? '1' : '0')
    + ' count=' + eligible.length
    + ' tenant=' + String(tenantId).slice(0, 8)
    + ' rule=' + rule
  );

  return eligible;
}
