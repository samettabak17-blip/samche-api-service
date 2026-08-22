import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '../features/auth/auth-context';
import { TenantProvider } from '../features/tenants/tenant-context';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }));

  return <QueryClientProvider client={queryClient}><AuthProvider><TenantProvider>{children}</TenantProvider></AuthProvider></QueryClientProvider>;
}

