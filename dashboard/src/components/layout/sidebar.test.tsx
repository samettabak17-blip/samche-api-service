import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, workspaceAccessCopy } from './sidebar';

vi.mock('../../features/dashboard/dashboard-api', () => ({ tenantApi: { getTenantPlan: vi.fn(), listPlans: vi.fn(), requestPlanUpgrade: vi.fn() } }));
import { tenantApi } from '../../features/dashboard/dashboard-api';

afterEach(cleanup);
beforeEach(() => { vi.mocked(tenantApi.getTenantPlan).mockResolvedValue({ plan_code: 'GROWTH', display_name: 'Growth Plan', customer_subtitle: 'Multi-Channel AI Growth', rank: 2, pending_request: null }); vi.mocked(tenantApi.listPlans).mockResolvedValue([]); });
function renderSidebar(node: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); }

describe('Sidebar', () => {
  it('keeps read pages available while marking an AGENT workspace as read-only', () => {
    renderSidebar(<MemoryRouter><Sidebar tenantId="tenant-agent" tenantName="Agent tenant" tenantRole="AGENT" email="agent@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    expect(screen.getByRole('img', { name: 'SamChe Company LLC' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'SamChe Company LLC' })).toHaveClass('h-32', 'w-full', 'object-center');
    expect(screen.getByText('AI Platform')).toHaveClass('text-gold', 'text-center');
    expect(screen.getByText('Agent tenant')).toBeTruthy();
    expect(screen.getByText('Read-only access')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AI Assistants' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Channels' })).toBeTruthy();
  });
  it('places Customer Engagement before operations and settings', () => {
    renderSidebar(<MemoryRouter initialEntries={['/app/tenant-admin/conversations/whatsapp']}><Sidebar tenantId="tenant-admin" tenantName="Admin tenant" tenantRole="ADMIN" email="admin@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    const navigationText = screen.getByLabelText('Dashboard navigation').textContent ?? '';
    expect(navigationText.indexOf('CUSTOMER ENGAGEMENT')).toBeLessThan(navigationText.indexOf('OPERATIONS'));
    expect(navigationText.indexOf('CUSTOMER ENGAGEMENT')).toBeLessThan(navigationText.indexOf('SETTINGS'));
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Web Chatbot' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'AI Guide' })).toBeTruthy();
  });
});
describe('workspace access presentation', () => {
  it('distinguishes platform-wide OWNER access from tenant-scoped customer administration', () => {
    expect(workspaceAccessCopy('OWNER')).toEqual({ label: 'ADMIN', detail: 'FULL ACCESS' });
    expect(workspaceAccessCopy('ADMIN')).toEqual({ label: 'WORKSPACE ADMIN', detail: 'TENANT ADMINISTRATION' });
  });
  it('does not advertise unsupported plan management to a customer tenant administrator', () => {
    renderSidebar(<MemoryRouter><Sidebar tenantId="tenant-admin" tenantName="Admin tenant" tenantRole="ADMIN" email="admin@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Manage Plan' })).toBeNull();
  });
  it('shows Upgrade Plan for a tenant administrator when a higher canonical plan exists', async () => {
    vi.mocked(tenantApi.getTenantPlan).mockResolvedValue({ plan_code: 'STARTER', display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace', rank: 1, pending_request: null });
    vi.mocked(tenantApi.listPlans).mockResolvedValue([
      { code: 'STARTER', rank: 1, display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace' },
      { code: 'GROWTH', rank: 2, display_name: 'Growth Plan', customer_subtitle: 'Multi-Channel AI Growth' },
    ]);
    renderSidebar(<MemoryRouter><Sidebar tenantId="tenant-admin" tenantName="Admin tenant" tenantRole="ADMIN" email="admin@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upgrade Plan' })).toBeVisible());
  });
  it('keeps the current plan card unchanged and shows pending status only inside Upgrade Plan', async () => {
    vi.mocked(tenantApi.getTenantPlan).mockResolvedValue({ plan_code: 'STARTER', display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace', rank: 1, pending_request: { requested_plan_code: 'BUSINESS' } });
    vi.mocked(tenantApi.listPlans).mockResolvedValue([
      { code: 'STARTER', rank: 1, display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace' },
      { code: 'BUSINESS', rank: 3, display_name: 'Business Plan', customer_subtitle: 'Advanced AI Operations' },
    ]);
    renderSidebar(<MemoryRouter><Sidebar tenantId="tenant-admin" tenantName="Admin tenant" tenantRole="ADMIN" email="admin@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Upgrade Plan' });
    expect(screen.getByText('Starter Plan')).toBeVisible();
    expect(screen.queryByText('Pending approval')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade Plan' }));
    expect(await screen.findByText('Pending approval')).toBeVisible();
    expect(screen.getByText('Business Plan')).toBeVisible();
  });
  it('keeps the platform owner plan entry connected to workspace settings', () => {
    renderSidebar(<MemoryRouter><Sidebar tenantId="tenant-owner" tenantName="Owner tenant" tenantRole="OWNER" email="owner@samche.test" onLogout={() => undefined} onNavigate={() => undefined} /></MemoryRouter>);
    const managePlan = screen.getByRole('link', { name: 'Manage Plan' });
    expect(managePlan.getAttribute('href')).toBe('/app/tenant-owner/settings');
  });
});
