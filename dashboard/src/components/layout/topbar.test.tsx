import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Topbar } from './topbar';

vi.mock('../../features/overview/overview-date-range-context', () => ({
  useOverviewDateRange: () => ({ preset: 'last-7-days', setPreset: vi.fn(), customStart: '2026-08-01', setCustomStart: vi.fn(), customEnd: '2026-08-07', setCustomEnd: vi.fn(), applyCustomRange: vi.fn(), clearCustomRange: vi.fn(), activeRange: { label: 'Last 7 days' } }),
}));
vi.mock('../../features/live-support/live-support-attention-provider', () => ({ useLiveSupportAttention: () => ({ requestedCount: 0 }) }));
vi.mock('../../features/dashboard/dashboard-api', () => ({ tenantApi: { listConversations: vi.fn(), createTenant: vi.fn() } }));
import { tenantApi } from '../../features/dashboard/dashboard-api';

function renderTopbar(systemRole: 'OWNER' | 'CUSTOMER' = 'CUSTOMER', onSelectTenant = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/app/tenant-1/overview']}><Topbar tenants={[{ id: 'tenant-1', name: 'SamChe', status: 'active', created_at: '' }]} selectedTenantId="tenant-1" email="operator@samche.test" systemRole={systemRole} onCreateTenant={(name) => tenantApi.createTenant(name)} onSelectTenant={onSelectTenant} onOpenNavigation={() => undefined} onLogout={() => undefined} /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => cleanup());

describe('Topbar global navigation search', () => {
  it('shows company creation only to a platform OWNER and selects the exact created tenant', async () => {
    vi.mocked(tenantApi.createTenant).mockResolvedValue({ id: 'tenant-new', name: 'New company', status: 'active' });
    const onSelectTenant = vi.fn();
    renderTopbar('OWNER', onSelectTenant);
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Company name' }), { target: { value: 'New company' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Company created.')).toBeVisible();
    expect(tenantApi.createTenant).toHaveBeenCalledWith('New company');
    expect(onSelectTenant).toHaveBeenCalledWith('tenant-new');
  });

  it('does not render company creation for a CUSTOMER even with tenant ADMIN membership', () => {
    renderTopbar('CUSTOMER');
    expect(screen.queryByRole('button', { name: 'Create company' })).toBeNull();
  });

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

  it('closes on outside click and Escape, then remains reusable', () => {
    renderTopbar();
    const input = screen.getByRole('textbox', { name: 'Search dashboard destinations' });
    for (let cycle = 0; cycle < 10; cycle += 1) {
      fireEvent.click(input);
      expect(screen.getByRole('listbox', { name: 'Dashboard destinations' })).toBeTruthy();
      if (cycle % 2 === 0) fireEvent.mouseDown(document.body);
      else fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('listbox', { name: 'Dashboard destinations' })).toBeNull();
    }
  });
});
