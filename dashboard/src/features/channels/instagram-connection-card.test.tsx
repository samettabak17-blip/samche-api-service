import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { InstagramConnectionCard } from './instagram-connection-card';
import { tenantApi } from '../dashboard/dashboard-api';
import type { Assistant } from '../../types/api';

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return {
    ...actual,
    tenantApi: {
      ...actual.tenantApi,
      getInstagramStatus: vi.fn(),
      configureInstagram: vi.fn(),
      disconnectInstagram: vi.fn(),
      testInstagramConnection: vi.fn(),
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

describe('InstagramConnectionCard UI Component', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders "Not connected" state with configuration form and Connect Instagram button', async () => {
    vi.mocked(tenantApi.getInstagramStatus).mockResolvedValueOnce({
      status: 'DISCONNECTED',
      connected: false,
    });

    renderWithClient(
      <InstagramConnectionCard
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    expect(await screen.findByText('Instagram Messaging / Instagram DM')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('Connect Instagram Channel')).toBeInTheDocument();
    expect(screen.getByText('Instagram Account ID')).toBeInTheDocument();
    expect(screen.getByText('Instagram Access Token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Instagram/i })).toBeInTheDocument();
  });

  it('renders "Connected" state with account username, health status, and test connection action', async () => {
    vi.mocked(tenantApi.getInstagramStatus).mockResolvedValueOnce({
      status: 'CONNECTED',
      connected: true,
      channel_id: 'ch-ig-1',
      display_name: 'SamChe Official Instagram',
      external_channel_id: '17841400012345678',
      assistant_id: 'ast-1',
      assistant_name: 'Primary AI',
      page_id: '17841400012345678',
      account_username: 'samchecompany',
      account_name: 'SamChe Official',
      has_token: true,
      reauth_required: false,
    });

    renderWithClient(
      <InstagramConnectionCard
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('@samchecompany')).toBeInTheDocument();
    expect(screen.getByText('Primary AI')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Test Connection/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disconnect/i })).toBeInTheDocument();
  });

  it('renders "Re-auth Required" banner when token is expired', async () => {
    vi.mocked(tenantApi.getInstagramStatus).mockResolvedValueOnce({
      status: 'REAUTH_REQUIRED',
      connected: false,
      channel_id: 'ch-ig-1',
      display_name: 'SamChe Instagram',
      external_channel_id: '17841400012345678',
      page_id: '17841400012345678',
      has_token: true,
      reauth_required: true,
    });

    renderWithClient(
      <InstagramConnectionCard
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    expect(await screen.findByText('Re-auth Required')).toBeInTheDocument();
    expect(screen.getByText(/Access Token Expired or Revoked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect/i })).toBeInTheDocument();
  });

  it('triggers test connection when Test Connection button is clicked', async () => {
    vi.mocked(tenantApi.getInstagramStatus).mockResolvedValueOnce({
      status: 'CONNECTED',
      connected: true,
      channel_id: 'ch-ig-1',
      display_name: 'SamChe Instagram',
      account_username: 'samche',
      has_token: true,
    });

    vi.mocked(tenantApi.testInstagramConnection).mockResolvedValueOnce({
      healthy: true,
      status: 'CONNECTED',
      account_name: 'SamChe AI',
    });

    renderWithClient(
      <InstagramConnectionCard
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    const testBtn = await screen.findByRole('button', { name: /Test Connection/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(tenantApi.testInstagramConnection).toHaveBeenCalledWith('tenant-1');
    });
  });

  it('submits form with Instagram Login contract (auth_mode, account ID, access token)', async () => {
    vi.mocked(tenantApi.getInstagramStatus).mockResolvedValueOnce({
      status: 'DISCONNECTED',
      connected: false,
    });
    vi.mocked(tenantApi.configureInstagram).mockResolvedValueOnce({
      status: 'CONNECTED',
      connected: true,
      auth_mode: 'INSTAGRAM_LOGIN',
      instagram_account_id: '17841400012345678',
      account_username: 'samcheofficial',
      has_token: true,
    });

    renderWithClient(
      <InstagramConnectionCard
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    const accountIdInput = screen.getByPlaceholderText('e.g. 17841400000000000');
    const usernameInput = screen.getByPlaceholderText('e.g. samchecompany');
    const tokenInput = screen.getByPlaceholderText('EAAB... or IGA...');
    const submitBtn = screen.getByRole('button', { name: /Connect Instagram/i });

    fireEvent.change(accountIdInput, { target: { value: '17841400012345678' } });
    fireEvent.change(usernameInput, { target: { value: 'samcheofficial' } });
    fireEvent.change(tokenInput, { target: { value: 'IGAA_test_token_123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(tenantApi.configureInstagram).toHaveBeenCalledWith('tenant-1', {
        display_name: 'Instagram',
        auth_mode: 'INSTAGRAM_LOGIN',
        activation_policy: 'MANUAL_ONLY',
        activation_triggers: [],
        instagram_account_id: '17841400012345678',
        instagram_business_account_id: '17841400012345678',
        page_id: '17841400012345678',
        account_username: 'samcheofficial',
        access_token: 'IGAA_test_token_123',
        assistant_id: 'ast-1',
        status: 'active',
      });
    });
  });

  it('configures activation policy and trigger keywords', async () => {
    vi.mocked(tenantApi.getInstagramStatus).mockResolvedValueOnce({
      status: 'DISCONNECTED',
      connected: false,
    });
    vi.mocked(tenantApi.configureInstagram).mockResolvedValueOnce({
      status: 'CONNECTED',
      connected: true,
      activation_policy: 'BUSINESS_INTENT_ONLY',
      activation_triggers: ['dubai', 'vize'],
      has_token: true,
    });

    renderWithClient(
      <InstagramConnectionCard
        tenantId="tenant-1"
        canManage={true}
        assistants={mockAssistants}
      />
    );

    const accountIdInput = screen.getByPlaceholderText('e.g. 17841400000000000');
    const tokenInput = screen.getByPlaceholderText('EAAB... or IGA...');
    const policySelect = screen.getByLabelText(/AI Activation Policy/i);
    const submitBtn = screen.getByRole('button', { name: /Connect Instagram/i });

    fireEvent.change(accountIdInput, { target: { value: '17841400012345678' } });
    fireEvent.change(tokenInput, { target: { value: 'IGAA_test_token_123' } });
    fireEvent.change(policySelect, { target: { value: 'BUSINESS_INTENT_ONLY' } });

    const triggersInput = screen.getByPlaceholderText('e.g. dubai, şirket, company, vize, visa, fiyat, randevu, bilgi');
    fireEvent.change(triggersInput, { target: { value: 'dubai, vize' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(tenantApi.configureInstagram).toHaveBeenCalledWith('tenant-1', {
        display_name: 'Instagram',
        auth_mode: 'INSTAGRAM_LOGIN',
        activation_policy: 'BUSINESS_INTENT_ONLY',
        activation_triggers: ['dubai', 'vize'],
        instagram_account_id: '17841400012345678',
        instagram_business_account_id: '17841400012345678',
        page_id: '17841400012345678',
        account_username: undefined,
        access_token: 'IGAA_test_token_123',
        assistant_id: 'ast-1',
        status: 'active',
      });
    });
  });
});
