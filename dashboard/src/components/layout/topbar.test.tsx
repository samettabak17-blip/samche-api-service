import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Topbar } from './topbar';

vi.mock('../../features/overview/overview-date-range-context', () => ({
  useOverviewDateRange: () => ({ preset: 'last-7-days', setPreset: vi.fn(), customStart: '2026-08-01', setCustomStart: vi.fn(), customEnd: '2026-08-07', setCustomEnd: vi.fn(), applyCustomRange: vi.fn(), clearCustomRange: vi.fn(), activeRange: { label: 'Last 7 days' } }),
}));
vi.mock('../../features/live-support/live-support-attention-provider', () => ({ useLiveSupportAttention: () => ({ requestedCount: 0 }) }));
vi.mock('../../features/dashboard/dashboard-api', () => ({ tenantApi: { listConversations: vi.fn(), createTenant: vi.fn(), listCustomerUsers: vi.fn(), assignTenantUser: vi.fn() }, onboardingApi: { createCompanyInvitation: vi.fn(), listInvitationStatuses: vi.fn() } }));
import { onboardingApi, tenantApi } from '../../features/dashboard/dashboard-api';

function renderTopbar(systemRole: 'OWNER' | 'CUSTOMER' = 'CUSTOMER', onSelectTenant = vi.fn(), tenantRole: 'ADMIN' | 'AGENT' = 'ADMIN') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/app/tenant-1/overview']}><Topbar tenants={[{ id: 'tenant-1', name: 'SamChe', status: 'active', created_at: '' }]} selectedTenantId="tenant-1" email="operator@samche.test" systemRole={systemRole} selectedTenantRole={tenantRole} onCreateTenant={(name) => tenantApi.createTenant(name)} onAdoptTenant={async (tenantId) => { onSelectTenant(tenantId); }} onSelectTenant={onSelectTenant} onOpenNavigation={() => undefined} onLogout={() => undefined} tenantId="tenant-1" /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  vi.mocked(onboardingApi.listInvitationStatuses).mockResolvedValue([]);
});

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

  it('keeps each create-company field focused while its controlled value changes', () => {
    renderTopbar('OWNER');
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }));

    for (const [name, value] of [
      ['Company name', 'Northwind'],
      ['First name', 'Ada'],
      ['Last name', 'Lovelace'],
      ['Email', 'ada@example.test'],
    ] as const) {
      const field = screen.getByRole('textbox', { name });
      field.focus();
      fireEvent.change(field, { target: { value } });
      expect(document.activeElement).toBe(field);
    }
  });

  it('keeps the create-company modal Escape close and focus restoration behavior', () => {
    renderTopbar('OWNER');
    const trigger = screen.getByRole('button', { name: 'Create company' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: 'Company name' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Create company' })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('does not render company creation for a CUSTOMER even with tenant ADMIN membership', () => {
    renderTopbar('CUSTOMER');
    expect(screen.queryByRole('button', { name: 'Create company' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign customer' })).toBeNull();
  });

  it('shows an OWNER a safe invitation delivery failure status for the selected company', async () => {
    vi.mocked(onboardingApi.listInvitationStatuses).mockResolvedValue([{ id: 'invite-1', status: 'PENDING', tenant_role: 'ADMIN', expires_at: '', created_at: '', delivery_status: 'DELIVERY_FAILED', delivery_code: 'SMTP_RECIPIENT_REJECTED', attempt_count: 1 }]);
    renderTopbar('OWNER');
    expect(await screen.findByText('Invitation delivery failed.')).toBeVisible();
    expect(screen.getByText('SMTP_RECIPIENT_REJECTED')).toBeVisible();
  });

  it('renders invitation delivery status with readable hierarchy and actions', async () => {
    vi.mocked(onboardingApi.listInvitationStatuses).mockResolvedValue([{ id: 'invite-1', status: 'PENDING', tenant_role: 'ADMIN', expires_at: '', created_at: '', delivery_status: 'SENT', delivery_code: 'SMTP_ACCEPTED', attempt_count: 1 }]);
    renderTopbar('OWNER');
    expect(await screen.findByText('Invitation sent.')).toHaveClass('invitation-delivery-label');
    expect(screen.getByText('SMTP_ACCEPTED')).toHaveClass('invitation-delivery-code');
    expect(screen.getByRole('button', { name: 'Resend' })).toHaveClass('topbar-status-action', 'whitespace-nowrap');
  });

  it('refreshes the owner invitation state after the durable outbox has had time to progress', async () => {
    vi.useFakeTimers();
    vi.mocked(onboardingApi.listInvitationStatuses)
      .mockResolvedValueOnce([{ id: 'invite-1', status: 'PENDING', tenant_role: 'ADMIN', expires_at: '', created_at: '', delivery_status: 'PENDING_DELIVERY', delivery_code: null, attempt_count: 0 }])
      .mockResolvedValueOnce([{ id: 'invite-1', status: 'PENDING', tenant_role: 'ADMIN', expires_at: '', created_at: '', delivery_status: 'SENT', delivery_code: 'SMTP_ACCEPTED', attempt_count: 1 }]);
    renderTopbar('OWNER');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText('Invitation pending.')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText('Invitation sent.')).toBeVisible();
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

  it('keeps owner actions compact and on one line', () => {
    renderTopbar('OWNER');
    expect(screen.getByRole('button', { name: 'Create company' })).toHaveClass('whitespace-nowrap', 'shrink-0', 'h-10');
    expect(screen.getByRole('button', { name: 'Assign customer' })).toHaveClass('whitespace-nowrap', 'shrink-0', 'h-10');
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
