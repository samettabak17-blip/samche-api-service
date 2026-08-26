import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client';
import { tenantApi, tenantKeys } from './dashboard-api';

describe('tenant dashboard API', () => {
  it('keeps query keys tenant-scoped', () => {
    expect(tenantKeys.conversations('tenant-a', 25, 50)).toEqual(['tenant', 'tenant-a', 'conversations', 25, 50]);
    expect(tenantKeys.team('tenant-a')).toEqual(['tenant', 'tenant-a', 'team']);
  });

  it('passes pagination parameters to the real conversations endpoint', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([]);

    await tenantApi.listConversations('tenant-a', { limit: 25, offset: 50 }, { channelType: 'WHATSAPP', search: 'customer' });

    expect(get).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/conversations?limit=25&offset=50&channel_type=WHATSAPP&search=customer');
    get.mockRestore();
  });

  it('uses tenant-scoped Live Inbox endpoints for projections and operations', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});

    await tenantApi.getConversation('tenant-a', 'conversation-a');
    await tenantApi.listMessages('tenant-a', 'conversation-a', { limit: 50, offset: 0 });
    await tenantApi.listConversationEvents('tenant-a', 'conversation-a');
    await tenantApi.takeoverConversation('tenant-a', 'conversation-a');
    await tenantApi.sendAgentMessage('tenant-a', 'conversation-a', 'Human reply', 'idem-a');

    expect(tenantKeys.conversationEvents('tenant-a', 'conversation-a')).toEqual(['tenant', 'tenant-a', 'conversation', 'conversation-a', 'events']);
    expect(get).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/conversations/conversation-a');
    expect(get).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/conversations/conversation-a/messages?limit=50&offset=0');
    expect(get).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/conversations/conversation-a/events');
    expect(post).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/conversations/conversation-a/takeover', {});
    expect(post).toHaveBeenCalledWith(
      '/api/v1/tenants/tenant-a/conversations/conversation-a/messages',
      { content: 'Human reply' },
      { headers: { 'Idempotency-Key': 'idem-a' } },
    );
    get.mockRestore();
    post.mockRestore();
  });

  it('uses tenant-scoped resource paths for assistant, channel and knowledge mutations', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ id: 'new' });
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ id: 'channel-a' });
    const remove = vi.spyOn(apiClient, 'delete').mockResolvedValue({ message: 'ok' });

    await tenantApi.createAssistant('tenant-a', { name: 'Concierge' });
    await tenantApi.updateChannel('tenant-a', 'channel-a', { display_name: 'Support' });
    await tenantApi.deleteKnowledgeDocument('tenant-a', 'document-a');

    expect(post).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/assistants', { name: 'Concierge' });
    expect(put).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/channels/channel-a', { display_name: 'Support' });
    expect(remove).toHaveBeenCalledWith('/api/v1/tenants/tenant-a/knowledge-base/document-a');
    post.mockRestore();
    put.mockRestore();
    remove.mockRestore();
  });
});

