import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Topbar } from './topbar';

vi.mock('../../features/overview/overview-date-range-context', () => ({
  useOverviewDateRange: () => ({ preset: 'last-7-days', setPreset: vi.fn(), customStart: '2026-08-01', setCustomStart: vi.fn(), customEnd: '2026-08-07', setCustomEnd: vi.fn(), applyCustomRange: vi.fn(), clearCustomRange: vi.fn(), activeRange: { label: 'Last 7 days' } }),
}));
vi.mock('../../features/live-support/live-support-attention-provider', () => ({ useLiveSupportAttention: () => ({ requestedCount: 0 }) }));
vi.mock('../../features/dashboard/dashboard-api', () => ({ tenantApi: { listConversations: vi.fn(), createTenant: vi.fn(), listCustomerUsers: vi.fn(), assignTenantUser: vi.fn() }, onboardingApi: { createCompanyInvitation: vi.fn() } }));
import { onboardingApi, tenantApi } from '../../features/dashboard/dashboard-api';

function renderTopbar(systemRole: 'OWNER' | 'CUSTOMER' = 'CUSTOMER', onSelectTenant = vi.fn(), tenantRole: 'ADMIN' | 'AGENT' = 'ADMIN') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/app/tenant-1/overview']}><Topbar tenants={[{ id: 'tenant-1', name: 'SamChe', status: 'active', created_at: '' }]} selectedTenantId="tenant-1" email="operator@samche.test" systemRole={systemRole} selectedTenantRole={tenantRole} onCreateTenant={(name) => tenantApi.createTenant(name)} onAdoptTenant={async (tenantId) => { onSelectTenant(tenantId); }} onSelectTenant={onSelectTenant} onOpenNavigation={() => undefined} onLogout={() => undefined} tenantId="tenant-1" /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => cleanup());

describe('Topbar global navigation search', () => {
  it('lets an OWNER create a company and invite its first administrator through the portal modal', async () => {
    vi.mocked(onboardingApi.createCompanyInvitation).mockResolvedValue({ onboarding: { tenant: { id: 'tenant-new', name: 'New company' }, onboarding_status: 'INVITED' } });
    const onSelectTenant = vi.fn();
    renderTopbar('OWNER', onSelectTenant);
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));
    expect(screen.getByRole('dialog', { name: 'Create company' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Assign existing customer' })).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Company name' }), { target: { value: 'New company' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'ada@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create company & invite administrator' }));
    expect(await screen.findByText('Invitation created.')).toBeVisible();
    expect(onboardingApi.createCompanyInvitation).toHaveBeenCalledWith({ name: 'New company', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test' }, expect.any(String));
    expect(onSelectTenant).toHaveBeenCalledWith('tenant-new');
  });

  it('does not render company creation for a CUSTOMER even with tenant ADMIN membership', () => {
    renderTopbar('CUSTOMER');
    expect(screen.queryByRole('button', { name: 'Create company' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign customer' })).toBeNull();
  });

  it('uses platform and tenant role labels without conflating them', () => {
    const { unmount } = renderTopbar('OWNER');
    expect(screen.getByText('Platform Owner')).toBeVisible();
    unmount();
    renderTopbar('CUSTOMER', vi.fn(), 'AGENT');
    expect(screen.getByText('Agent')).toBeVisible();
  });

  it('keeps owner popovers above the header stacking context', () => {
    renderTopbar('OWNER');
    expect(screen.getByRole('banner')).toHaveClass('z-50');
  });

  it('lets an OWNER assign an existing CUSTOMER with an allowed tenant role', async () => {
    vi.mocked(tenantApi.listCustomerUsers).mockResolvedValue([{ id: 'user-1', email: 'customer@example.test', system_role: 'CUSTOMER' }]);
    vi.mocked(tenantApi.assignTenantUser).mockResolvedValue({});
    renderTopbar('OWNER');
    fireEvent.click(screen.getByRole('button', { name: 'Assign customer' }));
    expect(await screen.findByRole('option', { name: 'customer@example.test' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tenant role' }), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('Customer assigned.')).toBeVisible();
    expect(tenantApi.assignTenantUser).toHaveBeenCalledWith('tenant-1', 'user-1', 'ADMIN');
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
