import { describe, expect, it, vi } from 'vitest';
import { invalidateTenantResource, selectTenantAssistants } from './resource-utils';

describe('dashboard resource helpers', () => {
  it('filters assistant choices to the active tenant', () => {
    expect(selectTenantAssistants([
      { id: 'assistant-a', tenant_id: 'tenant-a', name: 'A' },
      { id: 'assistant-b', tenant_id: 'tenant-b', name: 'B' },
    ], 'tenant-a')).toEqual([{ id: 'assistant-a', tenant_id: 'tenant-a', name: 'A' }]);
  });

  it('preserves assistants when tenant_id is omitted on the record', () => {
    expect(selectTenantAssistants([
      { id: 'assistant-scoped', name: 'Scoped Assistant' } as never,
    ], 'tenant-a')).toEqual([{ id: 'assistant-scoped', name: 'Scoped Assistant' }]);
  });

  it('strictly excludes assistants belonging to another tenant', () => {
    expect(selectTenantAssistants([
      { id: 'assistant-b', tenant_id: 'tenant-b', name: 'Wrong Tenant' },
    ], 'tenant-a')).toEqual([]);
  });

  it('returns empty when no tenantId is provided', () => {
    expect(selectTenantAssistants([
      { id: 'assistant-a', tenant_id: 'tenant-a', name: 'A' },
    ], '')).toEqual([]);
  });

  it('invalidates only the requested tenant resource key', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateTenantResource({ invalidateQueries } as never, 'tenant-a', 'channels');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tenant', 'tenant-a', 'channels'] });
  });
});

