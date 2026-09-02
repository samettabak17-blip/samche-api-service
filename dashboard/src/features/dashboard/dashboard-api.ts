import { apiClient } from '../../lib/api-client';
import type { AgentMessageResponse, HumanAttentionSummary, DashboardOverview, Assistant, Conversation, ConversationAuditEvent, ConversationMessage, ConversationOperationResponse, CrmContact, CrmContactList, CrmDeal, CrmDealList, CrmLead, CrmLeadList, CrmOverviewMetrics, CrmPipelineStage, CrmPipelineSummary, KnowledgeDocument, KnowledgeOverview, KnowledgeSource, KnowledgeCandidate, KnowledgeCandidateEvidence, KnowledgeGap, KnowledgeGapSignal, BusinessIdentity, BusinessIdentityScopeAnalysis, BusinessProfileGenerationResult, BusinessProfileVersion, KnowledgeRecommendation, AssistantConfigurationVersion, AssistantRecommendationGenerationJob, ConfigurationGenerationResult, KnowledgeRetrievalPreview, TeamMember, TenantChannel, Tenant, TenantRole } from '../../types/api';

const tenantRoot = (tenantId: string) => `/api/v1/tenants/${tenantId}`;
type CustomerDirectoryUser = Pick<TeamMember, 'id' | 'email' | 'system_role'>;
export interface CompanyInvitationPayload {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  plan_code: 'STARTER' | 'GROWTH' | 'BUSINESS' | 'ENTERPRISE';
}

export interface CompanyOnboardingResponse {
  onboarding: {
    tenant: { id: string; name: string };
    onboarding_status: string;
    invitation?: { id: string; status: string; expires_at: string };
  };
}

export interface InvitationDeliveryStatus {
  id: string;
  status: 'PENDING' | 'CONSUMED' | 'REVOKED' | 'EXPIRED' | string;
  tenant_role: 'ADMIN' | 'AGENT';
  expires_at: string;
  created_at: string;
  delivery_status: 'PENDING_DELIVERY' | 'SENDING' | 'SENT' | 'DELIVERY_FAILED' | 'CANCELLED' | null;
  delivery_code: string | null;
  attempt_count: number | null;
}

export interface InvitationValidation {
  status: 'VALID' | 'INVALID' | 'EXPIRED' | 'USED' | 'REVOKED' | string;
  company_name?: string;
  email?: string;
}

export const onboardingApi = {
  createCompanyInvitation: (payload: CompanyInvitationPayload, idempotencyKey: string) => apiClient.post<CompanyOnboardingResponse>('/api/v1/tenants/onboard', payload, { headers: { 'Idempotency-Key': idempotencyKey } }),
  listInvitationStatuses: (tenantId: string) => apiClient.get<InvitationDeliveryStatus[]>(`${tenantRoot(tenantId)}/invitations`),
  validateInvitation: (token: string) => apiClient.post<InvitationValidation>('/api/v1/auth/invitations/validate', { token }),
  acceptInvitation: (payload: { token: string; password: string; confirm_password: string }) => apiClient.post<{ status: string }>('/api/v1/auth/invitations/accept', payload),
  resendInvitation: (tenantId: string, invitationId: string) => apiClient.post<{ invitation: { id: string; status: string; expires_at: string } }>(`${tenantRoot(tenantId)}/invitations/${invitationId}/resend`, {}),
  revokeInvitation: (tenantId: string, invitationId: string) => apiClient.post<{ status: 'REVOKED' }>(`${tenantRoot(tenantId)}/invitations/${invitationId}/revoke`, {}),
  requestPasswordReset: (email: string) => apiClient.post<{ status: string }>('/api/v1/auth/forgot-password', { email }),
  validatePasswordReset: (token: string) => apiClient.post<{ status: string; email?: string }>('/api/v1/auth/password-resets/validate', { token }),
  consumePasswordReset: (payload: { token: string; password: string; confirm_password: string }) => apiClient.post<{ status: string }>('/api/v1/auth/password-resets/consume', payload),
  changePassword: (payload: { current_password: string; new_password: string; confirm_password: string }) => apiClient.post<{ status: string }>('/api/v1/auth/change-password', payload),
};

