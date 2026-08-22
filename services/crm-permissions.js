export function canWriteCrm({ systemRole, tenantRole }) {
  return systemRole === 'OWNER' || (systemRole === 'CUSTOMER' && tenantRole === 'ADMIN');
}

export function canOperateCrmLead({ systemRole, tenantRole, userId, action, assignedUserId }) {
  if (canWriteCrm({ systemRole, tenantRole })) return true;
  return systemRole === 'CUSTOMER'
    && tenantRole === 'AGENT'
    && action === 'stage'
    && assignedUserId !== null
    && assignedUserId === userId;
}

