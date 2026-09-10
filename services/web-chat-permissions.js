/**
 * Canonical Web Chat Permissions & Module Registry
 * Prepares Web Chat for Task 9's canonical Team / Roles / Permissions / Module Registry.
 *
 * Invariant: ACCESS != DATA OWNERSHIP.
 * Tenant data remains tenant-owned and tenant-isolated even when
 * the authorized Platform Super Owner manages it.
 */

export const WEBCHAT_PERMISSIONS = Object.freeze({
  VIEW: 'channels.webchat.view',
  CONFIGURE: 'channels.webchat.configure',
  MANAGE_APPEARANCE: 'channels.webchat.manage_appearance',
  MANAGE_BEHAVIOR: 'channels.webchat.manage_behavior',
  MANAGE_INTEGRATION: 'channels.webchat.manage_integration',
  VIEW_INSTALLATION: 'channels.webchat.view_installation',
});

export const WEBCHAT_PERMISSION_REGISTRY = Object.freeze([
  {
    key: WEBCHAT_PERMISSIONS.VIEW,
    action: 'view',
    name: 'View Web Chat',
    module: 'channels',
    introduced_by_task: 'TASK_8',
    description: 'Inspect Web Chat channel state, assistant binding, appearance, and behavior.',
    allowed_system_roles: Object.freeze(['OWNER']),
    allowed_tenant_roles: Object.freeze(['ADMIN', 'AGENT']),
  },
  {
    key: WEBCHAT_PERMISSIONS.CONFIGURE,
    action: 'configure',
    name: 'Configure Web Chat',
    module: 'channels',
    introduced_by_task: 'TASK_8',
    description: 'Update Web Chat channel metadata, assistant linkage, and channel active/inactive state.',
    allowed_system_roles: Object.freeze(['OWNER']),
    allowed_tenant_roles: Object.freeze(['ADMIN']),
  },
  {
    key: WEBCHAT_PERMISSIONS.MANAGE_APPEARANCE,
    action: 'manage_appearance',
    name: 'Manage Appearance & Branding',
    module: 'channels',
    introduced_by_task: 'TASK_8',
    description: 'Customize widget branding, colors, contrast parameters, launcher layout, and labels.',
    allowed_system_roles: Object.freeze(['OWNER']),
    allowed_tenant_roles: Object.freeze(['ADMIN']),
  },
  {
    key: WEBCHAT_PERMISSIONS.MANAGE_BEHAVIOR,
    action: 'manage_behavior',
    name: 'Manage Proactive Behavior',
    module: 'channels',
    introduced_by_task: 'TASK_8',
    description: 'Configure proactive engagement triggers, high-intent auto-open, dwell timing, and cooldowns.',
    allowed_system_roles: Object.freeze(['OWNER']),
    allowed_tenant_roles: Object.freeze(['ADMIN']),
  },
  {
    key: WEBCHAT_PERMISSIONS.MANAGE_INTEGRATION,
    action: 'manage_integration',
    name: 'Manage Integration & Keys',
    module: 'channels',
    introduced_by_task: 'TASK_8',
    description: 'Enable, disable, or regenerate the public widget key and integration records.',
    allowed_system_roles: Object.freeze(['OWNER']),
    allowed_tenant_roles: Object.freeze(['ADMIN']),
  },
  {
    key: WEBCHAT_PERMISSIONS.VIEW_INSTALLATION,
    action: 'view_installation',
    name: 'View & Copy Installation Snippet',
    module: 'channels',
    introduced_by_task: 'TASK_8',
    description: 'Inspect and copy the client embed snippet containing zero secrets.',
    allowed_system_roles: Object.freeze(['OWNER']),
    allowed_tenant_roles: Object.freeze(['ADMIN', 'AGENT']),
  },
]);

/**
 * Checks if an actor can perform a discrete Web Chat action.
 *
 * @param {Object} actor
 * @param {string} actor.systemRole - 'OWNER' | 'CUSTOMER' | etc.
 * @param {string} [actor.tenantRole] - 'ADMIN' | 'AGENT' | undefined
 * @param {string} actor.action - One of WEBCHAT_PERMISSIONS values or short action names
 * @returns {boolean}
 */
export function canPerformWebChatAction(actorOrSystemRole = {}, maybeAction, maybeTenantRole) {
  let systemRole;
  let tenantRole;
  let action;

  if (typeof actorOrSystemRole === 'string') {
    systemRole = actorOrSystemRole;
    action = maybeAction;
    tenantRole = maybeTenantRole;
  } else if (typeof actorOrSystemRole === 'object' && actorOrSystemRole !== null) {
    systemRole = actorOrSystemRole.systemRole || actorOrSystemRole.system_role;
    tenantRole = actorOrSystemRole.tenantRole || actorOrSystemRole.tenant_role || maybeTenantRole;
    action = actorOrSystemRole.action || maybeAction;
  }

  if (!systemRole) return false;

  // Platform Super Owner has full authority across any tenant
  if (systemRole === 'OWNER') return true;

  if (systemRole !== 'CUSTOMER' && systemRole !== 'USER') return false;

  // Normalize action key
  const normalizedAction = Object.values(WEBCHAT_PERMISSIONS).includes(action)
    ? action
    : WEBCHAT_PERMISSIONS[action?.toUpperCase?.()] || action;

  // Tenant ADMIN has full management access on their own tenant
  if (tenantRole === 'ADMIN') return true;

  // Tenant AGENT has read-only access (view and view installation)
  if (tenantRole === 'AGENT') {
    return (
      normalizedAction === WEBCHAT_PERMISSIONS.VIEW ||
      normalizedAction === WEBCHAT_PERMISSIONS.VIEW_INSTALLATION ||
      normalizedAction === 'view' ||
      normalizedAction === 'view_installation'
    );
  }

  return false;
}

export function canWriteWebChat({ systemRole, tenantRole } = {}) {
  if (systemRole === 'OWNER') return true;
  return systemRole === 'CUSTOMER' && tenantRole === 'ADMIN';
}

export function canReadWebChat({ systemRole, tenantRole } = {}) {
  if (systemRole === 'OWNER') return true;
  return systemRole === 'CUSTOMER' && (tenantRole === 'ADMIN' || tenantRole === 'AGENT');
}
