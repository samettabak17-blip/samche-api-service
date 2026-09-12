import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    uploadWebChatLogo: vi.fn(),
    deleteWebChatLogo: vi.fn(),
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

const mockAppearance = {
  brand_name: 'Yeşil Vadi Peyzaj',
  title: 'Destek',
  subtitle: 'Çevrimiçi',
  logo_url: null,
  launcher_position: 'right' as const,
  launcher_icon: 'chat' as const,
  theme_mode: 'dark' as const,
  theme: {
    primary_color: '#0B5FFF',
    accent_color: '#10B981',
    surface_tint: '#111827',
    surface_glass: 'rgba(17,24,39,0.85)',
    surface_solid: '#111827',
    glow_color: '#0B5FFF22',
    text_color: '#FFFFFF',
    muted_color: '#9CA3AF',
    border_color: 'rgba(255,255,255,0.1)',
    primary_foreground: '#FFFFFF',
    accent_foreground: '#FFFFFF',
  },
};

const mockBehavior = {
  proactive_enabled: false,
  high_intent_activation: false,
  dwell_threshold_seconds: 15,
  cooldown_seconds: 300,
  language: 'tr' as const,
};

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
      assistant: { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Yeşil Vadi Rehberi', model: 'gpt-4o-mini', status: 'active' },
      integration: null,
      appearance: mockAppearance,
      behavior: mockBehavior,
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
        tenant_id: 'test-tenant-123',
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
      appearance: mockAppearance,
      behavior: { ...mockBehavior, proactive_enabled: true, high_intent_activation: true },
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

  it('visibly provides direct tenant logo management, launcher label, and supported specs in Appearance & Theme', async () => {
    const payload: WebChatChannelResponse = {
      tenant_id: 'test-tenant-123',
      configured: true,
      widget_key: 'wch_test_key_123',
      channel: { id: 'ch-1', channel_type: 'WEB_CHAT', display_name: 'Test Web Chat', status: 'active' },
      assistant: { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Test Assistant', model: 'gpt-4o-mini', status: 'active' },
      integration: { id: 'int-1', integration_key: 'wch_test_key_123', integration_type: 'WEB_CHAT', enabled: true },
      appearance: {
        ...mockAppearance,
        logo_url: null,
        launcher_label: 'Canlı Destek',
      },
      behavior: mockBehavior,
      embed_snippet: '<script></script>',
      installation: { widget_key: 'wch_test_key_123', embed_snippet: '', status: 'active', guidance: [] },
    };

    vi.mocked(tenantApi.getWebChatChannel).mockResolvedValue(payload);
    vi.mocked(tenantApi.listAssistants).mockResolvedValue([]);

    renderComponent();

    // Navigate to Appearance & Theme
    fireEvent.click(await screen.findByRole('button', { name: /Appearance & Theme/i }));

    // 1. Brand Logo section
    expect(await screen.findByTestId('brand-logo-section')).toBeTruthy();
    expect(screen.getAllByText('Brand Logo').length).toBeGreaterThan(0);

    // 2. Direct upload button
    expect(screen.getByRole('button', { name: /Upload Logo \/ Choose File/i })).toBeTruthy();

    // 3. Supported formats text
    expect(screen.getByText(/Supported: PNG \/ JPEG \/ WEBP \/ SVG · Max 2 MB/i)).toBeTruthy();

    // 4. Launcher Label control with saved tenant value
    const launcherLabelInput = screen.getByLabelText(/Launcher Label/i) as HTMLInputElement;
    expect(launcherLabelInput).toBeTruthy();
    expect(launcherLabelInput.value).toBe('Canlı Destek');

    // 5. Advanced external URL fallback is in collapsible details, NOT primary input
    expect(screen.getByText(/Advanced: Use external image URL/i)).toBeTruthy();
  });

  it('supports direct file upload, reveals thumbnail, Replace Logo, Remove Logo, and palette recommendations with Apply', async () => {
    const payload: WebChatChannelResponse = {
      tenant_id: 'test-tenant-123',
      configured: true,
      widget_key: 'wch_test_key_123',
      channel: { id: 'ch-1', channel_type: 'WEB_CHAT', display_name: 'Test Web Chat', status: 'active' },
      assistant: { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Test Assistant', model: 'gpt-4o-mini', status: 'active' },
      integration: { id: 'int-1', integration_key: 'wch_test_key_123', integration_type: 'WEB_CHAT', enabled: true },
      appearance: {
        ...mockAppearance,
        logo_url: null,
      },
      behavior: mockBehavior,
      embed_snippet: '<script></script>',
      installation: { widget_key: 'wch_test_key_123', embed_snippet: '', status: 'active', guidance: [] },
    };

    vi.mocked(tenantApi.getWebChatChannel).mockResolvedValue(payload);
    vi.mocked(tenantApi.listAssistants).mockResolvedValue([]);
    vi.mocked(tenantApi.previewWebChatTheme).mockResolvedValue({
      mode: 'dark',
      primary: '#3B82F6',
      primary_foreground: '#FFFFFF',
      accent: '#10B981',
      accent_foreground: '#FFFFFF',
      surface_tint: '#111827',
      surface_glass: 'rgba(17,24,39,0.85)',
      surface_solid: '#111827',
      glow: 'rgba(59,130,246,0.35)',
      glow_soft: 'rgba(59,130,246,0.18)',
      text: '#FFFFFF',
      muted: '#9CA3AF',
      border: 'rgba(255,255,255,0.1)',
      contrast: { primary_button: 4.8, accent_button: 4.5, text_surface: 7.2, muted_surface: 4.5 },
      is_accessible: true,
    });
    vi.mocked(tenantApi.uploadWebChatLogo).mockResolvedValue({
      asset: {
        id: 'asset-1',
        tenant_id: 'test-tenant-123',
        original_filename: 'logo.png',
        public_url: '/api/v1/public/web-chat/assets/asset-1',
        mime_type: 'image/png',
        size_bytes: 1024,
        created_at: new Date().toISOString(),
      },
      appearance: mockAppearance,
      theme: {
        primary_color: '#3B82F6',
        accent_color: '#10B981',
      },
      palette: {
        dominant: '#1E3A8A',
        primary: '#3B82F6',
        accent: '#10B981',
        candidates: ['#3B82F6', '#1E3A8A', '#10B981'],
      },
    });

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: /Appearance & Theme/i }));

    const fileInput = screen.getByLabelText('Upload logo file') as HTMLInputElement;
    const testFile = new File(['dummy logo png'], 'logo.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [testFile] } });

    // Expect uploadWebChatLogo to be called
    expect(tenantApi.uploadWebChatLogo).toHaveBeenCalledWith('test-tenant-123', testFile);

    // After upload, logo thumbnail, Replace Logo, and Remove Logo must be visible
    expect(await screen.findByAltText('Brand Logo Thumbnail')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Replace Logo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remove Logo/i })).toBeTruthy();

    // Palette recommendations card must be visible
    expect(await screen.findByTestId('logo-palette-recommendations')).toBeTruthy();
    expect(screen.getByText(/Logo-Derived Palette Recommendations/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply Recommendations/i })).toBeTruthy();
    expect(screen.getAllByText('#1E3A8A').length).toBeGreaterThan(0);

    // Click Apply Recommendations
    fireEvent.click(screen.getByRole('button', { name: /Apply Recommendations/i }));
    expect(tenantApi.previewWebChatTheme).toHaveBeenCalled();
  });

  it('persists logo thumbnail, Replace/Remove controls, and palette recommendations on page refresh', async () => {
    const persistedPayload: WebChatChannelResponse = {
      tenant_id: 'test-tenant-123',
      configured: true,
      widget_key: 'wch_test_key_123',
      channel: { id: 'ch-1', channel_type: 'WEB_CHAT', display_name: 'Test Web Chat', status: 'active' },
      assistant: { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Test Assistant', model: 'gpt-4o-mini', status: 'active' },
      integration: { id: 'int-1', integration_key: 'wch_test_key_123', integration_type: 'WEB_CHAT', enabled: true },
      appearance: {
        ...mockAppearance,
        logo_url: '/api/v1/public/web-chat/assets/asset-saved-1',
        launcher_label: 'محادثة مباشرة',
      },
      palette: {
        dominant: '#059669',
        primary: '#10B981',
        accent: '#F59E0B',
        candidates: ['#10B981', '#059669', '#F59E0B'],
      },
      behavior: mockBehavior,
      embed_snippet: '<script></script>',
      installation: { widget_key: 'wch_test_key_123', embed_snippet: '', status: 'active', guidance: [] },
    };

    vi.mocked(tenantApi.getWebChatChannel).mockResolvedValue(persistedPayload);
    vi.mocked(tenantApi.listAssistants).mockResolvedValue([]);

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: /Appearance & Theme/i }));

    // Saved logo thumbnail must be immediately present
    expect(await screen.findByAltText('Brand Logo Thumbnail')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Replace Logo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remove Logo/i })).toBeTruthy();

    // Arabic Unicode launcher label must be preserved
    const launcherInput = screen.getByLabelText(/Launcher Label/i) as HTMLInputElement;
    expect(launcherInput.value).toBe('محادثة مباشرة');

    // Palette recommendations must persist from payload without re-uploading
    expect(await screen.findByTestId('logo-palette-recommendations')).toBeTruthy();
    expect(screen.getAllByText('#059669').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Apply Recommendations/i })).toBeTruthy();
  });

  it('supports empty Launcher Label for circular icon-only launcher', async () => {
    const payloadWithEmptyLabel: WebChatChannelResponse = {
      tenant_id: 'test-tenant-123',
      configured: true,
      widget_key: 'wch_test_key_123',
      channel: { id: 'ch-1', channel_type: 'WEB_CHAT', display_name: 'Test Web Chat', status: 'active' },
      assistant: { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Test Assistant', model: 'gpt-4o-mini', status: 'active' },
      integration: { id: 'int-1', integration_key: 'wch_test_key_123', integration_type: 'WEB_CHAT', enabled: true },
      appearance: {
        ...mockAppearance,
        launcher_label: '',
      },
      behavior: mockBehavior,
      embed_snippet: '<script></script>',
      installation: { widget_key: 'wch_test_key_123', embed_snippet: '', status: 'active', guidance: [] },
    };

    vi.mocked(tenantApi.getWebChatChannel).mockResolvedValue(payloadWithEmptyLabel);
    vi.mocked(tenantApi.listAssistants).mockResolvedValue([]);

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: /Appearance & Theme/i }));

    const launcherInput = (await screen.findByLabelText(/Launcher Label/i)) as HTMLInputElement;
    expect(launcherInput.value).toBe('');
  });
  it('exposes configurable Launcher Style & Glow controls, interactive cards, sliders, and deterministic preview', async () => {
    const payload: WebChatChannelResponse = {
      tenant_id: 'test-tenant-123',
      configured: true,
      widget_key: 'wch_test_key_123',
      channel: { id: 'ch-1', channel_type: 'WEB_CHAT', display_name: 'Test Web Chat', status: 'active' },
      assistant: { id: 'ast-1', tenant_id: 'test-tenant-123', name: 'Test Assistant', model: 'gpt-4o-mini', status: 'active' },
      integration: { id: 'int-1', integration_key: 'wch_test_key_123', integration_type: 'WEB_CHAT', enabled: true },
      appearance: {
        ...mockAppearance,
        launcher_style: 'pill',
        glow_intensity: 80,
        glow_spread: 70,
        pulse_animation: 'normal',
        animation_speed: 'normal',
      },
      behavior: mockBehavior,
      embed_snippet: '<script></script>',
      installation: { widget_key: 'wch_test_key_123', embed_snippet: '', status: 'active', guidance: [] },
    };

    vi.mocked(tenantApi.getWebChatChannel).mockResolvedValue(payload);
    vi.mocked(tenantApi.listAssistants).mockResolvedValue([]);
    vi.mocked(tenantApi.updateWebChatChannel).mockResolvedValue(payload);

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: /Appearance & Theme/i }));

    // 1. Launcher Style & Glow header with NEW badge
    expect(await screen.findByText(/Launcher Style & Glow/i)).toBeTruthy();
    expect(screen.getByText('NEW')).toBeTruthy();

    // 2. All 6 style options visible
    expect(screen.getByRole('button', { name: /Pill \(Default\)/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Circular/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Minimal/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Glass/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Neon Pulse/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Custom/i })).toBeTruthy();

    // 3. Switch style to Circular
    fireEvent.click(screen.getByRole('button', { name: /Circular/i }));

    // 4. Sliders are interactive
    const intensitySlider = screen.getByDisplayValue('80') as HTMLInputElement;
    expect(intensitySlider).toBeTruthy();
    fireEvent.change(intensitySlider, { target: { value: '95' } });
    expect(screen.getByText('95%')).toBeTruthy();

    // 5. Select pulse and speed
    const pulseSelect = screen.getByDisplayValue('Smooth Pulse') as HTMLSelectElement;
    expect(pulseSelect).toBeTruthy();
    fireEvent.change(pulseSelect, { target: { value: 'strong' } });

    // 6. Deterministic preview controls (Both, Closed, Open)
    expect(screen.getByRole('button', { name: /^Both$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Closed$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Open$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Closed$/i }));
    expect(screen.getByText('Closed State Preview')).toBeTruthy();

    // 7. WCAG AA status card visible in Live Preview
    expect(screen.getByText('WCAG AA Compliant')).toBeTruthy();

    // 8. Save Appearance includes new launcher fields
    fireEvent.click(screen.getByRole('button', { name: /Save Appearance/i }));
    await waitFor(() => {
      expect(tenantApi.updateWebChatChannel).toHaveBeenCalledWith(
        'test-tenant-123',
        expect.objectContaining({
          appearance: expect.objectContaining({
            launcher_style: 'custom', // intensity slider moved it to custom
            glow_intensity: 95,
            glow_spread: 70,
            pulse_animation: 'strong',
          }),
        })
      );
    });
  });

});
