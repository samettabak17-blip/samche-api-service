import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';
import { useAuth } from '../../features/auth/auth-context';
import { useTenant } from '../../features/tenants/tenant-context';
import { tenantApi, onboardingApi } from '../../features/dashboard/dashboard-api';

vi.mock('../../features/auth/auth-context', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../features/tenants/tenant-context', () => ({
  useTenant: vi.fn(),
}));

vi.mock('../../features/overview/overview-date-range-context', () => ({
  useOverviewDateRange: () => ({
    preset: 'last-7-days',
    setPreset: vi.fn(),
    customStart: '2026-08-01',
    setCustomStart: vi.fn(),
    customEnd: '2026-08-07',
    setCustomEnd: vi.fn(),
    applyCustomRange: vi.fn(),
    clearCustomRange: vi.fn(),
    activeRange: { label: 'Last 7 days' },
  }),
  OverviewDateRangeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../features/live-support/live-support-attention-provider', () => ({
  useLiveSupportAttention: () => ({ requestedCount: 0 }),
  GlobalLiveSupportIndicator: () => null,
  LiveSupportAttentionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../features/dashboard/dashboard-api', () => ({
  tenantApi: {
    getTenantPlan: vi.fn(),
    listPlans: vi.fn(),
    requestPlanUpgrade: vi.fn(),
    listConversations: vi.fn(),
    createTenant: vi.fn(),
    listCustomerUsers: vi.fn(),
    assignTenantUser: vi.fn(),
    listPlanUpgradeRequests: vi.fn(),
    resolvePlanUpgradeRequest: vi.fn(),
    listPlanUpgradeNotifications: vi.fn(),
    markPlanUpgradeNotificationRead: vi.fn(),
  },
  onboardingApi: {
    createCompanyInvitation: vi.fn(),
    listInvitationStatuses: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const defaultUser = {
  id: 'user-1',
  email: 'admin@samche.test',
  system_role: 'CUSTOMER' as const,
};

const defaultTenant = {
  id: 'tenant-1',
  name: 'Acme Corp',
  status: 'active',
  created_at: '2026-01-01',
};
beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: defaultUser,
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
  });
  vi.mocked(useTenant).mockReturnValue({
    tenants: [defaultTenant],
    selectedTenant: defaultTenant,
    tenantRole: 'ADMIN',
    canManage: true,
    isLoading: false,
    error: null,
    selectTenant: vi.fn(),
    adoptTenant: vi.fn(),
    createTenant: vi.fn(),
    isOwner: false,
  });
  vi.mocked(tenantApi.getTenantPlan).mockResolvedValue({
    plan_code: 'GROWTH',
    display_name: 'Growth Plan',
    customer_subtitle: 'Multi-Channel AI Growth',
    rank: 2,
    pending_request: null,
  });
  vi.mocked(tenantApi.listPlans).mockResolvedValue([]);
  vi.mocked(tenantApi.listPlanUpgradeRequests).mockResolvedValue([]);
  vi.mocked(tenantApi.listPlanUpgradeNotifications).mockResolvedValue([]);
  vi.mocked(onboardingApi.listInvitationStatuses).mockResolvedValue([]);
});

function renderShell(initialRoute = '/app/tenant-1/overview') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route
            path="/app/:tenantId/*"
            element={
              <AppShell>
                <div>Dashboard Body Content</div>
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppShell responsive navigation and drawer layout', () => {
  it('renders content and keeps mobile navigation closed by default', () => {
    renderShell();
    expect(screen.getByText('Dashboard Body Content')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
  });

  it('opens mobile navigation drawer with accessible dialog attributes when toggle is clicked', () => {
    renderShell();
    const openButton = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(openButton);

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Close navigation' }).length).toBeGreaterThanOrEqual(1);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes mobile drawer when clicking the close button', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeTruthy();

    const closeButtons = screen.getAllByRole('button', { name: 'Close navigation' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes mobile drawer when clicking the backdrop overlay', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeTruthy();

    const closeButtons = screen.getAllByRole('button', { name: 'Close navigation' });
    fireEvent.click(closeButtons[0]);

    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes mobile drawer when Escape key is pressed', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders all authorized links inside mobile drawer and closes drawer on link navigation', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    const dialog = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(dialog).toBeTruthy();

    const settingsLinks = screen.getAllByRole('link', { name: 'Settings' });
    expect(settingsLinks.length).toBe(2);

    fireEvent.click(settingsLinks[1]);
    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
  });
});
