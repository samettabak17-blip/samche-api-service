import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { user: { id: 'owner-1', email: 'owner@samche.test', system_role: 'OWNER' }, status: 'authenticated' };
const tenantState = { selectedTenant: { id: 'tenant-1', name: 'Blue Dune Event Management LLC', status: 'active' }, tenantRole: 'ADMIN' };
vi.mock('../auth/auth-context', () => ({ useAuth: () => authState }));
vi.mock('../tenants/tenant-context', () => ({ useTenant: () => tenantState }));
vi.mock('../dashboard/dashboard-api', () => ({
  onboardingApi: { changePassword: vi.fn() },
  tenantApi: {
    getTenantPlan: vi.fn(),
    listPlans: vi.fn(),
    changeTenantPlanAsOwner: vi.fn(),
    getTenantSubscription: vi.fn(),
    grantEntitlementOverride: vi.fn(),
    revokeEntitlementOverride: vi.fn(),
    updateUsageAllocation: vi.fn(),
    getEntitlementsAuditLog: vi.fn(),
  },
}));
import { tenantApi } from '../dashboard/dashboard-api';
import { SettingsPage } from './settings-page';

afterEach(cleanup);
beforeEach(() => {
  authState.user = { id: 'owner-1', email: 'owner@samche.test', system_role: 'OWNER' };
  tenantState.selectedTenant = { id: 'tenant-1', name: 'Blue Dune Event Management LLC', status: 'active' };
  vi.mocked(tenantApi.getTenantPlan).mockResolvedValue({
    plan_code: 'GROWTH',
    display_name: 'Growth Plan',
    customer_subtitle: 'Multi-Channel AI Growth',
    rank: 2,
    billing_cycle: 'MONTHLY',
    pending_request: null,
  });
  vi.mocked(tenantApi.getTenantSubscription).mockResolvedValue({
    subscription: {
      code: 'GROWTH',
      display_name: 'Growth Plan',
      customer_subtitle: 'Multi-Channel AI Growth',
      rank: 2,
      billing_cycle: 'MONTHLY',
      currency: 'AED',
      monthly_price_aed: 3990,
      annual_price_aed: 40698,
      setup_fee_aed: 5000,
      status: 'ACTIVE',
    },
    capabilities: {
      webchat: { key: 'webchat', name: 'Web Chatbot', category: 'CHANNELS', min_plan: 'STARTER', entitled: true, source: 'PLAN', enabled: true, reason: null, upgrade_required: null },
      whatsapp: { key: 'whatsapp', name: 'WhatsApp AI', category: 'CHANNELS', min_plan: 'GROWTH', entitled: true, source: 'PLAN', enabled: true, reason: null, upgrade_required: null },
      guide: { key: 'guide', name: 'AI Guide', category: 'CHANNELS', min_plan: 'BUSINESS', entitled: false, source: 'LOCKED', enabled: false, reason: null, upgrade_required: 'BUSINESS' },
    },
    limits: {
      monthly_interactions: { metric_key: 'monthly_interactions', name: 'Monthly Interactions', limit: 20000, current: 50, remaining: 19950, reset_interval: 'MONTHLY' },
      max_integrations: { metric_key: 'max_integrations', name: 'Integrations', limit: 1, current: 0, remaining: 1, reset_interval: 'NEVER' },
    },
    locked_capabilities: [
      { key: 'guide', name: 'AI Guide', category: 'CHANNELS', min_plan: 'BUSINESS', description: 'Interactive AI Guide white-label experience' },
    ],
  });
  vi.mocked(tenantApi.listPlans).mockResolvedValue([
    { code: 'STARTER', display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace', rank: 1, monthly_price_aed: 1790, annual_price_aed: 18258, setup_fee_aed: 2500, currency: 'AED', included_capabilities: [], included_limits: {} },
    { code: 'GROWTH', display_name: 'Growth Plan', customer_subtitle: 'Multi-Channel AI Growth', rank: 2, monthly_price_aed: 3990, annual_price_aed: 40698, setup_fee_aed: 5000, currency: 'AED', included_capabilities: [], included_limits: {} },
    { code: 'BUSINESS', display_name: 'Business Plan', customer_subtitle: 'Advanced AI Operations', rank: 3, monthly_price_aed: 7990, annual_price_aed: 81498, setup_fee_aed: 10000, currency: 'AED', included_capabilities: [], included_limits: {} },
  ]);
  vi.mocked(tenantApi.getEntitlementsAuditLog).mockResolvedValue([
    { id: 'audit-1', tenant_id: 'tenant-1', action_type: 'PLAN_CHANGE', details: { previousPlan: 'STARTER', newPlan: 'GROWTH' }, performed_by_email: 'owner@samche.test', created_at: new Date().toISOString() },
  ]);
  vi.mocked(tenantApi.changeTenantPlanAsOwner).mockResolvedValue({ plan_code: 'BUSINESS', display_name: 'Business Plan', customer_subtitle: 'Advanced AI Operations', rank: 3 });
  vi.mocked(tenantApi.grantEntitlementOverride).mockResolvedValue({ id: 'ov-1', capability_key: 'guide', effect: 'GRANT' });
  vi.mocked(tenantApi.revokeEntitlementOverride).mockResolvedValue({ success: true, revoked: true });
  vi.mocked(tenantApi.updateUsageAllocation).mockResolvedValue({ metric_key: 'monthly_interactions', allocated_limit: 50000 });
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

describe('Subscription & Entitlements Super Owner Management', () => {
  it('renders complete Super Owner subscription and entitlement governance surface', async () => {
    renderPage();
    expect(await screen.findByText('Subscription & Entitlements')).toBeVisible();
    expect(screen.getByText('Super Owner Governance')).toBeVisible();
    expect(screen.getAllByText('Growth Plan').length).toBeGreaterThan(0);
    expect(screen.getByText('AED 3,990/mo')).toBeVisible();
    expect(screen.getByText('Usage Allocations & Limits')).toBeVisible();
    expect(screen.getByText('Platform Capabilities & Feature Overrides')).toBeVisible();
    expect(screen.getByText('Entitlement Audit History')).toBeVisible();
  });

  it('allows Super Owner to change plan and billing cycle', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Business Plan' });
    const planSelect = screen.getByLabelText('Manage plan');
    const cycleSelect = screen.getByLabelText('Billing cycle');

    fireEvent.change(planSelect, { target: { value: 'BUSINESS' } });
    fireEvent.change(cycleSelect, { target: { value: 'ANNUAL' } });

    const saveBtn = screen.getByRole('button', { name: 'Save plan' });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(tenantApi.changeTenantPlanAsOwner).toHaveBeenCalledWith('tenant-1', 'BUSINESS', 'ANNUAL');
    });
  });

  it('allows Super Owner to adjust usage allocation limits', async () => {
    renderPage();
    await screen.findByText('Monthly Interactions');
    const adjustBtns = screen.getAllByRole('button', { name: /Adjust/i });
    expect(adjustBtns.length).toBeGreaterThan(0);
    fireEvent.click(adjustBtns[0]);

    const quotaInput = screen.getByLabelText(/Set quota for/i);
    fireEvent.change(quotaInput, { target: { value: '50000' } });

    const saveLimitBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveLimitBtn);

    await waitFor(() => {
      expect(tenantApi.updateUsageAllocation).toHaveBeenCalledWith('tenant-1', 'monthly_interactions', 50000);
    });
  });

  it('allows Super Owner to configure and grant feature overrides', async () => {
    renderPage();
    await screen.findByText('Platform Capabilities & Feature Overrides');
    const setOverrideBtns = screen.getAllByRole('button', { name: /Set Override/i });
    expect(setOverrideBtns.length).toBeGreaterThan(0);
    fireEvent.click(setOverrideBtns[0]);

    expect(await screen.findByText(/Configure Override/i)).toBeVisible();
    const reasonInput = screen.getByPlaceholderText(/VIP enterprise trial/i);
    fireEvent.change(reasonInput, { target: { value: 'VIP beta testing customer' } });

    const applyBtn = screen.getByRole('button', { name: 'Apply Override' });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(tenantApi.grantEntitlementOverride).toHaveBeenCalled();
    });
  });

  it('keeps normal tenant administrators read-only for platform governance', async () => {
    authState.user = { id: 'customer-1', email: 'admin@bluedune.test', system_role: 'CUSTOMER' };
    renderPage();

    expect(await screen.findByText('Subscription & Entitlements')).toBeVisible();
    expect(screen.queryByText('Super Owner Governance')).toBeNull();
    expect(screen.queryByLabelText('Manage plan')).toBeNull();
    expect(screen.queryByLabelText('Billing cycle')).toBeNull();
    expect(screen.queryByRole('button', { name: /Adjust/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Set Override/i })).toBeNull();
    expect(screen.queryByText('Platform Capabilities & Feature Overrides')).toBeNull();
    expect(screen.queryByText('Entitlement Audit History')).toBeNull();
  });
});
