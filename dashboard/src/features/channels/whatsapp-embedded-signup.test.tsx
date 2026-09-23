import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WhatsAppEmbeddedSignup } from './whatsapp-embedded-signup';
import { tenantApi } from '../dashboard/dashboard-api';
import type { Assistant, WhatsAppChannelStatusResponse, WhatsAppConfigResponse } from '../../types/api';

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return {
    ...actual,
    tenantApi: {
      ...actual.tenantApi,
      getWhatsAppStatus: vi.fn(),
      getWhatsAppConfig: vi.fn(),
      connectWhatsAppEmbeddedSignup: vi.fn(),
      disconnectWhatsApp: vi.fn(),
    },
  };
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const mockAssistants: Assistant[] = [
  { id: 'ast-1', tenant_id: 'tenant-1', name: 'Primary AI', status: 'active' },
  { id: 'ast-2', tenant_id: 'tenant-1', name: 'Draft AI', status: 'inactive' },
];

describe('WhatsAppEmbeddedSignup UI Component', () => {
  it('renders "Not connected" state with assistant selector and Connect WhatsApp button', async () => {
    vi.mocked(tenantApi.getWhatsAppStatus).mockResolvedValueOnce({
      status: 'NOT_CONNECTED',
      entitled: true,
      action_required: null,
      channel: null,
      connection: null,
      assistant: null,
    });
    vi.mocked(tenantApi.getWhatsAppConfig).mockResolvedValueOnce({
      entitled: true,
      app_id: 'mock-app-id',
      config_id: 'mock-config-id',
      graph_api_version: 'v23.0',
      state_token: 'signed-state-token',
      configured: true,
    });

    renderWithClient(
      <WhatsAppEmbeddedSignup
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    expect(await screen.findByText('WhatsApp Business AI')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('Connect WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Primary AI')).toBeInTheDocument();
  });

  it('renders "Connected" state with verified WABA details and assigned assistant', async () => {
    vi.mocked(tenantApi.getWhatsAppStatus).mockResolvedValueOnce({
      status: 'CONNECTED',
      entitled: true,
      action_required: null,
      channel: {
        id: 'ch-1',
        tenant_id: 'tenant-1',
        channel_type: 'WHATSAPP',
        display_name: 'Acme Official WhatsApp',
        external_channel_id: '15551234567',
        status: 'active',
      },
      connection: {
        waba_id: 'waba-123456789',
        phone_number_id: '15551234567',
        display_phone_number: '+1 (555) 123-4567',
        verified_name: 'Acme Support Desk',
        quality_rating: 'GREEN',
        code_verification_status: 'VERIFIED',
        onboarded_via: 'EMBEDDED_SIGNUP',
        onboarded_at: '2026-09-23T12:00:00Z',
        has_credentials: true,
      },
      assistant: {
        id: 'ast-1',
        name: 'Primary AI',
        status: 'active',
        is_active: true,
      },
    });
    vi.mocked(tenantApi.getWhatsAppConfig).mockResolvedValueOnce({
      entitled: true,
      app_id: 'mock-app-id',
      config_id: 'mock-config-id',
      graph_api_version: 'v23.0',
      state_token: 'signed-state-token',
      configured: true,
    });

    renderWithClient(
      <WhatsAppEmbeddedSignup
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Acme Support Desk')).toBeInTheDocument();
    expect(screen.getByText('+1 (555) 123-4567')).toBeInTheDocument();
    expect(screen.getByText('waba-123456789')).toBeInTheDocument();
    expect(screen.getByText('Reconnect')).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  it('renders "Action required" / plan upgrade warning when tenant is not entitled', async () => {
    vi.mocked(tenantApi.getWhatsAppStatus).mockResolvedValueOnce({
      status: 'ACTION_REQUIRED',
      entitled: false,
      action_required: 'PLAN_UPGRADE_REQUIRED',
      channel: null,
      connection: null,
      assistant: null,
    });
    vi.mocked(tenantApi.getWhatsAppConfig).mockResolvedValueOnce({
      entitled: false,
      min_plan: 'GROWTH',
      reason: 'TENANT_NOT_ENTITLED',
      message: 'WhatsApp AI is not included in your current subscription plan.',
      app_id: null,
      config_id: null,
      graph_api_version: 'v23.0',
      state_token: null,
      configured: false,
    });

    renderWithClient(
      <WhatsAppEmbeddedSignup
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    expect(await screen.findByText('Action required')).toBeInTheDocument();
    expect(
      screen.getByText('WhatsApp AI requires a Growth or higher subscription')
    ).toBeInTheDocument();
  });
});
