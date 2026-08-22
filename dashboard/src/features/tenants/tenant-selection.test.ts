import { describe, expect, it } from 'vitest';
import type { Tenant } from '../../types/api';
import { resolveSelectedTenant } from './tenant-selection';

const tenants: Tenant[] = [
  { id: 'tenant-admin', name: 'Admin tenant', status: 'active', tenant_role: 'ADMIN' },
  { id: 'tenant-agent', name: 'Agent tenant', status: 'active', tenant_role: 'AGENT' },
];

describe('resolveSelectedTenant', () => {
  it('derives tenant permissions from the selected tenant API row', () => {
    expect(resolveSelectedTenant(tenants, 'tenant-admin')?.tenant_role).toBe('ADMIN');
    expect(resolveSelectedTenant(tenants, 'tenant-agent')?.tenant_role).toBe('AGENT');
  });

  it('falls back to the first tenant only when a stored selection is unavailable', () => {
    expect(resolveSelectedTenant(tenants, 'missing')?.id).toBe('tenant-admin');
  });
});

