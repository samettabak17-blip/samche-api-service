import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocument } from '../../types/api';
import { tenantApi } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { KnowledgeBasePage, KnowledgeDocumentForm } from './knowledge-base-page';

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return {
    ...actual,
    tenantApi: {
      ...actual.tenantApi,
      listKnowledgeBase: vi.fn(),
      listAssistants: vi.fn(),
      getKnowledgeDocument: vi.fn(),
      createKnowledgeDocument: vi.fn(),
      updateKnowledgeDocument: vi.fn(),
      deleteKnowledgeDocument: vi.fn(),
    },
  };
});

vi.mock('../tenants/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tenants/tenant-context')>();
  return { ...actual, useTenant: vi.fn() };
});

const document: KnowledgeDocument = {
  id: 'document-a',
  tenant_id: 'tenant-a',
  assistant_id: 'assistant-a',
  title: 'Returns policy',
  content: 'Returns are accepted within 30 days.',
  status: 'active',
};

const mockedTenantApi = vi.mocked(tenantApi);
const mockedUseTenant = vi.mocked(useTenant);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderPage({ canManage = true, route = '/app/tenant-a/knowledge-base' } = {}) {
  mockedUseTenant.mockReturnValue({
    tenants: [],
    selectedTenant: undefined,
    tenantRole: canManage ? 'ADMIN' : 'AGENT',
    canManage,
    isLoading: false,
    error: null,
    selectTenant: vi.fn(),
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/app/:tenantId/knowledge-base" element={<KnowledgeBasePage />} />
          <Route path="/app/:tenantId/knowledge-base/:documentId" element={<KnowledgeBasePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedTenantApi.listKnowledgeBase.mockResolvedValue([document]);
  mockedTenantApi.listAssistants.mockResolvedValue([
    { id: 'assistant-a', tenant_id: 'tenant-a', name: 'Support assistant' },
  ]);
  mockedTenantApi.getKnowledgeDocument.mockResolvedValue(document);
  mockedTenantApi.createKnowledgeDocument.mockResolvedValue(document);
  mockedTenantApi.updateKnowledgeDocument.mockResolvedValue(document);
  mockedTenantApi.deleteKnowledgeDocument.mockResolvedValue({ message: 'deleted' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KnowledgeDocumentForm', () => {
  it('does not render write controls for an AGENT', () => {
    render(<KnowledgeDocumentForm canManage={false} assistants={[]} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /create document|save/i })).toBeNull();
  });

  it('requires title and text content before submission', () => {
    const onSubmit = vi.fn();
    render(<KnowledgeDocumentForm canManage assistants={[]} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /create document/i }));
    expect(screen.getByText('Title and content are required.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('KnowledgeBasePage legacy behavior', () => {
  it('renders the document list and route-selected document detail', async () => {
    renderPage({ route: '/app/tenant-a/knowledge-base/document-a' });

    expect(await screen.findByRole('link', { name: /Returns policy/ })).toHaveAttribute(
      'href',
      '/app/tenant-a/knowledge-base/document-a',
    );
    expect(await screen.findAllByText('Returns are accepted within 30 days.')).toHaveLength(2);
    expect(mockedTenantApi.listKnowledgeBase).toHaveBeenCalledWith('tenant-a');
    expect(mockedTenantApi.getKnowledgeDocument).toHaveBeenCalledWith('tenant-a', 'document-a');
  });

  it('creates a trimmed document with the selected assistant and status', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Shipping  ' } });
    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: '  Ships daily.  ' } });
    fireEvent.change(screen.getByLabelText('Associated assistant'), { target: { value: 'assistant-a' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));

    await waitFor(() => expect(mockedTenantApi.createKnowledgeDocument).toHaveBeenCalledWith('tenant-a', {
      title: 'Shipping',
      content: 'Ships daily.',
      assistant_id: 'assistant-a',
      status: 'inactive',
    }));
    expect(await screen.findByText('Document created.')).toBeVisible();
  });

  it('edits the selected document through the existing mutation', async () => {
    renderPage({ route: '/app/tenant-a/knowledge-base/document-a' });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit document' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated returns' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockedTenantApi.updateKnowledgeDocument).toHaveBeenCalledWith(
      'tenant-a',
      'document-a',
      {
        title: 'Updated returns',
        content: document.content,
        assistant_id: 'assistant-a',
        status: 'active',
      },
    ));
    expect(await screen.findByText('Document updated.')).toBeVisible();
  });

  it('requires confirmation before deleting and supports cancellation', async () => {
    renderPage({ route: '/app/tenant-a/knowledge-base/document-a' });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete document' }));

    expect(screen.getByRole('dialog', { name: 'Delete document' })).toHaveTextContent(
      'Delete Returns policy? This action cannot be undone.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockedTenantApi.deleteKnowledgeDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedTenantApi.deleteKnowledgeDocument).toHaveBeenCalledWith(
      'tenant-a',
      'document-a',
    ));
    expect(await screen.findByText('Document deleted.')).toBeVisible();
  });

  it('keeps AGENT users read-only while preserving list and detail access', async () => {
    renderPage({ canManage: false, route: '/app/tenant-a/knowledge-base/document-a' });

    expect(await screen.findAllByText('Returns policy')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete document' })).toBeNull();
  });

  it('shows list and detail loading states', () => {
    mockedTenantApi.listKnowledgeBase.mockReturnValue(deferred<KnowledgeDocument[]>().promise);
    mockedTenantApi.getKnowledgeDocument.mockReturnValue(deferred<KnowledgeDocument>().promise);

    renderPage({ route: '/app/tenant-a/knowledge-base/document-a' });

    expect(screen.getAllByLabelText('Loading')).toHaveLength(3);
  });

  it('shows the list error and retries the existing query', async () => {
    mockedTenantApi.listKnowledgeBase.mockRejectedValue(new Error('Legacy list unavailable'));
    renderPage();

    expect(await screen.findByText('Unable to load workspace data')).toBeVisible();
    expect(screen.getByText('Legacy list unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockedTenantApi.listKnowledgeBase).toHaveBeenCalledTimes(2));
  });

  it('shows the existing list and detail empty states', async () => {
    mockedTenantApi.listKnowledgeBase.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No documents yet')).toBeVisible();
    expect(screen.getByText('Select a document')).toBeVisible();
  });
});
