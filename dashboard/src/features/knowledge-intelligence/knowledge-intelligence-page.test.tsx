import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tenantApi } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { KnowledgeIntelligencePage } from './knowledge-intelligence-page';

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return { ...actual, tenantApi: { ...actual.tenantApi, getKnowledgeOverview: vi.fn(), listAssistants: vi.fn() } };
});
vi.mock('../tenants/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tenants/tenant-context')>();
  return { ...actual, useTenant: vi.fn() };
});

const mockedApi = vi.mocked(tenantApi);
const mockedTenant = vi.mocked(useTenant);

function renderPage(canManage = true) {
  mockedTenant.mockReturnValue({ tenants: [], selectedTenant: undefined, tenantRole: canManage ? 'ADMIN' : 'AGENT', canManage, isLoading: false, error: null, selectTenant: vi.fn() });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/tenant-a/knowledge']}><Routes><Route path="/app/:tenantId/knowledge" element={<KnowledgeIntelligencePage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mockedApi.getKnowledgeOverview.mockResolvedValue({
    sources: { ready: 3, processing: 1, failed: 2 },
    reviewQueue: { candidates: 4, profiles: 1, recommendations: 2, configurations: 3 },
    gaps: { open: 5 },
    runtime: { activeProfile: true, activeConfigurations: 2, assistants: 4 },
  });
  mockedApi.listAssistants.mockResolvedValue([]);
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

it('keeps AGENT users read-only', async () => {
  renderPage(false);
  await screen.findByText('3 ready sources');
  expect(screen.queryByRole('button', { name: /generate|run retrieval/i })).toBeNull();
});
