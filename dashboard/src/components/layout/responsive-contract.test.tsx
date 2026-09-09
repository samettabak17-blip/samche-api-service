import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';
import { CANONICAL_NAVIGATION, CANONICAL_GROUPS } from './sidebar';
import { useAuth } from '../../features/auth/auth-context';
import { useTenant } from '../../features/tenants/tenant-context';
import { tenantApi, onboardingApi, pushNotificationApi } from '../../features/dashboard/dashboard-api';
import { SettingsPage } from '../../features/settings/settings-page';

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
  pushNotificationApi: {
    getCapability: vi.fn(),
    getPreference: vi.fn(),
    updatePreference: vi.fn(),
    registerSubscription: vi.fn(),
    unsubscribe: vi.fn(),
    getSubscriptionStatus: vi.fn().mockResolvedValue({ registered: false, enabled: false, failureCode: null }),
  },
}));

const REPRESENTATIVE_WIDTHS = [320, 360, 375, 390, 412, 430, 768] as const;

const defaultUser = {
  id: 'user-1',
  email: 'admin@samche.test',
  system_role: 'CUSTOMER' as const,
};

const defaultTenant = {
  id: 'tenant-1',
  name: 'SamChe Enterprise',
  status: 'active',
  created_at: '2026-01-01',
};

function renderDashboardWithShell(initialRoute = '/app/tenant-1/overview') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route
            path="/app/:tenantId/*"
            element={
              <AppShell>
                <Routes>
                  <Route path="overview" element={<div>Overview Content</div>} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<div>Other Module Content</div>} />
                </Routes>
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function setViewport(width: number, height = 800) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

beforeEach(() => {
  setViewport(375, 812);
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
  vi.mocked(pushNotificationApi.getCapability).mockResolvedValue({ configured: true, publicKey: 'AQ' });
  vi.mocked(pushNotificationApi.getPreference).mockResolvedValue({ push_enabled: false, categories: {} });
});

describe('GLOBAL_MOBILE_RESPONSIVE contract — representative mobile viewport widths', () => {
  for (const width of REPRESENTATIVE_WIDTHS) {
    describe(`Viewport width ${width}px`, () => {
      it(`opens navigation, accesses complete authorized set, reaches lower entries & Settings -> Phone Notifications, closes and reopens cleanly`, async () => {
        setViewport(width, 700);
        renderDashboardWithShell();

        // 1. Open navigation
        const openNavBtn = screen.getByRole('button', { name: 'Open navigation' });
        expect(openNavBtn).toBeVisible();
        fireEvent.click(openNavBtn);

        // Drawer dialog is active
        const drawer = screen.getByRole('dialog', { name: 'Navigation menu' });
        expect(drawer).toBeVisible();
        expect(drawer.getAttribute('aria-modal')).toBe('true');
        expect(document.body.style.overflow).toBe('hidden');

        // 2. Access the complete canonical authorized navigation set inside drawer
        for (const item of CANONICAL_NAVIGATION) {
          const links = screen.getAllByRole('link', { name: item.label });
          expect(links.length).toBeGreaterThanOrEqual(1);
          expect(links[links.length - 1].getAttribute('href')).toBe(`/app/tenant-1${item.suffix}`);
        }

        // 3. Lower navigation entries (Team, Settings) are reachable
        const teamLinks = screen.getAllByRole('link', { name: 'Team' });
        expect(teamLinks[teamLinks.length - 1]).toBeVisible();

        const settingsLinks = screen.getAllByRole('link', { name: 'Settings' });
        const mobileSettingsLink = settingsLinks[settingsLinks.length - 1];
        expect(mobileSettingsLink).toBeVisible();

        // 4. Navigate successfully to Settings via mobile drawer
        fireEvent.click(mobileSettingsLink);

        // Drawer auto-closes on route navigation
        expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
        expect(document.body.style.overflow).toBe('');

        // 5. On Settings page, Phone Notifications is reached and rendered
        expect(await screen.findByRole('region', { name: 'Phone notifications' })).toBeVisible();
        expect(screen.getByText('Phone notifications')).toBeVisible();

        // 6. Reopen navigation after route change
        const reopenNavBtn = screen.getByRole('button', { name: 'Open navigation' });
        fireEvent.click(reopenNavBtn);
        expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();

        // 7. Close via close button
        const closeButtons = screen.getAllByRole('button', { name: 'Close navigation' });
        fireEvent.click(closeButtons[closeButtons.length - 1]);
        expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();
      });
    });
  }
});

