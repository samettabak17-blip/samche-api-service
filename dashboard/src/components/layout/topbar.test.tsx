import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Topbar } from './topbar';

vi.mock('../../features/overview/overview-date-range-context', () => ({
  useOverviewDateRange: () => ({ preset: 'last-7-days', setPreset: vi.fn(), customStart: '2026-08-01', setCustomStart: vi.fn(), customEnd: '2026-08-07', setCustomEnd: vi.fn(), applyCustomRange: vi.fn(), clearCustomRange: vi.fn(), activeRange: { label: 'Last 7 days' } }),
}));
vi.mock('../../features/live-support/live-support-attention-provider', () => ({ useLiveSupportAttention: () => ({ requestedCount: 0 }) }));
vi.mock('../../features/dashboard/dashboard-api', () => ({ tenantApi: { listConversations: vi.fn() } }));

function renderTopbar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/app/tenant-1/overview']}><Topbar tenants={[{ id: 'tenant-1', name: 'SamChe', status: 'active', created_at: '' }]} selectedTenantId="tenant-1" email="operator@samche.test" onSelectTenant={() => undefined} onOpenNavigation={() => undefined} onLogout={() => undefined} /></MemoryRouter></QueryClientProvider>);
}

describe('Topbar global navigation search', () => {
  it('reopens when the trigger remains focused after selecting a destination', () => {
    renderTopbar();
    const input = screen.getByRole('textbox', { name: 'Search dashboard destinations' });
    fireEvent.focus(input);
    expect(screen.getByRole('listbox', { name: 'Dashboard destinations' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Overview/ }));
    expect(screen.queryByRole('listbox', { name: 'Dashboard destinations' })).toBeNull();
    fireEvent.click(input);
    expect(screen.getByRole('listbox', { name: 'Dashboard destinations' })).toBeTruthy();
  });

  it('keeps destination aliases keyed independently', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderTopbar();
    fireEvent.focus(screen.getByRole('textbox', { name: 'Search dashboard destinations' }));
    expect(consoleError.mock.calls.some(([message]) => String(message).includes('same key'))).toBe(false);
    consoleError.mockRestore();
  });
});