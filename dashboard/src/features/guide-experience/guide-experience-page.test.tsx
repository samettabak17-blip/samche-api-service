import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuideExperiencePage } from './guide-experience-page';
import { tenantApi } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { ApiError } from '../../lib/api-client';
import type { GuideExperienceData, GuideExperienceVersion } from '../../types/api';

vi.mock('../dashboard/dashboard-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dashboard/dashboard-api')>();
  return { ...actual, tenantApi: { ...actual.tenantApi, listAssistants: vi.fn(), listChannels: vi.fn(), listGuideExperiences: vi.fn(), listGuideDomains: vi.fn(), getGuidePublicationDiagnostics: vi.fn(), createGuideDomain: vi.fn(), verifyGuideDomain: vi.fn(), archiveGuideDomain: vi.fn(), createGuideExperienceDraft: vi.fn(), createRecommendedGuideExperienceDraft: vi.fn(), recommendGuideTheme: vi.fn(), publishGuideExperience: vi.fn(), previewGuideExperience: vi.fn(), rollbackGuideExperience: vi.fn(), uploadGuideExperienceAsset: vi.fn() } };
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
  api.getGuidePublicationDiagnostics.mockResolvedValue({ consistency: 'NO_CURRENT_PUBLISHED', current_published: null, public_bootstrap_version: null, versions: [] });
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

