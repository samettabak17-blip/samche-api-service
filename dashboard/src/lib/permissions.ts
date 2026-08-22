export function canManageTenant(tenantRole: 'ADMIN' | 'AGENT' | undefined): boolean {
  return tenantRole === 'ADMIN';
}

