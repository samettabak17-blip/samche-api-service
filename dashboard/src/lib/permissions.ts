export function canManageTenant(tenantRole: 'ADMIN' | 'AGENT' | undefined): boolean {
  return tenantRole === 'ADMIN';
}
export const WEBCHAT_PERMISSIONS = {
  VIEW: 'channels.webchat.view',
  CONFIGURE: 'channels.webchat.configure',
  MANAGE_APPEARANCE: 'channels.webchat.manage_appearance',
  MANAGE_BEHAVIOR: 'channels.webchat.manage_behavior',
  MANAGE_INTEGRATION: 'channels.webchat.manage_integration',
  VIEW_INSTALLATION: 'channels.webchat.view_installation',
} as const;

export type WebChatPermissionKey = (typeof WEBCHAT_PERMISSIONS)[keyof typeof WEBCHAT_PERMISSIONS];

export type WebChatAction =
  | 'view'
  | 'configure'
  | 'manage_appearance'
  | 'manage_behavior'
  | 'manage_integration'
  | 'view_installation'
  | WebChatPermissionKey;

export interface WebChatPermissionRegistryItem {
  key: WebChatPermissionKey;
  action: string;
  name: string;
  module: 'channels';
  introducedByTask: 'TASK_8';
  description: string;
  allowedSystemRoles: readonly string[];
  allowedTenantRoles: readonly ('ADMIN' | 'AGENT')[];
}

export const WEBCHAT_PERMISSION_REGISTRY: readonly WebChatPermissionRegistryItem[] = [
  {
    key: WEBCHAT_PERMISSIONS.VIEW,
    action: 'view',
    name: 'View Web Chat',
    module: 'channels',
    introducedByTask: 'TASK_8',
    description: 'Inspect Web Chat channel state, assistant binding, appearance, and behavior.',
    allowedSystemRoles: ['OWNER'],
    allowedTenantRoles: ['ADMIN', 'AGENT'],
  },
  {
    key: WEBCHAT_PERMISSIONS.CONFIGURE,
    action: 'configure',
    name: 'Configure Web Chat',
    module: 'channels',
    introducedByTask: 'TASK_8',
    description: 'Update Web Chat channel metadata, assistant linkage, and channel active/inactive state.',
    allowedSystemRoles: ['OWNER'],
    allowedTenantRoles: ['ADMIN'],
  },
  {
    key: WEBCHAT_PERMISSIONS.MANAGE_APPEARANCE,
    action: 'manage_appearance',
    name: 'Manage Appearance & Branding',
    module: 'channels',
    introducedByTask: 'TASK_8',
    description: 'Customize widget branding, colors, contrast parameters, launcher layout, and labels.',
    allowedSystemRoles: ['OWNER'],
    allowedTenantRoles: ['ADMIN'],
  },
  {
    key: WEBCHAT_PERMISSIONS.MANAGE_BEHAVIOR,
    action: 'manage_behavior',
    name: 'Manage Proactive Behavior',
    module: 'channels',
    introducedByTask: 'TASK_8',
    description: 'Configure proactive engagement triggers, high-intent auto-open, dwell timing, and cooldowns.',
    allowedSystemRoles: ['OWNER'],
    allowedTenantRoles: ['ADMIN'],
  },
  {
    key: WEBCHAT_PERMISSIONS.MANAGE_INTEGRATION,
    action: 'manage_integration',
    name: 'Manage Integration & Keys',
    module: 'channels',
    introducedByTask: 'TASK_8',
    description: 'Enable, disable, or regenerate the public widget key and integration records.',
    allowedSystemRoles: ['OWNER'],
    allowedTenantRoles: ['ADMIN'],
  },
  {
    key: WEBCHAT_PERMISSIONS.VIEW_INSTALLATION,
    action: 'view_installation',
    name: 'View & Copy Installation Snippet',
    module: 'channels',
    introducedByTask: 'TASK_8',
    description: 'Inspect and copy the client embed snippet containing zero secrets.',
    allowedSystemRoles: ['OWNER'],
    allowedTenantRoles: ['ADMIN', 'AGENT'],
  },
];

export function canPerformWebChatAction({
  systemRole,
  tenantRole,
  action,
}: {
  systemRole?: 'OWNER' | 'CUSTOMER' | string;
  tenantRole?: 'ADMIN' | 'AGENT' | undefined;
  action: WebChatAction;
}): boolean {
  if (!systemRole) return false;
  if (systemRole === 'OWNER') return true;
  if (systemRole !== 'CUSTOMER') return false;

  if (tenantRole === 'ADMIN') return true;

  if (tenantRole === 'AGENT') {
    return (
      action === 'view' ||
      action === 'view_installation' ||
      action === WEBCHAT_PERMISSIONS.VIEW ||
      action === WEBCHAT_PERMISSIONS.VIEW_INSTALLATION
    );
  }

  return false;
}


