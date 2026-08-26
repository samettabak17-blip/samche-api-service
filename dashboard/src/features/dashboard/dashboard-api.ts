import { apiClient } from '../../lib/api-client';
import type { AgentMessageResponse, HumanAttentionSummary, DashboardOverview, Assistant, Conversation, ConversationAuditEvent, ConversationMessage, ConversationOperationResponse, CrmContact, CrmContactList, CrmDeal, CrmDealList, CrmLead, CrmLeadList, CrmOverviewMetrics, CrmPipelineStage, CrmPipelineSummary, KnowledgeDocument, TeamMember, TenantChannel } from '../../types/api';

const tenantRoot = (tenantId: string) => `/api/v1/tenants/${tenantId}`;
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
  dashboardOverview: (tenantId: string, days: number) => ['tenant', tenantId, 'dashboard-overview', days] as const,
};
export interface LeadFilters { limit: number; offset: number; temperature?: string; stage?: string; source?: string; assigned_user_id?: string; conversation_id?: string; }
export interface DealFilters { limit: number; offset: number; stage?: string; contact_id?: string; owner_user_id?: string; status?: string; source?: string; include_archived?: boolean; }
export interface DealPayload { contact_id: string; lead_id?: string | null; title: string; pipeline_stage_id?: string; value?: number | null; currency?: string | null; probability?: number | null; expected_close_date?: string | null; owner_user_id?: string | null; source?: string | null; notes?: string | null; }
const leadQuery = (filters: LeadFilters) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();
const dealQuery = (filters: DealFilters) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString();

export const tenantApi = {
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
  listLeads: (tenantId: string, filters: LeadFilters) => apiClient.get<CrmLeadList>(`${tenantRoot(tenantId)}/leads?${leadQuery(filters)}`),
  getLead: (tenantId: string, leadId: string) => apiClient.get<CrmLead>(`${tenantRoot(tenantId)}/leads/${leadId}`),
  listPipelines: (tenantId: string) => apiClient.get<CrmPipelineStage[]>(`${tenantRoot(tenantId)}/pipelines`),
  listPipelineSummary: (tenantId: string) => apiClient.get<CrmPipelineSummary[]>(`${tenantRoot(tenantId)}/pipelines/summary`),
  getCrmOverview: (tenantId: string) => apiClient.get<CrmOverviewMetrics>(`${tenantRoot(tenantId)}/crm/overview`),
  getDashboardOverview: (tenantId: string, days: number) => apiClient.get<DashboardOverview>(`${tenantRoot(tenantId)}/dashboard/overview?days=${days}`),
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
