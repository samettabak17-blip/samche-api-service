import { apiClient } from '../../lib/api-client';
import type { Assistant, Conversation, ConversationMessage, KnowledgeDocument, TeamMember, TenantChannel } from '../../types/api';

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
  conversation: (tenantId: string, conversationId: string) => ['tenant', tenantId, 'conversation', conversationId] as const,
  messages: (tenantId: string, conversationId: string, limit: number, offset: number) => ['tenant', tenantId, 'conversation', conversationId, 'messages', limit, offset] as const,
};

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
  listConversations: (tenantId: string, page: { limit: number; offset: number }) => apiClient.get<Conversation[]>(`${tenantRoot(tenantId)}/conversations?limit=${page.limit}&offset=${page.offset}`),
  getConversation: (tenantId: string, conversationId: string) => apiClient.get<Conversation>(`${tenantRoot(tenantId)}/conversations/${conversationId}`),
  listMessages: (tenantId: string, conversationId: string, page: { limit: number; offset: number }) => apiClient.get<ConversationMessage[]>(`${tenantRoot(tenantId)}/conversations/${conversationId}/messages?limit=${page.limit}&offset=${page.offset}`),
};

