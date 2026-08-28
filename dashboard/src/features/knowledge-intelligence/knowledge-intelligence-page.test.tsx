import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tenantApi } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { KnowledgeIntelligencePage } from './knowledge-intelligence-page';

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return { ...actual, tenantApi: { ...actual.tenantApi, getKnowledgeOverview: vi.fn(), listAssistants: vi.fn(), listChannels: vi.fn(), listKnowledgeSources: vi.fn(), assignKnowledgeSource: vi.fn(), listBusinessProfiles: vi.fn(), listKnowledgeRecommendations: vi.fn(), listAssistantConfigurations: vi.fn(), updateBusinessProfile: vi.fn(), reviewBusinessProfile: vi.fn(), activateBusinessProfile: vi.fn(), rollbackBusinessProfile: vi.fn(), reviewRecommendation: vi.fn(), generateAssistantConfiguration: vi.fn(), updateAssistantConfiguration: vi.fn(), reviewAssistantConfiguration: vi.fn(), activateAssistantConfiguration: vi.fn(), rollbackAssistantConfiguration: vi.fn() } };
});
vi.mock('../tenants/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tenants/tenant-context')>();
  return { ...actual, useTenant: vi.fn() };
});

const mockedApi = vi.mocked(tenantApi);
const mockedTenant = vi.mocked(useTenant);

function renderPage(canManage = true, initialEntry = '/app/tenant-a/knowledge') {
  mockedTenant.mockReturnValue({ tenants: [], selectedTenant: undefined, tenantRole: canManage ? 'ADMIN' : 'AGENT', canManage, isLoading: false, error: null, selectTenant: vi.fn() });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initialEntry]}><Routes><Route path="/app/:tenantId/*" element={<KnowledgeIntelligencePage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mockedApi.getKnowledgeOverview.mockResolvedValue({
    sources: { ready: 3, processing: 1, failed: 2 },
    reviewQueue: { candidates: 4, profiles: 1, recommendations: 2, configurations: 3 },
    gaps: { open: 5 },
    runtime: { activeProfile: true, activeConfigurations: 2, assistants: 4 },
  });
  mockedApi.listAssistants.mockResolvedValue([]);
  mockedApi.listChannels.mockResolvedValue([]);
  mockedApi.listKnowledgeSources.mockResolvedValue([]);
  mockedApi.assignKnowledgeSource.mockResolvedValue(undefined);
  mockedApi.listBusinessProfiles.mockResolvedValue([]);
  mockedApi.listKnowledgeRecommendations.mockResolvedValue([]);
  mockedApi.listAssistantConfigurations.mockResolvedValue([]);
});

it('supports direct routed panels while preserving the legacy query route', async () => {
  mockedApi.listBusinessProfiles.mockResolvedValue([{ id: 'profile-one', profile_data: { summary: 'Real profile' }, status: 'NEEDS_REVIEW', active_version_id: null }]);
  renderPage(true, '/app/tenant-a/knowledge-base/profile');
  expect(await screen.findByText('Business Profile profile-')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Business Profile' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeVisible();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('renders the real Knowledge Intelligence overview and every lifecycle panel', async () => {
  renderPage();
  expect(await screen.findByText('3 ready sources')).toBeVisible();
  for (const name of ['Overview', 'Sources', 'Candidates', 'Knowledge Gaps', 'Business Profile', 'Configurations', 'Retrieval Test', 'Legacy Knowledge Base']) {
    expect(screen.getByRole('link', { name })).toBeVisible();
  }
  expect(mockedApi.getKnowledgeOverview).toHaveBeenCalledWith('tenant-a');
});

it('uses readable dark navigation surfaces and a distinct active state', async () => {
  renderPage();
  await screen.findByText('3 ready sources');

  const active = screen.getByRole('link', { name: 'Overview' });
  const inactive = screen.getByRole('link', { name: 'Sources' });
  const legacy = screen.getByRole('link', { name: 'Legacy Knowledge Base' });

  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active.className).toContain('bg-signal');
  expect(active.className).toContain('text-white');
  expect(inactive.className).toContain('bg-elevated');
  expect(inactive.className).toContain('text-stone-300');
  expect(inactive.className).not.toContain('bg-white');
  expect(legacy.className).toContain('bg-elevated');
  expect(legacy.className).toContain('text-stone-300');
  expect(legacy.className).not.toContain('bg-white');
});

it('keeps AGENT users read-only', async () => {
  renderPage(false);
  await screen.findByText('3 ready sources');
  expect(screen.queryByRole('button', { name: /generate|run retrieval/i })).toBeNull();
});

it('derives Assistant channel labels from real channel assignments', async () => {
  mockedApi.listAssistants.mockResolvedValue([
    { id: 'assistant-whatsapp', tenant_id: 'tenant-a', name: 'SamChe AI' },
    { id: 'assistant-guide', tenant_id: 'tenant-a', name: 'Samcheguide Runtime' },
  ]);
  mockedApi.listChannels.mockResolvedValue([
    { id: 'channel-wa', tenant_id: 'tenant-a', assistant_id: 'assistant-whatsapp', channel_type: 'WHATSAPP', display_name: 'WhatsApp', status: 'active' },
    { id: 'channel-web', tenant_id: 'tenant-a', assistant_id: 'assistant-whatsapp', channel_type: 'WEB_CHAT', display_name: 'Web Chat', status: 'active' },
    { id: 'channel-guide', tenant_id: 'tenant-a', assistant_id: 'assistant-guide', channel_type: 'SAMCHEGUIDE', display_name: 'AI Guide', status: 'active' },
  ]);

  renderPage(true, '/app/tenant-a/knowledge?tab=retrieval');

  expect(await screen.findByRole('option', { name: 'WhatsApp Chatbot • Web Chatbot' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'AI Guide' })).toBeVisible();
  expect(screen.queryByText('SamChe AI')).not.toBeInTheDocument();
  expect(screen.queryByText('Samcheguide Runtime')).not.toBeInTheDocument();
});

it('shows the same channel-aware Assistant labels when assigning a source', async () => {
  mockedApi.listAssistants.mockResolvedValue([{ id: 'assistant-whatsapp', tenant_id: 'tenant-a', name: 'SamChe AI' }]);
  mockedApi.listChannels.mockResolvedValue([{ id: 'channel-wa', tenant_id: 'tenant-a', assistant_id: 'assistant-whatsapp', channel_type: 'WHATSAPP', display_name: 'WhatsApp', status: 'active' }]);
  mockedApi.listKnowledgeSources.mockResolvedValue([{ id: 'source-a', title: 'Sales policy', source_type: 'PDF', processing_status: 'READY', indexing_status: 'READY', enabled: true }]);

  renderPage(true, '/app/tenant-a/knowledge?tab=sources');

  expect(await screen.findByRole('option', { name: 'WhatsApp Chatbot' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Assign source' })).toBeDisabled();
});
