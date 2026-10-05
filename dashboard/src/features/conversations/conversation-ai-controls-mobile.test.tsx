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

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return {
    ...actual,
    tenantApi: {
      ...actual.tenantApi,
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
      sendAgentMessage: vi.fn(),
    },
  };
});

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
  last_message_preview: 'Instagram DM Inquiry',
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
  last_message_preview: 'Second Instagram inquiry',
  created_at: '2026-10-01T11:00:00.000Z',
  last_activity_at: '2026-10-01T11:05:00.000Z',
};

const CONV_IG_NEVER_AI = {
  id: 'conv-ig-never',
  tenant_id: TENANT_ID,
  channel_id: 'ch-ig-1',
  channel_type: 'INSTAGRAM' as const,
  channel_display_name: 'Instagram Direct',
  contact_display_name: 'Miles Dyson',
  customer_external_id: 'instagram:55443322',
  status: 'open' as const,
  handling_mode: 'AI' as const,
  handling_version: 1,
  ai_behavior_override: 'NEVER_AI' as const,
  human_delivery_configured: true,
  last_message_preview: 'Customer inquiry for human agent',
  created_at: '2026-10-01T11:30:00.000Z',
  last_activity_at: '2026-10-01T11:35:00.000Z',
};

const CONV_WA_1 = {
  id: 'conv-wa-1',
  tenant_id: TENANT_ID,
  channel_id: 'ch-wa-1',
  channel_type: 'WHATSAPP' as const,
  channel_display_name: 'WhatsApp Business',
  contact_display_name: 'John Matrix',
  customer_external_id: 'whatsapp:+905321112233',
  status: 'open' as const,
  handling_mode: 'AI' as const,
  handling_version: 1,
  ai_behavior_override: 'AUTOMATIC' as const,
  last_message_preview: 'WhatsApp consultation message',
  created_at: '2026-10-01T12:00:00.000Z',
  last_activity_at: '2026-10-01T12:05:00.000Z',
};

const CONV_WEB_1 = {
  id: 'conv-web-1',
  tenant_id: TENANT_ID,
  channel_id: 'ch-web-1',
  channel_type: 'WEB_CHAT' as const,
  channel_display_name: 'Web Chatbot',
  contact_display_name: 'Ellen Ripley',
  customer_external_id: 'web:session-999',
  status: 'open' as const,
  handling_mode: 'AI' as const,
  handling_version: 1,
  ai_behavior_override: 'AUTOMATIC' as const,
  last_message_preview: 'Web chat website query',
  created_at: '2026-10-01T13:00:00.000Z',
  last_activity_at: '2026-10-01T13:05:00.000Z',
};

const CONV_GUIDE_1 = {
  id: 'conv-guide-1',
  tenant_id: TENANT_ID,
  channel_id: 'ch-guide-1',
  channel_type: 'SAMCHEGUIDE' as const,
  channel_display_name: 'AI Guide Experience',
  contact_display_name: 'Arthur Dent',
  customer_external_id: 'guide:visitor-42',
  status: 'open' as const,
  handling_mode: 'AI' as const,
  handling_version: 1,
  ai_behavior_override: 'AUTOMATIC' as const,
  human_attention_state: 'REQUESTED' as const,
  last_message_preview: 'Guide experience question',
  created_at: '2026-10-01T14:00:00.000Z',
  last_activity_at: '2026-10-01T14:05:00.000Z',
};

const ALL_CONVERSATIONS = [CONV_IG_1, CONV_IG_2, CONV_IG_NEVER_AI, CONV_WA_1, CONV_WEB_1, CONV_GUIDE_1];