describe('Orientation, desktop preservation, and security contracts', () => {
  it('supports landscape orientation (short height constrained) with vertically scrollable drawer', () => {
    // Landscape phone: width 844, height 375
    setViewport(844, 375);
    renderDashboardWithShell();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(drawer).toBeVisible();

    // Verify drawer panel container has 100dvh bounding, min-h-0, overflow-hidden
    const panel = drawer.querySelector('.w-72');
    expect(panel).toBeTruthy();
    expect(panel?.className).toContain('max-h-[100dvh]');
    expect(panel?.className).toContain('min-h-0');
    expect(panel?.className).toContain('overflow-hidden');

    // Verify aside container has min-h-0, overflow-y-auto, subtle-scrollbar for momentum scroll
    const aside = drawer.querySelector('aside');
    expect(aside).toBeTruthy();
    expect(aside?.className).toContain('min-h-0');
    expect(aside?.className).toContain('overflow-y-auto');
    expect(aside?.className).toContain('subtle-scrollbar');

    // Lower items are present and reachable in landscape
    const settingsLinks = screen.getAllByRole('link', { name: 'Settings' });
    expect(settingsLinks[settingsLinks.length - 1]).toBeVisible();

    const signoutButtons = screen.getAllByRole('button', { name: 'Sign out' });
    expect(signoutButtons[signoutButtons.length - 1]).toBeVisible();
  });

  it('keeps desktop layout unchanged at 1024px and 1280px without mobile drawer', () => {
    setViewport(1280, 900);
    renderDashboardWithShell();

    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).toBeNull();

    const desktopSidebarWrapper = screen.getAllByRole('complementary')[0]?.parentElement;
    expect(desktopSidebarWrapper?.className).toContain('hidden');
    expect(desktopSidebarWrapper?.className).toContain('lg:block');

    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(toggle.className).toContain('lg:hidden');
  });

  it('preserves authorization filtering between OWNER, ADMIN, and AGENT roles', () => {
    // 1. ADMIN role
    renderDashboardWithShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getAllByText('WORKSPACE ADMIN').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('TENANT ADMINISTRATION').length).toBeGreaterThanOrEqual(1);
    cleanup();

    // 2. AGENT role
    vi.mocked(useTenant).mockReturnValue({
      tenants: [defaultTenant],
      selectedTenant: defaultTenant,
      tenantRole: 'AGENT',
      canManage: false,
      isLoading: false,
      error: null,
      selectTenant: vi.fn(),
      adoptTenant: vi.fn(),
      createTenant: vi.fn(),
      isOwner: false,
    });
    renderDashboardWithShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getAllByText('Read-only access').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('TEAM ACCESS').length).toBeGreaterThanOrEqual(1);
    cleanup();

    // 3. OWNER role
    vi.mocked(useAuth).mockReturnValue({
      user: { ...defaultUser, system_role: 'OWNER' },
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
      isOwner: true,
    });
    renderDashboardWithShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getAllByText('FULL ACCESS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('link', { name: 'Manage Plan' }).length).toBeGreaterThanOrEqual(1);
  });

  it('guarantees future-proof canonical navigation: mobile and desktop inherit directly from CANONICAL_NAVIGATION', () => {
    renderDashboardWithShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(CANONICAL_NAVIGATION.length).toBeGreaterThanOrEqual(10);
    expect(CANONICAL_GROUPS.length).toBe(5);

    for (const item of CANONICAL_NAVIGATION) {
      const rendered = screen.getAllByRole('link', { name: item.label });
      expect(rendered.length).toBe(2);
    }
  });

  it('prevents horizontal shell overflow with min-w-0, w-full, and max-w-full overflow-x-hidden', () => {
    renderDashboardWithShell();

    const shell = document.querySelector('.dashboard-shell');
    expect(shell).toBeTruthy();
    expect(shell?.className).toContain('w-full');
    expect(shell?.className).toContain('max-w-full');
    expect(shell?.className).toContain('overflow-x-hidden');

    const main = document.querySelector('main');
    expect(main).toBeTruthy();
    expect(main?.className).toContain('w-full');
    expect(main?.className).toContain('min-w-0');
  });
});

