const administrativeActions = new Set(['takeover', 'return_to_ai', 'pause', 'resume', 'close', 'send_message']);

export function canOperateConversation({ systemRole, tenantRole, action, assignedAgentUserId, actorUserId }) {
  if (systemRole === 'OWNER' || tenantRole === 'ADMIN') return administrativeActions.has(action);
  if (tenantRole !== 'AGENT') return false;

  if (action === 'takeover') return assignedAgentUserId === null;
  if (action === 'send_message' || action === 'return_to_ai') return assignedAgentUserId === actorUserId;
  return false;
}