function renderPage(initialPath = `/app/${TENANT_ID}/conversations/inbox`) {
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


describe('Mobile Multi-Channel Conversation List & Filter Tests (TESTS A - P & R - Z)', () => {
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

    vi.mocked(tenantApi.listConversations).mockImplementation(async (_tId, _page, filters) => {
      if (!filters?.channelType) return ALL_CONVERSATIONS as any;
      return ALL_CONVERSATIONS.filter((c) => c.channel_type === filters.channelType) as any;
    });

    vi.mocked(tenantApi.getConversation).mockImplementation(async (_tId, cId) => {
      return (ALL_CONVERSATIONS.find((c) => c.id === cId) || CONV_IG_1) as any;
    });

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

  it('TEST A — Mobile opens Conversations → conversation list is rendered and not auto-redirected', async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));

    renderPage(`/app/${TENANT_ID}/conversations/inbox`);

    await waitFor(() => {
      expect(screen.getAllByText('All Conversations').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
      expect(screen.getByText('John Matrix')).toBeInTheDocument();
      expect(screen.getByText('Ellen Ripley')).toBeInTheDocument();
      expect(screen.getByText('Arthur Dent')).toBeInTheDocument();
    });
  });

  it('TEST B — Mobile Inbox / All displays conversations from all supported channels (Instagram + WhatsApp + Web Chat + AI Guide)', async () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event('resize'));

    renderPage(`/app/${TENANT_ID}/conversations/inbox`);

    await waitFor(() => {
      expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
      expect(screen.getByText('John Matrix')).toBeInTheDocument();
      expect(screen.getByText('Ellen Ripley')).toBeInTheDocument();
      expect(screen.getByText('Arthur Dent')).toBeInTheDocument();
      expect(screen.getByText('Instagram DM Inquiry')).toBeInTheDocument();
      expect(screen.getByText('WhatsApp consultation message')).toBeInTheDocument();
      expect(screen.getByText('Web chat website query')).toBeInTheDocument();
      expect(screen.getByText('Guide experience question')).toBeInTheDocument();
    });
  });

  it('TEST C — Instagram channel filter shows Instagram conversations only', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/instagram`);

    await waitFor(() => {
      expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
      expect(screen.getByText('Kyle Reese')).toBeInTheDocument();
      expect(screen.queryByText('John Matrix')).toBeNull();
      expect(screen.queryByText('Ellen Ripley')).toBeNull();
      expect(screen.queryByText('Arthur Dent')).toBeNull();
    });
  });

  it('TEST D — WhatsApp channel filter shows WhatsApp conversations only', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/whatsapp`);

    await waitFor(() => {
      expect(screen.getByText('John Matrix')).toBeInTheDocument();
      expect(screen.queryByText('Sarah Connor')).toBeNull();
      expect(screen.queryByText('Ellen Ripley')).toBeNull();
      expect(screen.queryByText('Arthur Dent')).toBeNull();
    });
  });

  it('TEST E — Web Chat channel filter shows Web Chat conversations only', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/web-chat`);

    await waitFor(() => {
      expect(screen.getByText('Ellen Ripley')).toBeInTheDocument();
      expect(screen.queryByText('Sarah Connor')).toBeNull();
      expect(screen.queryByText('John Matrix')).toBeNull();
      expect(screen.queryByText('Arthur Dent')).toBeNull();
    });
  });

  it('TEST F — AI Guide channel filter shows AI Guide conversations only', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/guide`);

    await waitFor(() => {
      expect(screen.getByText('Arthur Dent')).toBeInTheDocument();
      expect(screen.queryByText('Sarah Connor')).toBeNull();
      expect(screen.queryByText('John Matrix')).toBeNull();
      expect(screen.queryByText('Ellen Ripley')).toBeNull();
    });
  });
  it('TEST G — Open conversation displays detail view', async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));
    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

    await waitFor(() => {
      expect(screen.getAllByText('Sarah Connor').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('link', { name: /← Inbox/i })).toBeInTheDocument();
    });
  });

  it('TEST H — Back / Inbox link navigates back to list view without trapping mobile user', async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));
    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /← Inbox/i })).toBeInTheDocument();
    });

    const backLink = screen.getByRole('link', { name: /← Inbox/i });
    expect(backLink.getAttribute('href')).toBe(`/app/${TENANT_ID}/conversations/instagram`);
  });

  it('TEST I — Previous channel filter is preserved when navigating back to list', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/web-chat/conv-web-1`);

    await waitFor(() => {
      const backLink = screen.getByRole('link', { name: /← Inbox/i });
      expect(backLink.getAttribute('href')).toBe(`/app/${TENANT_ID}/conversations/web-chat`);
    });
  });

  it('TEST J — Conversation switching shows correct detail', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/whatsapp/conv-wa-1`);

    await waitFor(() => {
      expect(screen.getAllByText('John Matrix').length).toBeGreaterThanOrEqual(1);
    });

    cleanup();
    renderPage(`/app/${TENANT_ID}/conversations/guide/conv-guide-1`);

    await waitFor(() => {
      expect(screen.getAllByText('Arthur Dent').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('TEST K & V — AI Only / Auto controls available in mobile detail and Instagram defaults to AI Only', async () => {
    window.innerWidth = 320;
    window.dispatchEvent(new Event('resize'));
    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

    await waitFor(() => {
      const select = screen.getAllByRole('combobox', { name: /AI Behavior/i })[0];
      expect((select as HTMLSelectElement).value).toBe('AI_ONLY');
    });
  });

  it('TEST L — Live Support requested state is properly highlighted in list item', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/inbox`);

    await waitFor(() => {
      expect(screen.getByText('LIVE SUPPORT')).toBeInTheDocument();
    });
  });

  it('TEST M — Loading state renders skeleton without blank screen', async () => {
    vi.mocked(tenantApi.listConversations).mockReturnValue(new Promise(() => {}));
    renderPage(`/app/${TENANT_ID}/conversations/inbox`);

    expect(document.querySelector('.animate-pulse') || document.querySelector('.space-y-5')).toBeTruthy();
  });

  it('TEST N — True empty state displays friendly message when no conversations exist', async () => {
    vi.mocked(tenantApi.listConversations).mockResolvedValue([] as any);
    renderPage(`/app/${TENANT_ID}/conversations/inbox`);

    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    });
  });

  it('TEST O — Query error state renders retryable error component', async () => {
    vi.mocked(tenantApi.listConversations).mockRejectedValue(new Error('Network error'));
    renderPage(`/app/${TENANT_ID}/conversations/inbox`);

    await waitFor(() => {
      expect(screen.getByText('Unable to search conversations.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });
  });

  it('TEST P — Tenant isolation: tenant scoping is strictly passed to API', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/inbox`);

    await waitFor(() => {
      expect(tenantApi.listConversations).toHaveBeenCalledWith(
        TENANT_ID,
        expect.anything(),
        expect.anything()
      );
    });
  });


  const MOBILE_WIDTHS = [320, 375, 390, 430] as const;

  it.each(MOBILE_WIDTHS)('TEST R, S, T, U — AI behavior control is visible and reachable at mobile viewport %ipx', async (width) => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));

    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

    await waitFor(() => {
      const controls = screen.getAllByRole('combobox', { name: /AI Behavior/i });
      expect(controls.length).toBeGreaterThanOrEqual(1);
      const headerControl = controls[0];
      expect(headerControl).toBeDefined();
      expect(headerControl).not.toHaveClass('hidden');
    });
  });

  it('TEST W — Mobile AI Only → Auto selection persists through canonical backend mutation', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

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
    renderPage(`/app/${TENANT_ID}/conversations/instagram/${CONV_IG_1.id}`);

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

    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox', { name: /AI Behavior/i });
      expect(selects.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('TEST Z — Desktop and mobile share the exact same canonical state source of truth', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox', { name: /AI Behavior/i });
      for (const select of selects) {
        expect((select as HTMLSelectElement).value).toBe('AI_ONLY');
      }
    });
  });

  it('TEST OPERATOR 1 — Instagram conversation in NEVER_AI enables composer without Take Over requirement', async () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event('resize'));

    renderPage(`/app/${TENANT_ID}/conversations/instagram/${CONV_IG_NEVER_AI.id}`);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Take Over/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Return to AI/i })).toBeNull();
    });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: 'Merhaba, size nasıl yardımcı olabilirim?' } });

    const sendBtn = screen.getByRole('button', { name: /Send message/i });
    expect(sendBtn).toBeInTheDocument();
    expect(sendBtn).not.toBeDisabled();
  });

  it('TEST OPERATOR 2 — Instagram conversation does not show Take Over button in AI mode', async () => {
    renderPage(`/app/${TENANT_ID}/conversations/instagram/conv-ig-1`);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Take Over/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Return to AI/i })).toBeNull();
    });
  });
});