export const tenantKeys = {
  assistants: (tenantId: string) => ['tenant', tenantId, 'assistants'] as const,
  assistant: (tenantId: string, assistantId: string) => ['tenant', tenantId, 'assistant', assistantId] as const,
  channels: (tenantId: string) => ['tenant', tenantId, 'channels'] as const,
  channel: (tenantId: string, channelId: string) => ['tenant', tenantId, 'channel', channelId] as const,
  knowledgeBase: (tenantId: string) => ['tenant', tenantId, 'knowledge-base'] as const,
  knowledgeDocument: (tenantId: string, documentId: string) => ['tenant', tenantId, 'knowledge-document', documentId] as const,
  team: (tenantId: string) => ['tenant', tenantId, 'team'] as const,
  conversations: (tenantId: string, limit: number, offset: number) => ['tenant', tenantId, 'conversations', limit, offset] as const,
  humanAttention: (tenantId: string) => ['tenant', tenantId, 'human-attention'] as const,
  conversation: (tenantId: string, conversationId: string) => ['tenant', tenantId, 'conversation', conversationId] as const,
  messages: (tenantId: string, conversationId: string, limit: number, offset: number) => ['tenant', tenantId, 'conversation', conversationId, 'messages', limit, offset] as const,
  conversationEvents: (tenantId: string, conversationId: string) => ['tenant', tenantId, 'conversation', conversationId, 'events'] as const,
  leads: (tenantId: string, filters: string) => ['tenant', tenantId, 'leads', filters] as const,
  lead: (tenantId: string, leadId: string) => ['tenant', tenantId, 'lead', leadId] as const,
  pipelines: (tenantId: string) => ['tenant', tenantId, 'pipelines'] as const,
  pipelineSummary: (tenantId: string) => ['tenant', tenantId, 'pipeline-summary'] as const,
  contacts: (tenantId: string, filters: string) => ['tenant', tenantId, 'contacts', filters] as const,
  contact: (tenantId: string, contactId: string) => ['tenant', tenantId, 'contact', contactId] as const,
  deals: (tenantId: string, filters: string) => ['tenant', tenantId, 'deals', filters] as const,
  deal: (tenantId: string, dealId: string) => ['tenant', tenantId, 'deal', dealId] as const,
  crmOverview: (tenantId: string) => ['tenant', tenantId, 'crm-overview'] as const,
  dashboardOverview: (tenantId: string, startDate: string, endDate: string) => ['tenant', tenantId, 'dashboard-overview', startDate, endDate] as const,
  knowledgeOverview: (tenantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'overview'] as const,
  knowledgeSources: (tenantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'sources'] as const,
  knowledgeCandidates: (tenantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'candidates'] as const,
  knowledgeGaps: (tenantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'gaps'] as const,
  businessProfiles: (tenantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'profiles'] as const,
  businessIdentities: (tenantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'business-identities'] as const,
  knowledgeRecommendations: (tenantId: string, assistantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'recommendations', assistantId] as const,
  assistantConfigurations: (tenantId: string, assistantId: string) => ['tenant', tenantId, 'knowledge-intelligence', 'configurations', assistantId] as const,
};
export interface LeadFilters { limit: number; offset: number; temperature?: string; stage?: string; source?: string; assigned_user_id?: string; conversation_id?: string; }
export interface DealFilters { limit: number; offset: number; stage?: string; contact_id?: string; owner_user_id?: string; status?: string; source?: string; include_archived?: boolean; }
export interface DealPayload { contact_id: string; lead_id?: string | null; title: string; pipeline_stage_id?: string; value?: number | null; currency?: string | null; probability?: number | null; expected_close_date?: string | null; owner_user_id?: string | null; source?: string | null; notes?: string | null; }
const leadQuery = (filters: LeadFilters) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
const dealQuery = (filters: DealFilters) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();

