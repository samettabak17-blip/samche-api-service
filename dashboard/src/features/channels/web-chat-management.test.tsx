import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WebChatManagement } from './web-chat-management';
import { tenantApi } from '../dashboard/dashboard-api';
import * as tenantContext from '../tenants/tenant-context';
import type { WebChatChannelResponse } from '../../types/api';

vi.mock('../dashboard/dashboard-api', () => ({
  tenantApi: {
    getWebChatChannel: vi.fn(),
    listAssistants: vi.fn(),
    updateWebChatChannel: vi.fn(),
    previewWebChatTheme: vi.fn(),
  },
  tenantKeys: {
    webChatChannel: (id: string) => ['tenant', id, 'channel', 'web-chat'],
    assistants: (id: string) => ['tenant', id, 'assistants'],
    channels: (id: string) => ['tenant', id, 'channels'],
  },
}));

function renderComponent({
  tenantId = 'test-tenant-123',
  isOwner = false,
  canManage = true,
  tenantRole = 'ADMIN' as const,
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  vi.spyOn(tenantContext, 'useTenant').mockReturnValue({
    canManage,
    isOwner,
    tenantRole,
    selectedTenant: { id: tenantId, name: 'Yeşil Vadi Peyzaj', status: 'active', plan_code: 'standard' },
    tenants: [],
    loading: false,
    selectTenant: vi.fn(),
  } as any);

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/${tenantId}/channels/web-chat`]}>
        <Routes>
          <Route path="/app/:tenantId/channels/web-chat" element={<WebChatManagement />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WebChatManagement Component', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders unconfigured tenant setup state smoothly without Not Found error', async () => {
    const unconfiguredPayload: WebChatChannelResponse = {
      tenant_id: 'test-tenant-123',
      configured: false,
      widget_key: '',
      channel: {
        id: null,
        channel_type: 'WEB_CHAT',
        display_name: 'Yeşil Vadi Peyzaj Web Chat',
        status: 'inactive',
      },
      assistant: { id: 'ast-1', name: 'Yeşil Vadi Rehberi', model: 'gpt-4o-mini', status: 'active' },
      integration: null,
      appearance: { brand_name: 'Yeşil Vadi Peyzaj', title: 'Destek' },
      behavior: { proactive_enabled: false },
      embed_snippet: '',
      installation: {
        widget_key: '',
        embed_snippet: '',
        status: 'unconfigured',
        guidance: ['Web Chat is not enabled yet for this tenant.'],
      },
    };

    vi.mocked(tenantApi.getWebChatChannel).mockResolvedValue(unconfiguredPayload);
    vi.mocked(tenantApi.listAssistants).mockResolvedValue([
      { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Yeşil Vadi Rehberi', model: 'gpt-4o-mini', status: 'active' },
    ]);

    renderComponent({ isOwner: true });

    expect(await screen.findByText('Web Chat Management')).toBeTruthy();
    expect(screen.getByText('Not Configured')).toBeTruthy();
    expect(screen.getByText(/Platform Super Owner Mode/i)).toBeTruthy();
    expect(screen.getByText(/Web Chat Setup/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Save & Enable Web Chat/i }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Embed & Installation/i }));
    expect(await screen.findByText('Web Chat is not yet enabled')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Go to General Setup/i })).toBeTruthy();
  });

  it('renders configured tenant state with active badge and production embed snippet', async () => {
    const configuredPayload: WebChatChannelResponse = {
      tenant_id: 'test-tenant-123',
      configured: true,
      widget_key: 'wch_live_fixture1234567890123456789012',
      channel: {
        id: 'ch-1',
        channel_type: 'WEB_CHAT',
        display_name: 'Yeşil Vadi Web Chat',
        status: 'active',
      },
      assistant: {
        id: 'ast-1',
        name: 'Yeşil Vadi Rehberi',
        model: 'gpt-4o-mini',
        status: 'active',
      },
      integration: {
        id: 'int-1',
        integration_key: 'wch_live_fixture1234567890123456789012',
        integration_type: 'WEB_CHAT',
        enabled: true,
      },
      appearance: { brand_name: 'Yeşil Vadi Peyzaj', title: 'Destek' },
      behavior: { proactive_enabled: true },
      embed_snippet: '<script src="https://samche-api-staging.onrender.com/web-chat.js" data-widget-key="wch_live_fixture1234567890123456789012"></script>',
      installation: {
        widget_key: 'wch_live_fixture1234567890123456789012',
        embed_snippet: '<script src="https://samche-api-staging.onrender.com/web-chat.js" data-widget-key="wch_live_fixture1234567890123456789012"></script>',
        status: 'active',
        guidance: ['Copy snippet'],
      },
    };

    vi.mocked(tenantApi.getWebChatChannel).mockResolvedValue(configuredPayload);
    vi.mocked(tenantApi.listAssistants).mockResolvedValue([
      { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Yeşil Vadi Rehberi', model: 'gpt-4o-mini', status: 'active' },
    ]);

    renderComponent();

    expect(await screen.findByText('Web Chat Management')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Embed & Installation/i }));
    expect(await screen.findByText('Production Embed Snippet')).toBeTruthy();
    expect(screen.getByText('wch_live_fixture1234567890123456789012')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy snippet/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Appearance & Theme/i }));
    expect(await screen.findByText('Visual Branding')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Live Preview/i }));
    expect(await screen.findByText(/Live preview rendered with active brand colors/i)).toBeTruthy();
  });
});
