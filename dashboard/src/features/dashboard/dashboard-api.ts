import { apiClient } from '../../lib/api-client';
import type { Assistant, Conversation, ConversationMessage, KnowledgeDocument, TeamMember, TenantChannel } from '../../types/api';

const tenantRoot = (tenantId: string) => `/api/v1/tenants/${tenantId}`;

export const tenantKeys = {
  assistants: (tenantId: string) => ['tenant', tenantId, 'assistants'] as const,
  channels: (tenantId: string) => ['tenant', tenantId, 'channels'] as const,
  knowledgeBase: (tenantId: string) => ['tenant', tenantId, 'knowledge-base'] as const,
  team: (tenantId: string) => ['tenant', tenantId, 'team'] as const,
  conversations: (tenantId: string, limit: number, offset: number) => ['tenant', tenantId, 'conversations', limit, offset] as const,
  conversation: (tenantId: string, conversationId: string) => ['tenant', tenantId, 'conversation', conversationId] as const,
  messages: (tenantId: string, conversationId: string, limit: number, offset: number) => ['tenant', tenantId, 'conversation', conversationId, 'messages', limit, offset] as const,
};

export const tenantApi = {
  listAssistants: (tenantId: string) => apiClient.get<Assistant[]>(`${tenantRoot(tenantId)}/assistants`),
  listChannels: (tenantId: string) => apiClient.get<TenantChannel[]>(`${tenantRoot(tenantId)}/channels`),
  listKnowledgeBase: (tenantId: string) => apiClient.get<KnowledgeDocument[]>(`${tenantRoot(tenantId)}/knowledge-base`),
  listTeam: (tenantId: string) => apiClient.get<TeamMember[]>(`${tenantRoot(tenantId)}/team`),
  listConversations: (tenantId: string, page: { limit: number; offset: number }) => apiClient.get<Conversation[]>(`${tenantRoot(tenantId)}/conversations?limit=${page.limit}&offset=${page.offset}`),
  getConversation: (tenantId: string, conversationId: string) => apiClient.get<Conversation>(`${tenantRoot(tenantId)}/conversations/${conversationId}`),
  listMessages: (tenantId: string, conversationId: string, page: { limit: number; offset: number }) => apiClient.get<ConversationMessage[]>(`${tenantRoot(tenantId)}/conversations/${conversationId}/messages?limit=${page.limit}&offset=${page.offset}`),
};

