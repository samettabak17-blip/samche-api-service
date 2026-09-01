import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tenantApi } from '../dashboard/dashboard-api';
import { canManageTenant } from '../../lib/permissions';
import type { Tenant, TenantRole } from '../../types/api';
import { useAuth } from '../auth/auth-context';
import { resolveSelectedTenant } from './tenant-selection';

const tenantStorageKey = 'samche.dashboard.selected-tenant.v1';

interface TenantContextValue {
  tenants: Tenant[];
  selectedTenant: Tenant | undefined;
  tenantRole: TenantRole | undefined;
  canManage: boolean;
  isLoading: boolean;
  error: Error | null;
  selectTenant(tenantId: string): void;
  adoptTenant(tenantId: string): Promise<void>;
  createTenant(name: string): Promise<Tenant>;
  isOwner: boolean;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(() => window.sessionStorage.getItem(tenantStorageKey));
  const tenantsQuery = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantApi.listTenants(),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
  const tenants = tenantsQuery.data ?? [];
  const selectedTenant = resolveSelectedTenant(tenants, selectedTenantId);

  useEffect(() => {
    if (selectedTenant && selectedTenant.id !== selectedTenantId) {
      setSelectedTenantId(selectedTenant.id);
      window.sessionStorage.setItem(tenantStorageKey, selectedTenant.id);
    }
  }, [selectedTenant, selectedTenantId]);

  const selectTenant = useCallback((tenantId: string) => {
    if (!tenants.some((tenant) => tenant.id === tenantId)) {
      return;
    }

    setSelectedTenantId((currentTenantId) => {
      if (currentTenantId && currentTenantId !== tenantId) {
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] === 'tenant' && query.queryKey[1] === currentTenantId,
        });
      }

      return tenantId;
    });
    window.sessionStorage.setItem(tenantStorageKey, tenantId);
  }, [queryClient, tenants]);
  const adoptTenant = useCallback(async (tenantId: string) => {
    const refreshed = await tenantsQuery.refetch();
    const refreshedTenants = refreshed.data ?? [];
    if (!refreshedTenants.some((tenant) => tenant.id === tenantId)) {
      throw new Error('New company was not available after refresh');
    }
    setSelectedTenantId(tenantId);
    window.sessionStorage.setItem(tenantStorageKey, tenantId);
  }, [tenantsQuery]);

  const tenantRole = selectedTenant?.tenant_role;
  const isOwner = user?.system_role === 'OWNER';
  const canManage = user?.system_role === 'OWNER' || canManageTenant(tenantRole);
  const createTenant = useCallback(async (name: string) => {
    const created = await tenantApi.createTenant(name.trim());
    await tenantsQuery.refetch();
    setSelectedTenantId(created.id);
    window.sessionStorage.setItem(tenantStorageKey, created.id);
    return created;
  }, [tenantsQuery.refetch]);
  const value = useMemo<TenantContextValue>(() => ({
    tenants,
    selectedTenant,
    tenantRole,
    canManage,
    isLoading: tenantsQuery.isLoading,
    error: tenantsQuery.error,
    selectTenant,
    adoptTenant,
    createTenant,
    isOwner,
  }), [adoptTenant, canManage, createTenant, isOwner, selectTenant, selectedTenant, tenantRole, tenants, tenantsQuery.error, tenantsQuery.isLoading]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used inside TenantProvider');
  }

  return context;
}