it('offers a configuration-driven three-module Guide editor without provider controls', async () => {
  renderPage();
  expect((await screen.findAllByText('Roadmap')).length).toBeGreaterThan(0);
  expect(screen.getByText('Interactive Tool / Calculator')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add roadmap step' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add tool field' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Pricing mode' })).toHaveValue('QUOTE_REQUIRED');
  expect(screen.getAllByText('AI Assistant').length).toBeGreaterThan(0);
  expect(screen.queryByRole('combobox', { name: /provider|model|vertex/i })).not.toBeInTheDocument();
});

it('offers an authorized real-runtime preview action for a private draft', async () => {
  const draft: GuideExperienceVersion = { id: 'draft-v10', tenant_id: 'tenant-a', assistant_id: 'assistant-a', version: 10, status: 'DRAFT', experience: { brand_name: 'Tenant', assistant_display_name: 'Assistant', assistant_status_label: 'Online', welcome_title: 'Welcome', welcome_message: 'Hello', input_placeholder: 'Type', launcher_label: 'Send', empty_state_copy: 'Ask', logo_url: null, avatar_url: null, favicon_url: null, theme: { primary_color: '#111111', accent_color: '#222222', background_color: '#333333', foreground_color: '#FFFFFF', surface_color: '#444444', border_color: '#555555', font_family: 'SYSTEM', corner_radius: 'MEDIUM', density: 'COMFORTABLE' }, layout: { preset: 'SERVICE', launcher_style: 'PILL', header_style: 'STANDARD', panel_style: 'CARD' }, modules: { chat: true, guide: true, calculator: true, ctas: true }, hero: { title: 'Welcome', message: 'Hello', cta_label: '' }, roadmap: { enabled: true, title: 'Roadmap', description: '', steps: [] }, interactive_tool: { enabled: true, title: 'Tool', description: '', currency: '', pricing_mode: 'QUOTE_REQUIRED', approved_pricing_source: '', result_label: 'Scope', fields: [], calculation: { base_amount: 0, terms: [] } } } };
  api.listGuideExperiences.mockResolvedValue([draft]);
  api.listGuideDomains.mockResolvedValue([{ id: 'domain-a', tenant_id: 'tenant-a', assistant_id: 'assistant-a', channel_id: 'channel-a', hostname: 'guide.tenant.example', domain_mode: 'CUSTOM', status: 'ACTIVE', verification_record_type: 'CNAME', verification_target: 'ingress.example' }]);
  api.previewGuideExperience.mockResolvedValue({ preview_path: '/?preview=opaque', hostname: 'guide.tenant.example', expires_in_seconds: 600 });
  const popup = { closed: false, location: { href: 'about:blank' } } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview draft v10' }));
  await waitFor(() => expect(api.previewGuideExperience).toHaveBeenCalledWith('tenant-a', 'assistant-a', 'draft-v10'));
  await waitFor(() => expect(popup.location.href).toBe('https://guide.tenant.example/?preview=opaque'));
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  expect(screen.getByRole('combobox', { name: 'Layout preset' })).toHaveValue('SERVICE');
  expect(screen.getByDisplayValue('Roadmap')).toBeVisible();
  expect(api.publishGuideExperience).not.toHaveBeenCalled();
  open.mockRestore();
});

it('closes a failed preview placeholder without publishing or replacing the selected draft', async () => {
  const draft: GuideExperienceVersion = { id: 'draft-v10', tenant_id: 'tenant-a', assistant_id: 'assistant-a', version: 10, status: 'DRAFT', experience: { brand_name: 'Tenant', assistant_display_name: 'Assistant', assistant_status_label: 'Online', welcome_title: 'Event planning', welcome_message: 'Tell us about your event.', input_placeholder: 'Type', launcher_label: 'Send', empty_state_copy: 'Ask', logo_url: null, avatar_url: null, favicon_url: null, theme: { primary_color: '#111111', accent_color: '#222222', background_color: '#333333', foreground_color: '#FFFFFF', surface_color: '#444444', border_color: '#555555', font_family: 'SYSTEM', corner_radius: 'MEDIUM', density: 'COMFORTABLE' }, layout: { preset: 'SERVICE', launcher_style: 'PILL', header_style: 'STANDARD', panel_style: 'CARD' }, modules: { chat: true, guide: true, calculator: true, ctas: true }, hero: { title: 'Event planning', message: 'Tell us about your event.', cta_label: '' }, roadmap: { enabled: true, title: 'Event Planning Roadmap', description: '', steps: [] }, interactive_tool: { enabled: true, title: 'Event Budget Estimator', description: '', currency: '', pricing_mode: 'QUOTE_REQUIRED', approved_pricing_source: '', result_label: 'Scope', fields: [], calculation: { base_amount: 0, terms: [] } } } };
  api.listGuideExperiences.mockResolvedValue([draft]);
  api.previewGuideExperience.mockRejectedValue(new Error('ticket unavailable'));
  const popup = { closed: false, close: vi.fn(), location: { href: 'about:blank' } } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview draft v10' }));
  expect(await screen.findByText('Private preview could not be opened. Please try again.')).toBeVisible();
  expect(popup.close).toHaveBeenCalledOnce();
  expect(screen.getByDisplayValue('Event Planning Roadmap')).toBeVisible();
  expect(screen.getByDisplayValue('Event Budget Estimator')).toBeVisible();
  expect(api.publishGuideExperience).not.toHaveBeenCalled();
  open.mockRestore();
});

it('keeps a generated sector-aware Draft selected when the versions query refreshes with a published version', async () => {
  const generic: GuideExperienceData = { brand_name: 'Tenant', assistant_display_name: 'Assistant', assistant_status_label: 'Online', welcome_title: 'Welcome', welcome_message: 'Generic', input_placeholder: 'Type', launcher_label: 'Send', empty_state_copy: 'Ask', logo_url: null, avatar_url: null, favicon_url: null, theme: { primary_color: '#111111', accent_color: '#222222', background_color: '#333333', foreground_color: '#FFFFFF', surface_color: '#444444', border_color: '#555555', font_family: 'SYSTEM', corner_radius: 'MEDIUM', density: 'COMFORTABLE' }, layout: { preset: 'COMMERCE', launcher_style: 'PILL', header_style: 'STANDARD', panel_style: 'CARD' }, modules: { chat: true, guide: true, calculator: true, ctas: true }, hero: { title: 'Welcome', message: 'Generic', cta_label: '' }, roadmap: { enabled: true, title: 'Your roadmap', description: 'Generic', steps: [{ id: 'goal', label: 'What would you like to achieve?', description: '', input_type: 'TEXT', required: true, options: [], min: null, max: null, unit: '' }] }, interactive_tool: { enabled: true, title: 'Planning snapshot', description: 'Generic', currency: '', result_label: 'Snapshot', fields: [{ id: 'budget', label: 'Indicative budget', description: '', input_type: 'NUMBER', required: false, options: [], min: 0, max: 1000, unit: '' }], calculation: { base_amount: 0, terms: [] } } };
  const published: GuideExperienceVersion = { id: 'published-v7', tenant_id: 'tenant-a', assistant_id: 'assistant-a', version: 7, status: 'PUBLISHED', experience: generic };
  const recommended: GuideExperienceVersion = { ...published, id: 'draft-v8', version: 8, status: 'DRAFT', experience: { ...generic, welcome_title: 'Plan your event with confidence', layout: { ...generic.layout, preset: 'SERVICE' }, roadmap: { ...generic.roadmap, title: 'Event Planning Roadmap', steps: [{ id: 'event_type', label: 'What type of event are you planning?', description: '', input_type: 'SELECT', required: true, options: [{ value: 'corporate', label: 'Corporate Event' }], min: null, max: null, unit: '' }, { id: 'guest_count', label: 'How many guests are you expecting?', description: '', input_type: 'NUMBER', required: true, options: [], min: 1, max: 100000, unit: 'guests' }] }, interactive_tool: { ...generic.interactive_tool, title: 'Event Budget Estimator', pricing_mode: 'QUOTE_REQUIRED', approved_pricing_source: '' }, modules: { ...generic.modules, chat: true } } };
  let values = [published];
  api.listGuideExperiences.mockImplementation(() => Promise.resolve(values));
  api.createRecommendedGuideExperienceDraft.mockImplementation(async () => { values = [recommended, published]; return { version: recommended, recommendation: { classification: { sector: 'EVENT_MANAGEMENT', capabilities: [], source: 'APPROVED_TENANT_INTELLIGENCE' }, facts_used: { active_profile: true, active_configuration: true } } } as never; });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Generate recommended draft' }));
  expect(await screen.findByDisplayValue('Event Planning Roadmap')).toBeVisible();
  expect(screen.getByDisplayValue('Event Budget Estimator')).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Pricing mode' })).toHaveValue('QUOTE_REQUIRED');
  expect(screen.getByRole('combobox', { name: 'Layout preset' })).toHaveValue('SERVICE');
  expect(screen.getByRole('checkbox', { name: 'Enable AI Assistant' })).toBeChecked();
});

it('does not mislabel a non-intelligence recommendation failure as missing active tenant intelligence', async () => {
  api.createRecommendedGuideExperienceDraft.mockRejectedValue(new ApiError(400, 'Guide experience is unavailable.', { code: 'GUIDE_EXPERIENCE_INVALID' }));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Generate recommended draft' }));
  expect(await screen.findByText('A recommendation draft could not be generated safely. Review the Guide Experience details and try again.')).toBeVisible();
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });
