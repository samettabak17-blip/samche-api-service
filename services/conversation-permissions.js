const administrativeActions = new Set(['takeover', 'return_to_ai', 'pause', 'resume', 'close', 'send_message', 'archive', 'unarchive']);

export function canOperateConversation({ systemRole, tenantRole, action, assignedAgentUserId, actorUserId }) {
  if (systemRole === 'OWNER' || tenantRole === 'ADMIN') return administrativeActions.has(action);
  if (tenantRole !== 'AGENT') return false;

  if (action === 'takeover') return assignedAgentUserId === null || assignedAgentUserId === actorUserId;
  if (action === 'send_message' || action === 'return_to_ai' || action === 'archive' || action === 'unarchive') return true;
  return false;
}


