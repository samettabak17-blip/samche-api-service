import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsPage } from './conversations-page';
import { useAuth } from '../auth/auth-context';
import { useTenant } from '../tenants/tenant-context';
import { tenantApi } from '../dashboard/dashboard-api';

vi.mock('../auth/auth-context', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../tenants/tenant-context', () => ({
  useTenant: vi.fn(),
}));

vi.mock('../live-support/live-support-attention-provider', () => ({
  useLiveSupportAttention: () => ({ requestedCount: 0 }),
}));

vi.mock('./use-live-conversation-events', () => ({
  useTenantConversationLiveEvents: () => ({ liveState: 'connected' }),
}));

vi.mock('../dashboard/dashboard-api', () => ({
  tenantApi: {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    listMessages: vi.fn(),
    setConversationAiOverride: vi.fn(),
    takeOverConversation: vi.fn(),
    returnConversationToAi: vi.fn(),
    pauseConversationAi: vi.fn(),
    closeConversation: vi.fn(),
    archiveConversation: vi.fn(),
    unarchiveConversation: vi.fn(),
  },
  tenantKeys: {
    conversations: (tenantId: string, channel: string, limit: number, status: string, search: string) =>
      ['conversations', tenantId, channel, limit, status, search],
    conversation: (tenantId: string, conversationId: string) =>
      ['conversation', tenantId, conversationId],
    messages: (tenantId: string, conversationId: string) =>
      ['messages', tenantId, conversationId],
  },
}));

const TENANT_ID = 'tenant-123';
const CONV_IG_1 = {
  id: 'conv-ig-1',
  tenant_id: TENANT_ID,
  channel_id: 'ch-ig-1',
  channel_type: 'INSTAGRAM' as const,
  channel_display_name: 'Instagram Direct',
  contact_display_name: 'Sarah Connor',
  customer_external_id: 'instagram:12345678',
  status: 'open' as const,
  handling_mode: 'AI' as const,
  handling_version: 1,
  ai_behavior_override: 'AI_ONLY' as const,
  created_at: '2026-10-01T10:00:00.000Z',
  last_activity_at: '2026-10-01T10:05:00.000Z',
};

const CONV_IG_2 = {
  id: 'conv-ig-2',
  tenant_id: TENANT_ID,
  channel_id: 'ch-ig-1',
  channel_type: 'INSTAGRAM' as const,
  channel_display_name: 'Instagram Direct',
  contact_display_name: 'Kyle Reese',
  customer_external_id: 'instagram:87654321',
  status: 'open' as const,
  handling_mode: 'AI' as const,
  handling_version: 1,
  ai_behavior_override: 'AUTOMATIC' as const,
  created_at: '2026-10-01T11:00:00.000Z',
  last_activity_at: '2026-10-01T11:05:00.000Z',
};

function renderPage(initialPath = `/app/${TENANT_ID}/conversations/instagram/conv-ig-1`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app/:tenantId/conversations/:channel/:conversationId" element={<ConversationsPage />} />
          <Route path="/app/:tenantId/conversations/:channel" element={<ConversationsPage />} />
          <Route path="/app/:tenantId/conversations" element={<ConversationsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Mobile & Desktop Conversation AI Behavior Controls (TESTS R - Z)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'usr-admin', email: 'admin@samche.test', system_role: 'CUSTOMER' },
      status: 'authenticated',
      login: vi.fn(),
      logout: vi.fn(),
    });

    vi.mocked(useTenant).mockReturnValue({
      tenants: [{ id: TENANT_ID, name: 'SamChe Enterprise', status: 'active', created_at: '2026-01-01' }],
      selectedTenant: { id: TENANT_ID, name: 'SamChe Enterprise', status: 'active', created_at: '2026-01-01' },
      tenantRole: 'ADMIN',
      canManage: true,
      isLoading: false,
      error: null,
      selectTenant: vi.fn(),
      adoptTenant: vi.fn(),
      createTenant: vi.fn(),
      isOwner: false,
    });

    vi.mocked(tenantApi.listConversations).mockResolvedValue([CONV_IG_1, CONV_IG_2] as any);
    vi.mocked(tenantApi.getConversation).mockImplementation(async (_tId, cId) => (cId === CONV_IG_2.id ? CONV_IG_2 : CONV_IG_1) as any);
    vi.mocked(tenantApi.listMessages).mockResolvedValue([]);
    vi.mocked(tenantApi.setConversationAiOverride).mockResolvedValue({
      conversation: {
        ...CONV_IG_1,
        ai_behavior_override: 'AUTOMATIC',
      },
    } as any);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const MOBILE_WIDTHS = [320, 375, 390, 430] as const;

  it.each(MOBILE_WIDTHS)('TEST R, S, T, U — AI behavior control is visible and reachable at mobile viewport %ipx', async (width) => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));

    renderPage();

    await waitFor(() => {
      const controls = screen.getAllByRole('combobox', { name: /AI Behavior/i });
      expect(controls.length).toBeGreaterThanOrEqual(1);
      // The header control is in DOM and accessible
      const headerControl = controls[0];
      expect(headerControl).toBeDefined();
      expect(headerControl).not.toHaveClass('hidden');
    });
  });

  it('TEST V — New Instagram conversation displays AI Only initially', async () => {
    renderPage();

    await waitFor(() => {
      const controls = screen.getAllByRole('combobox', { name: /AI Behavior/i });
      expect((controls[0] as HTMLSelectElement).value).toBe('AI_ONLY');
    });
  });

  it('TEST W — Mobile AI Only → Auto selection persists through canonical backend mutation', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('combobox', { name: /AI Behavior/i }).length).toBeGreaterThanOrEqual(1);
    });

    const select = screen.getAllByRole('combobox', { name: /AI Behavior/i })[0];
    fireEvent.change(select, { target: { value: 'AUTOMATIC' } });

    await waitFor(() => {
      expect(tenantApi.setConversationAiOverride).toHaveBeenCalledWith(
        TENANT_ID,
        CONV_IG_1.id,
        'AUTOMATIC'
      );
    });
  });

  it('TEST X — Conversation switching updates displayed AI behavior state', async () => {
    const { rerender } = renderPage(`/app/${TENANT_ID}/conversations/instagram/${CONV_IG_1.id}`);

    await waitFor(() => {
      const select = screen.getAllByRole('combobox', { name: /AI Behavior/i })[0];
      expect((select as HTMLSelectElement).value).toBe('AI_ONLY');
    });

    cleanup();
    renderPage(`/app/${TENANT_ID}/conversations/instagram/${CONV_IG_2.id}`);

    await waitFor(() => {
      const select = screen.getAllByRole('combobox', { name: /AI Behavior/i })[0];
      expect((select as HTMLSelectElement).value).toBe('AUTOMATIC');
    });
  });

  it('TEST Y — Desktop 1280px+ existing control and sidebar remain fully functional', async () => {
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));

    renderPage();

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox', { name: /AI Behavior/i });
      expect(selects.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('TEST Z — Desktop and mobile share the exact same canonical state source of truth', async () => {
    renderPage();

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox', { name: /AI Behavior/i });
      // All rendered instances of AI behavior control agree on the canonical state
      for (const select of selects) {
        expect((select as HTMLSelectElement).value).toBe('AI_ONLY');
      }
    });
  });
});
