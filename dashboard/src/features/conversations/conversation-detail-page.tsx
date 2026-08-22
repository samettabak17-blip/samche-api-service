import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Cable, ChevronLeft, ChevronRight, MessageSquareText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDateTime } from '../../lib/format';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { senderLabel, senderTone } from './conversation-utils';

const messagePageSize = 50;

export function ConversationDetailPage({ tenantId, conversationId, mobileBackPath }: { tenantId: string; conversationId: string; mobileBackPath?: string }) {
  const [messageOffset, setMessageOffset] = useState(0);
  const conversationQuery = useQuery({ queryKey: tenantKeys.conversation(tenantId, conversationId), queryFn: () => tenantApi.getConversation(tenantId, conversationId) });
  const messagesQuery = useQuery({ queryKey: tenantKeys.messages(tenantId, conversationId, messagePageSize, messageOffset), queryFn: () => tenantApi.listMessages(tenantId, conversationId, { limit: messagePageSize, offset: messageOffset }) });
  const channelsQuery = useQuery({ queryKey: tenantKeys.channels(tenantId), queryFn: () => tenantApi.listChannels(tenantId) });

  if (conversationQuery.isLoading || messagesQuery.isLoading || channelsQuery.isLoading) return <div className="space-y-4"><SkeletonBlock className="h-20" /><SkeletonBlock className="h-80" /></div>;
  const failed = [conversationQuery, messagesQuery, channelsQuery].find((query) => query.isError);
  if (failed) return <QueryErrorState error={failed.error} onRetry={() => [conversationQuery, messagesQuery, channelsQuery].forEach((query) => void query.refetch())} resource="conversation" />;
  const conversation = conversationQuery.data;
  if (!conversation) return <EmptyState title="Conversation not found" description="This conversation is no longer available in the selected tenant." />;
  const channel = channelsQuery.data?.find((item) => item.id === conversation.channel_id);
  const messages = messagesQuery.data ?? [];

  return <section className="panel flex min-h-[34rem] flex-col overflow-hidden"><header className="border-b border-line px-5 py-4"><div className="flex items-start gap-3">{mobileBackPath && <Link to={mobileBackPath} className="mt-0.5 rounded-lg p-1.5 text-stone-600 hover:bg-stone-100 md:hidden" aria-label="Back to conversations"><ArrowLeft aria-hidden="true" size={18} /></Link>}<div className="min-w-0"><p className="text-base font-semibold text-ink">{conversation.customer_external_id || conversation.external_conversation_id || 'Customer conversation'}</p><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500"><span className="inline-flex items-center gap-1"><Cable aria-hidden="true" size={13} />{channel?.display_name ?? 'Channel unavailable'}</span><span className="uppercase tracking-wide">{conversation.status}</span><span>{formatDateTime(conversation.created_at)}</span></div></div></div></header><div className="flex-1 space-y-4 overflow-y-auto bg-stone-50/60 p-5">{messages.length === 0 ? <div className="grid min-h-64 place-items-center"><div className="text-center"><MessageSquareText aria-hidden="true" className="mx-auto text-stone-400" size={27} /><p className="mt-3 text-sm font-medium text-ink">No messages yet</p><p className="mt-1 text-sm text-stone-500">Messages will appear here when this conversation receives them.</p></div></div> : messages.map((message) => <article key={message.id} className={`max-w-[88%] rounded-2xl border px-4 py-3 ${senderTone(message.sender_type)}`}><div className="flex items-center justify-between gap-4"><p className="text-xs font-semibold uppercase tracking-wide opacity-70">{senderLabel(message.sender_type)}</p><time className="text-[11px] opacity-60">{formatDateTime(message.created_at)}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.content}</p></article>)}</div><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-5 py-3"><div className="flex gap-1"><button type="button" onClick={() => setMessageOffset((current) => Math.max(0, current - messagePageSize))} disabled={messageOffset === 0} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-600 disabled:text-stone-400"><ChevronLeft aria-hidden="true" size={14} />Previous</button><button type="button" onClick={() => setMessageOffset((current) => current + messagePageSize)} disabled={messages.length < messagePageSize} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-stone-600 disabled:text-stone-400">Next<ChevronRight aria-hidden="true" size={14} /></button></div><p className="text-xs text-stone-500">Message composition is not available in this dashboard.</p></footer></section>;
}

