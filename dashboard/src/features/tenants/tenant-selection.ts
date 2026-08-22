import type { Tenant } from '../../types/api';

export function resolveSelectedTenant(tenants: Tenant[], selectedTenantId: string | null): Tenant | undefined {
  return tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0];
}

