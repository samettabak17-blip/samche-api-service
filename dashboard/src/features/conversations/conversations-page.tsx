import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDate, formatDateTime } from '../../lib/format';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { ConversationDetailPage } from './conversation-detail-page';

const pageSize = 25;

export function ConversationsPage() {
  const { selectedTenant } = useTenant();
  const { conversationId } = useParams();
  const tenantId = selectedTenant?.id ?? '';
  const [offset, setOffset] = useState(0);
  const listQuery = useQuery({ queryKey: tenantKeys.conversations(tenantId, pageSize, offset), queryFn: () => tenantApi.listConversations(tenantId, { limit: pageSize, offset }), enabled: Boolean(tenantId) });
  const conversations = listQuery.data ?? [];

  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its conversations." />;
  if (listQuery.isLoading) return <div className="space-y-5"><SkeletonBlock className="h-16 w-72" /><SkeletonBlock className="h-[34rem]" /></div>;
  if (listQuery.isError) return <QueryErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} resource="conversations" />;
  if (!conversationId && conversations.length === 0) return <EmptyState title="No conversations yet" description="Tenant conversations will appear here when a connected channel receives them." icon={<MessagesSquare aria-hidden="true" size={21} />} />;

  return <div className="space-y-5"><section><p className="eyebrow">Conversation history</p><h1 className="page-title mt-2">Conversations</h1><p className="mt-3 text-sm leading-6 text-stone-600">Review tenant-scoped conversation history. Sending messages is intentionally unavailable here.</p></section><div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]"><section className={`panel overflow-hidden ${conversationId ? 'hidden lg:block' : ''}`}><header className="border-b border-line px-5 py-4"><p className="text-base font-semibold text-ink">Conversation list</p><p className="mt-1 text-sm text-stone-500">Latest {conversations.length} records from this page.</p></header><ul className="divide-y divide-line">{conversations.map((conversation) => <li key={conversation.id}><Link to={`/app/${tenantId}/conversations/${conversation.id}`} className={`block px-5 py-4 transition hover:bg-stone-50 ${conversation.id === conversationId ? 'bg-signal-soft/70' : ''}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{conversation.customer_external_id || conversation.external_conversation_id || 'Customer conversation'}</p><p className="mt-1 text-xs uppercase tracking-wide text-stone-500">{conversation.status}</p></div><time className="shrink-0 text-xs text-stone-500">{formatDate(conversation.created_at)}</time></div></Link></li>)}</ul><div className="flex items-center justify-between border-t border-line px-4 py-3"><button type="button" onClick={() => setOffset((current) => Math.max(0, current - pageSize))} disabled={offset === 0} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-600 disabled:text-stone-400" aria-label="Previous page"><ChevronLeft aria-hidden="true" size={15} />Previous</button><span className="text-xs text-stone-500">Page {Math.floor(offset / pageSize) + 1}</span><button type="button" onClick={() => setOffset((current) => current + pageSize)} disabled={conversations.length < pageSize} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-600 disabled:text-stone-400" aria-label="Next page">Next<ChevronRight aria-hidden="true" size={15} /></button></div></section><div className={conversationId ? '' : 'hidden lg:block'}>{conversationId ? <ConversationDetailPage tenantId={tenantId} conversationId={conversationId} mobileBackPath={`/app/${tenantId}/conversations`} /> : <EmptyState title="Select a conversation" description="Choose a conversation from the list to inspect its messages and channel context." icon={<MessagesSquare aria-hidden="true" size={21} />} />}</div></div></div>;
}