export const tenantApi = {
  listPlans: () => apiClient.get<{ plans: Array<{ code: 'STARTER' | 'GROWTH' | 'BUSINESS' | 'ENTERPRISE'; display_name: string; customer_subtitle: string; rank: number }> }>('/api/v1/tenants/plans').then((value) => value.plans),
  getTenantPlan: (tenantId: string) => apiClient.get<{ plan: { plan_code: string; display_name: string; customer_subtitle: string; rank: number; pending_request?: { requested_plan_code: string } | null } }>(`${tenantRoot(tenantId)}/plan`).then((value) => value.plan),
  changeTenantPlanAsOwner: (tenantId: string, planCode: 'STARTER' | 'GROWTH' | 'BUSINESS' | 'ENTERPRISE') => apiClient.put<{ plan: { plan_code: string; display_name: string; customer_subtitle: string; rank: number } }>(`${tenantRoot(tenantId)}/plan`, { plan_code: planCode }).then((value) => value.plan),
  requestPlanUpgrade: (tenantId: string, requestedPlanCode: string) => apiClient.post(`${tenantRoot(tenantId)}/plan-upgrade-requests`, { requested_plan_code: requestedPlanCode }),
  listPlanUpgradeRequests: () => apiClient.get<{ requests: Array<{ id: string; tenant_name: string; current_plan_code: string; requested_plan_code: string; requested_by_email: string; status: string; created_at: string }> }>('/api/v1/tenants/plan-upgrade-requests').then((value) => value.requests),
  listPlanUpgradeNotifications: () => apiClient.get<{ notifications: Array<{ id: string; request_id: string; title: string; tenant_name: string; current_plan_code: string; requested_plan_code: string; requested_by_email: string; status: 'PENDING' | 'READ'; created_at: string }> }>('/api/v1/tenants/plan-upgrade-notifications').then((value) => value.notifications),
  markPlanUpgradeNotificationRead: (notificationId: string) => apiClient.post(`/api/v1/tenants/plan-upgrade-notifications/${notificationId}/read`, {}),
  resolvePlanUpgradeRequest: (requestId: string, decision: 'approve' | 'reject') => apiClient.post(`/api/v1/tenants/plan-upgrade-requests/${requestId}/${decision}`, {}),
  listTenants: () => apiClient.get<Tenant[]>('/api/v1/tenants'),
  createTenant: (name: string) => apiClient.post<Tenant>('/api/v1/tenants', { name }),
  assignTenantUser: (tenantId: string, userId: string, tenantRole: Extract<TenantRole, 'ADMIN' | 'AGENT'>) => apiClient.post(`${tenantRoot(tenantId)}/users`, { user_id: userId, tenant_role: tenantRole }),
  listCustomerUsers: (search = '') => apiClient.get<CustomerDirectoryUser[]>(`/api/v1/tenants/users?search=${encodeURIComponent(search)}`),
  listAssistants: (tenantId: string) => apiClient.get<Assistant[]>(`${tenantRoot(tenantId)}/assistants`),
  getAssistant: (tenantId: string, assistantId: string) => apiClient.get<Assistant>(`${tenantRoot(tenantId)}/assistants/${assistantId}`),
  createAssistant: (tenantId: string, body: Pick<Assistant, 'name'> & Partial<Pick<Assistant, 'model' | 'system_prompt' | 'status'>>) => apiClient.post<Assistant>(`${tenantRoot(tenantId)}/assistants`, body),
  updateAssistant: (tenantId: string, assistantId: string, body: Partial<Pick<Assistant, 'name' | 'model' | 'system_prompt' | 'status'>>) => apiClient.put<Assistant>(`${tenantRoot(tenantId)}/assistants/${assistantId}`, body),
  deleteAssistant: (tenantId: string, assistantId: string) => apiClient.delete<{ message: string }>(`${tenantRoot(tenantId)}/assistants/${assistantId}`),
  listChannels: (tenantId: string) => apiClient.get<TenantChannel[]>(`${tenantRoot(tenantId)}/channels`),
  getChannel: (tenantId: string, channelId: string) => apiClient.get<TenantChannel>(`${tenantRoot(tenantId)}/channels/${channelId}`),
  createChannel: (tenantId: string, body: Omit<TenantChannel, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => apiClient.post<TenantChannel>(`${tenantRoot(tenantId)}/channels`, body),
  updateChannel: (tenantId: string, channelId: string, body: Partial<Omit<TenantChannel, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>) => apiClient.put<TenantChannel>(`${tenantRoot(tenantId)}/channels/${channelId}`, body),
  deleteChannel: (tenantId: string, channelId: string) => apiClient.delete<{ message: string }>(`${tenantRoot(tenantId)}/channels/${channelId}`),
  listKnowledgeBase: (tenantId: string) => apiClient.get<KnowledgeDocument[]>(`${tenantRoot(tenantId)}/knowledge-base`),
  getKnowledgeDocument: (tenantId: string, documentId: string) => apiClient.get<KnowledgeDocument>(`${tenantRoot(tenantId)}/knowledge-base/${documentId}`),
  createKnowledgeDocument: (tenantId: string, body: Omit<KnowledgeDocument, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => apiClient.post<KnowledgeDocument>(`${tenantRoot(tenantId)}/knowledge-base`, body),
  updateKnowledgeDocument: (tenantId: string, documentId: string, body: Partial<Omit<KnowledgeDocument, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>) => apiClient.put<KnowledgeDocument>(`${tenantRoot(tenantId)}/knowledge-base/${documentId}`, body),
  deleteKnowledgeDocument: (tenantId: string, documentId: string) => apiClient.delete<{ message: string }>(`${tenantRoot(tenantId)}/knowledge-base/${documentId}`),
  getKnowledgeOverview: (tenantId: string) => apiClient.get<{ overview: KnowledgeOverview }>(`${tenantRoot(tenantId)}/knowledge-intelligence/overview`).then((value) => value.overview),
  listKnowledgeSources: (tenantId: string) => apiClient.get<{ sources: KnowledgeSource[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources`).then((value) => value.sources),
  getKnowledgeSource: (tenantId: string, sourceId: string) => apiClient.get<{ source: KnowledgeSource }>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}`).then((value) => value.source),
  uploadKnowledgeSource: (tenantId: string, file: File, title: string, assistantIds: string[] = []) => { const form = new FormData(); form.set('file', file); if (title.trim()) form.set('title', title.trim()); form.set('assistant_ids', JSON.stringify(assistantIds)); return apiClient.postForm<{ source: KnowledgeSource }>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/upload`, form).then((value) => value.source); },
  createManualKnowledgeSource: (tenantId: string, title: string, content: string, assistantIds: string[] = []) => apiClient.post<{ source: KnowledgeSource }>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/manual`, { title, content, assistant_ids: assistantIds }).then((value) => value.source),
  assignKnowledgeSource: (tenantId: string, sourceId: string, assistantId: string) => apiClient.post<void>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}/assignments`, { assistant_id: assistantId }),
  unassignKnowledgeSource: (tenantId: string, sourceId: string, assistantId: string) => apiClient.delete<void>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}/assignments/${assistantId}`),
  assignKnowledgeSourceBusinessIdentity: (tenantId: string, sourceId: string, businessIdentityId: string) => apiClient.put<{ assignment: { source_id: string; business_identity: BusinessIdentity; changed: boolean } }>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}/business-identity`, { business_identity_id: businessIdentityId, confirmed: true }).then((value) => value.assignment),
  reindexKnowledgeSource: (tenantId: string, sourceId: string) => apiClient.post(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}/reindex`, {}),
  generateImageKnowledgeCandidates: (tenantId: string, sourceId: string, payload: { assistantId?: string | null; extractionHash?: string | null }) => apiClient.post<{ job: import('../../types/api').ImageSemanticGenerationJob } | { candidates: KnowledgeCandidate[]; reused: boolean; warnings?: string[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}/candidates/generate`, { assistant_id: payload.assistantId ?? null, extraction_hash: payload.extractionHash ?? undefined, candidate_type: 'POLICY' }),
  getImageKnowledgeGenerationJob: (tenantId: string, sourceId: string) => apiClient.get<{ job: import('../../types/api').ImageSemanticGenerationJob | null }>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}/candidates/generation`).then((value) => value.job),
  archiveKnowledgeSource: (tenantId: string, sourceId: string) => apiClient.post<void>(`${tenantRoot(tenantId)}/knowledge-intelligence/sources/${sourceId}/archive`, {}),
  listKnowledgeCandidates: (tenantId: string) => apiClient.get<{ candidates: KnowledgeCandidate[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/candidates`).then((value) => value.candidates),
  getKnowledgeCandidateEvidence: (tenantId: string, candidateId: string) => apiClient.get<{ evidence: KnowledgeCandidateEvidence[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/candidates/${candidateId}/evidence`).then((value) => value.evidence),
  approveKnowledgeCandidate: (tenantId: string, candidateId: string) => apiClient.post(`${tenantRoot(tenantId)}/knowledge-intelligence/candidates/${candidateId}/approve`, {}),
  rejectKnowledgeCandidate: (tenantId: string, candidateId: string) => apiClient.post<void>(`${tenantRoot(tenantId)}/knowledge-intelligence/candidates/${candidateId}/reject`, {}),
  listKnowledgeGaps: (tenantId: string) => apiClient.get<{ gaps: KnowledgeGap[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/gaps`).then((value) => value.gaps),
  getKnowledgeGapSignals: (tenantId: string, gapId: string) => apiClient.get<{ signals: KnowledgeGapSignal[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/gaps/${gapId}/signals`).then((value) => value.signals),
  createCandidateFromKnowledgeGap: (tenantId: string, gapId: string, title: string, content: string) => apiClient.post(`${tenantRoot(tenantId)}/knowledge-intelligence/gaps/${gapId}/candidate`, { title, content }),
  updateKnowledgeGapStatus: (tenantId: string, gapId: string, action: 'resolve' | 'dismiss' | 'reopen') => apiClient.post(`${tenantRoot(tenantId)}/knowledge-intelligence/gaps/${gapId}/${action}`, {}),
  listBusinessProfiles: (tenantId: string) => apiClient.get<{ profiles: BusinessProfileVersion[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/profiles`).then((value) => value.profiles),
  listBusinessIdentities: (tenantId: string) => apiClient.get<{ business_identities: BusinessIdentity[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/business-identities`).then((value) => value.business_identities),
  createBusinessIdentity: (tenantId: string, displayName: string) => apiClient.post<{ business_identity: BusinessIdentity }>(`${tenantRoot(tenantId)}/knowledge-intelligence/business-identities`, { display_name: displayName }).then((value) => value.business_identity),
  generateBusinessProfile: (tenantId: string, businessIdentityId: string, sourceIds: string[]) => apiClient.post<BusinessProfileGenerationResult>(`${tenantRoot(tenantId)}/knowledge-intelligence/profiles/generate`, { business_identity_id: businessIdentityId, source_ids: sourceIds }),
  analyzeBusinessProfileScope: (tenantId: string, businessIdentityId: string, sourceIds: string[]) => apiClient.post<{ analysis: BusinessIdentityScopeAnalysis }>(`${tenantRoot(tenantId)}/knowledge-intelligence/profiles/analyze`, { business_identity_id: businessIdentityId, source_ids: sourceIds }).then((value) => value.analysis),
  updateBusinessProfile: (tenantId: string, versionId: string, profileData: Record<string, unknown>) => apiClient.put<{ profile: BusinessProfileVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/profiles/${versionId}`, { profile_data: profileData }).then((value) => value.profile),
  reviewBusinessProfile: (tenantId: string, versionId: string, decision: 'approve' | 'reject') => apiClient.post<{ profile: BusinessProfileVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/profiles/${versionId}/${decision}`, {}).then((value) => value.profile),
  activateBusinessProfile: (tenantId: string, versionId: string) => apiClient.post<{ profile: BusinessProfileVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/profiles/${versionId}/activate`, {}).then((value) => value.profile),
  rollbackBusinessProfile: (tenantId: string, versionId: string) => apiClient.post<{ profile: BusinessProfileVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/profiles/${versionId}/rollback`, {}).then((value) => value.profile),
  listKnowledgeRecommendations: (tenantId: string, assistantId: string) => apiClient.get<{ recommendations: KnowledgeRecommendation[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/recommendations`).then((value) => value.recommendations),
  generateKnowledgeRecommendation: (tenantId: string, assistantId: string, businessProfileVersionId: string) => apiClient.post<{ job: AssistantRecommendationGenerationJob; reused: boolean }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/recommendations/generate`, { business_profile_version_id: businessProfileVersionId }),
  getKnowledgeRecommendationGenerationJob: (tenantId: string, assistantId: string, jobId: string) => apiClient.get<{ job: AssistantRecommendationGenerationJob }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/recommendation-generation-jobs/${jobId}`).then((value) => value.job),
  listAssistantConfigurations: (tenantId: string, assistantId: string) => apiClient.get<{ configurations: AssistantConfigurationVersion[] }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/configurations`).then((value) => value.configurations),
  reviewRecommendation: (tenantId: string, assistantId: string, recommendationId: string, decision: 'approve' | 'reject') => apiClient.post(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/recommendations/${recommendationId}/${decision}`, {}),
  generateAssistantConfiguration: (tenantId: string, assistantId: string, recommendationId: string) => apiClient.post<ConfigurationGenerationResult>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/configurations/generate`, { recommendation_id: recommendationId }),
  updateAssistantConfiguration: (tenantId: string, assistantId: string, versionId: string, configurationData: Record<string, unknown>) => apiClient.put<{ configuration: AssistantConfigurationVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/configurations/${versionId}`, { configuration_data: configurationData }).then((value) => value.configuration),
  reviewAssistantConfiguration: (tenantId: string, assistantId: string, versionId: string, decision: 'approve' | 'reject') => apiClient.post<{ configuration: AssistantConfigurationVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/configurations/${versionId}/${decision}`, {}).then((value) => value.configuration),
  activateAssistantConfiguration: (tenantId: string, assistantId: string, versionId: string) => apiClient.post<{ configuration: AssistantConfigurationVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/configurations/${versionId}/activate`, {}).then((value) => value.configuration),
  rollbackAssistantConfiguration: (tenantId: string, assistantId: string, versionId: string) => apiClient.post<{ configuration: AssistantConfigurationVersion }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/configurations/${versionId}/rollback`, {}).then((value) => value.configuration),
  previewKnowledgeRetrieval: (tenantId: string, assistantId: string, query: string) => apiClient.post<{ preview: KnowledgeRetrievalPreview }>(`${tenantRoot(tenantId)}/knowledge-intelligence/assistants/${assistantId}/retrieval-preview`, { query }).then((value) => value.preview),
  listTeam: (tenantId: string) => apiClient.get<TeamMember[]>(`${tenantRoot(tenantId)}/team`),
  listConversations: (tenantId: string, page: { limit: number; offset: number }, filters: { channelType?: string; search?: string; status?: string } = {}) => {
    const params = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
    if (filters.channelType) params.set('channel_type', filters.channelType);
    if (filters.search?.trim()) params.set('search', filters.search.trim());
    if (filters.status) params.set('status', filters.status);
    return apiClient.get<Conversation[]>(`${tenantRoot(tenantId)}/conversations?${params.toString()}`);
  },
  getHumanAttentionSummary: (tenantId: string) => apiClient.get<HumanAttentionSummary>(`${tenantRoot(tenantId)}/conversations/human-attention-summary`),
  getConversation: (tenantId: string, conversationId: string) => apiClient.get<Conversation>(`${tenantRoot(tenantId)}/conversations/${conversationId}`),
  listMessages: (tenantId: string, conversationId: string, page: { limit: number; offset: number }) => apiClient.get<ConversationMessage[]>(`${tenantRoot(tenantId)}/conversations/${conversationId}/messages?limit=${page.limit}&offset=${page.offset}`),
  listConversationEvents: (tenantId: string, conversationId: string) => apiClient.get<ConversationAuditEvent[]>(`${tenantRoot(tenantId)}/conversations/${conversationId}/events`),
  getConversationAttachment: (tenantId: string, conversationId: string, resourceId: string, download = false) => apiClient.getBlob(`${tenantRoot(tenantId)}/conversations/${conversationId}/resources/${resourceId}${download ? '?download=1' : ''}`),
  takeoverConversation: (tenantId: string, conversationId: string) => apiClient.post<ConversationOperationResponse>(`${tenantRoot(tenantId)}/conversations/${conversationId}/takeover`, {}),
  returnConversationToAi: (tenantId: string, conversationId: string) => apiClient.post<ConversationOperationResponse>(`${tenantRoot(tenantId)}/conversations/${conversationId}/return-to-ai`, {}),
  pauseConversationAi: (tenantId: string, conversationId: string) => apiClient.post<ConversationOperationResponse>(`${tenantRoot(tenantId)}/conversations/${conversationId}/pause`, {}),
  resumeConversationAi: (tenantId: string, conversationId: string) => apiClient.post<ConversationOperationResponse>(`${tenantRoot(tenantId)}/conversations/${conversationId}/resume`, {}),
  closeConversation: (tenantId: string, conversationId: string) => apiClient.post<ConversationOperationResponse>(`${tenantRoot(tenantId)}/conversations/${conversationId}/close`, {}),
  sendAgentMessage: (tenantId: string, conversationId: string, content: string, idempotencyKey: string) => apiClient.post<AgentMessageResponse>(
    `${tenantRoot(tenantId)}/conversations/${conversationId}/messages`,
    { content },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  ),
  sendAgentMedia: (tenantId: string, conversationId: string, file: File, caption: string, idempotencyKey: string) => {
    const form = new FormData();
    form.set('file', file);
    if (caption.trim()) form.set('caption', caption.trim());
    return apiClient.postForm<AgentMessageResponse>(
      `${tenantRoot(tenantId)}/conversations/${conversationId}/media`,
      form,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  },
  listLeads: (tenantId: string, filters: LeadFilters) => apiClient.get<CrmLeadList>(`${tenantRoot(tenantId)}/leads?${leadQuery(filters)}`),
  getLead: (tenantId: string, leadId: string) => apiClient.get<CrmLead>(`${tenantRoot(tenantId)}/leads/${leadId}`),
  listPipelines: (tenantId: string) => apiClient.get<CrmPipelineStage[]>(`${tenantRoot(tenantId)}/pipelines`),
  listPipelineSummary: (tenantId: string) => apiClient.get<CrmPipelineSummary[]>(`${tenantRoot(tenantId)}/pipelines/summary`),
  getCrmOverview: (tenantId: string) => apiClient.get<CrmOverviewMetrics>(`${tenantRoot(tenantId)}/crm/overview`),
  getDashboardOverview: (tenantId: string, range: { startDate: string; endDate: string }) => apiClient.get<DashboardOverview>(`${tenantRoot(tenantId)}/dashboard/overview?${new URLSearchParams({ start_date: range.startDate, end_date: range.endDate }).toString()}`),
  listContacts: (tenantId: string, page: { limit: number; offset: number }) => apiClient.get<CrmContactList>(`${tenantRoot(tenantId)}/contacts?limit=${page.limit}&offset=${page.offset}`),
  getContact: (tenantId: string, contactId: string) => apiClient.get<CrmContact>(`${tenantRoot(tenantId)}/contacts/${contactId}`),
  listDeals: (tenantId: string, filters: DealFilters) => apiClient.get<CrmDealList>(`${tenantRoot(tenantId)}/deals?${dealQuery(filters)}`),
  getDeal: (tenantId: string, dealId: string) => apiClient.get<CrmDeal>(`${tenantRoot(tenantId)}/deals/${dealId}`),
  createDeal: (tenantId: string, body: DealPayload) => apiClient.post<CrmDeal>(`${tenantRoot(tenantId)}/deals`, body),
  updateDeal: (tenantId: string, dealId: string, body: Partial<DealPayload>) => apiClient.put<CrmDeal>(`${tenantRoot(tenantId)}/deals/${dealId}`, body),
  setDealStage: (tenantId: string, dealId: string, stageId: string) => apiClient.post<CrmDeal>(`${tenantRoot(tenantId)}/deals/${dealId}/stage`, { pipeline_stage_id: stageId }),
  archiveDeal: (tenantId: string, dealId: string) => apiClient.delete<void>(`${tenantRoot(tenantId)}/deals/${dealId}`),
  assignLead: (tenantId: string, leadId: string, userId: string) => apiClient.post<CrmLead>(`${tenantRoot(tenantId)}/leads/${leadId}/assign`, { user_id: userId }),
  setLeadStage: (tenantId: string, leadId: string, stageId: string) => apiClient.post<CrmLead>(`${tenantRoot(tenantId)}/leads/${leadId}/stage`, { pipeline_stage_id: stageId }),
  rescoreLead: (tenantId: string, leadId: string) => apiClient.post<{ status: string; lead_id: string }>(`${tenantRoot(tenantId)}/leads/${leadId}/rescore`, {}),
};
