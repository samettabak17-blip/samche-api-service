import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client';
import { tenantApi, tenantKeys } from './dashboard-api';

describe('tenant dashboard API', () => {
  it('keeps query keys tenant-scoped', () => {
    expect(tenantKeys.conversations('tenant-a', 25, 50)).toEqual(['tenant', 'tenant-a', 'conversations', 25, 50]);
    expect(tenantKeys.team('tenant-a')).toEqual(['tenant', 'tenant-a', 'team']);
  });

  it('passes pagination parameters to the real conversations endpoint', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([]);

    await tenantApi.listConversations('tenant-a', { limit: 25, offset: 50 });

    expect(get).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/conversations?limit=25&offset=50');
    get.mockRestore();
  });
});

