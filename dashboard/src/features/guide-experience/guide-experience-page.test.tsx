import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuideExperiencePage } from './guide-experience-page';
import { tenantApi } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { ApiError } from '../../lib/api-client';

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return { ...actual, tenantApi: { ...actual.tenantApi, listAssistants: vi.fn(), listChannels: vi.fn(), listGuideExperiences: vi.fn(), listGuideDomains: vi.fn(), createGuideDomain: vi.fn(), verifyGuideDomain: vi.fn(), archiveGuideDomain: vi.fn(), createGuideExperienceDraft: vi.fn(), publishGuideExperience: vi.fn(), rollbackGuideExperience: vi.fn(), uploadGuideExperienceAsset: vi.fn() } };
});
vi.mock('../tenants/tenant-context', async (importOriginal) => ({ ...(await importOriginal<typeof import('../tenants/tenant-context')>()), useTenant: vi.fn() }));

const api = vi.mocked(tenantApi);
const tenant = vi.mocked(useTenant);
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GuideExperiencePage /></QueryClientProvider>);

beforeEach(() => {
  tenant.mockReturnValue({ tenants: [], selectedTenant: { id: 'tenant-a', name: 'Tenant A', status: 'active' }, tenantRole: 'ADMIN', canManage: true, isLoading: false, error: null, selectTenant: vi.fn(), adoptTenant: vi.fn(), createTenant: vi.fn(), isOwner: false });
  api.listAssistants.mockResolvedValue([{ id: 'assistant-a', tenant_id: 'tenant-a', name: 'Guide Assistant', status: 'active' }]);
  api.listChannels.mockResolvedValue([{ id: 'channel-a', tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_type: 'SAMCHEGUIDE', display_name: 'Public Guide', status: 'active' }]);
  api.listGuideExperiences.mockResolvedValue([]);
  api.listGuideDomains.mockResolvedValue([{ id: 'domain-a', tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a', hostname: 'guide.tenant.example', domain_mode: 'CUSTOM', status: 'PENDING', verification_record_type: 'CNAME', verification_target: 'ingress.example' }]);
});

it('shows tenant-scoped domain instructions and verifies only the selected Guide domain', async () => {
  api.verifyGuideDomain.mockResolvedValue({ id: 'domain-a', tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a', hostname: 'guide.tenant.example', status: 'ACTIVE', verification_record_type: 'CNAME', verification_target: 'ingress.example' });
  renderPage();
  expect(await screen.findByText('guide.tenant.example')).toBeVisible();
  expect(screen.getByText('DNS: CNAME → ingress.example')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  await waitFor(() => expect(api.verifyGuideDomain).toHaveBeenCalledWith('tenant-a', 'assistant-a', 'domain-a'));
});

it('creates a domain only with an assistant-owned SAMCHEGUIDE channel', async () => {
  api.createGuideDomain.mockResolvedValue({ id: 'domain-new', tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a', hostname: 'guide.customer.example', status: 'PENDING', verification_record_type: 'CNAME', verification_target: 'ingress.example' });
  renderPage();
  fireEvent.change(await screen.findByRole('combobox', { name: 'Guide domain mode' }), { target: { value: 'CUSTOM' } });
  fireEvent.change(await screen.findByRole('textbox', { name: 'Guide hostname' }), { target: { value: 'guide.customer.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add custom domain' }));
  await waitFor(() => expect(api.createGuideDomain).toHaveBeenCalledWith('tenant-a', 'assistant-a', { domain_mode: 'CUSTOM', hostname: 'guide.customer.example', channel_id: 'channel-a' }));
  expect(screen.queryByRole('combobox', { name: /provider|model|vertex/i })).not.toBeInTheDocument();
});

it('shows a bounded platform-ingress message rather than a misleading tenant action error', async () => {
  api.createGuideDomain.mockRejectedValue(new ApiError(503, 'Guide domain is unavailable.', { code: 'GUIDE_DOMAIN_INGRESS_UNAVAILABLE' }));
  renderPage();
  fireEvent.change(await screen.findByRole('combobox', { name: 'Guide domain mode' }), { target: { value: 'CUSTOM' } });
  fireEvent.change(await screen.findByRole('textbox', { name: 'Guide hostname' }), { target: { value: 'guide.customer.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add custom domain' }));
  expect(await screen.findByText('Platform domain ingress is not available yet. Contact a platform owner.')).toBeVisible();
});

it('defaults to a SamChe-managed domain and submits a slug without customer DNS fields', async () => {
  api.createGuideDomain.mockResolvedValue({ id: 'domain-managed', tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a', hostname: 'tenant-a.guide.samchecompany.com', domain_mode: 'MANAGED', status: 'PENDING', verification_record_type: 'CNAME', verification_target: 'ingress.example' });
  renderPage();
  expect(await screen.findByRole('combobox', { name: 'Guide domain mode' })).toHaveValue('MANAGED');
  fireEvent.change(screen.getByRole('textbox', { name: 'Managed Guide slug' }), { target: { value: 'tenant-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add SamChe domain' }));
  await waitFor(() => expect(api.createGuideDomain).toHaveBeenCalledWith('tenant-a', 'assistant-a', { domain_mode: 'MANAGED', slug: 'tenant-a', channel_id: 'channel-a' }));
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });
