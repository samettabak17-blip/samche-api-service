import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { user: { id: 'owner-1', email: 'owner@samche.test', system_role: 'OWNER' }, status: 'authenticated' };
const tenantState = { selectedTenant: { id: 'tenant-1', name: 'Blue Dune Event Management LLC', status: 'active' }, tenantRole: 'ADMIN' };
vi.mock('../auth/auth-context', () => ({ useAuth: () => authState }));
vi.mock('../tenants/tenant-context', () => ({ useTenant: () => tenantState }));
vi.mock('../dashboard/dashboard-api', () => ({
  onboardingApi: { changePassword: vi.fn() },
  tenantApi: { getTenantPlan: vi.fn(), listPlans: vi.fn(), changeTenantPlanAsOwner: vi.fn(), getTenantSubscription: vi.fn() },
}));
import { tenantApi } from '../dashboard/dashboard-api';
import { SettingsPage } from './settings-page';

afterEach(cleanup);
beforeEach(() => {
  authState.user = { id: 'owner-1', email: 'owner@samche.test', system_role: 'OWNER' };
  tenantState.selectedTenant = { id: 'tenant-1', name: 'Blue Dune Event Management LLC', status: 'active' };
  vi.mocked(tenantApi.getTenantPlan).mockResolvedValue({ plan_code: 'STARTER', display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace', rank: 1, pending_request: null });
  vi.mocked(tenantApi.getTenantSubscription).mockResolvedValue({
    subscription: { code: 'STARTER', display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace', rank: 1, billing_cycle: 'MONTHLY', currency: 'AED', monthly_price_aed: 1790, annual_price_aed: 18258, setup_fee_aed: 2500, status: 'ACTIVE' },
    capabilities: {},
    limits: {},
    locked_capabilities: [],
  });
  vi.mocked(tenantApi.listPlans).mockResolvedValue([
    { code: 'STARTER', display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace', rank: 1, monthly_price_aed: 1790, annual_price_aed: 18258, setup_fee_aed: 2500, currency: 'AED', included_capabilities: [], included_limits: {} },
    { code: 'GROWTH', display_name: 'Growth Plan', customer_subtitle: 'Multi-Channel AI Growth', rank: 2, monthly_price_aed: 3990, annual_price_aed: 40698, setup_fee_aed: 5000, currency: 'AED', included_capabilities: [], included_limits: {} },
  ]);
  vi.mocked(tenantApi.changeTenantPlanAsOwner).mockResolvedValue({ plan_code: 'GROWTH', display_name: 'Growth Plan', customer_subtitle: 'Multi-Channel AI Growth', rank: 2 });
});
function renderPage() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SettingsPage /></QueryClientProvider>); }

describe('owner Selected tenant plan management', () => {
  it('renders the explicit manual control only in the Selected tenant card and saves no change until requested', async () => {
    renderPage();
    expect(await screen.findByText('Current plan')).toBeVisible();
    await screen.findByRole('option', { name: 'Growth Plan' });
    const select = screen.getByLabelText('Manage plan');
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    fireEvent.change(select, { target: { value: 'GROWTH' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save plan' })).toBeEnabled());
    expect(tenantApi.changeTenantPlanAsOwner).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(tenantApi.changeTenantPlanAsOwner).toHaveBeenCalledWith('tenant-1', 'GROWTH'));
  });

  it('does not expose direct management to a tenant administrator', async () => {
    authState.user = { id: 'customer-1', email: 'admin@blue.test', system_role: 'CUSTOMER' };
    renderPage();
    expect(screen.queryByLabelText('Manage plan')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save plan' })).toBeNull();
  });
});
