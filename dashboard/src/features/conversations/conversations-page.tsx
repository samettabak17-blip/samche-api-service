import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Headphones, Image as ImageIcon, MessageSquareText, Send, UserRound, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDateTime } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { ApiError } from '../../lib/api-client';
import { useTenant } from '../tenants/tenant-context';
import { canUseHumanReplyComposer, clearSentAgentDraft, isInlinePreviewableAttachment, senderLabel, senderTone } from './conversation-utils';
import { useLiveSupportAttention } from '../live-support/live-support-attention-provider';
import { SafeRichMessage } from './safe-rich-message';
import { useTenantConversationLiveEvents } from './use-live-conversation-events';

const pageSize = 25;
const messagePageSize = 50;

function handlingLabel(mode?: string) {
  return mode === 'HUMAN' ? 'Human handling' : mode === 'PAUSED' ? 'AI paused' : 'AI handling';
}

function LiveState({ state }: { state: string }) {
  const label = state === 'connected' ? 'Live' : state === 'reconnecting' ? 'Reconnecting' : state === 'connecting' ? 'Connecting' : 'Offline';
  return <span className="inline-flex items-center gap-2 rounded-full border border-gold/20 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold"><span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>;
}

export function ConversationsPage() {
  const { selectedTenant, tenantRole } = useTenant();
  const { user } = useAuth();
  const { conversationId } = useParams();
  const queryClient = useQueryClient();
  const tenantId = selectedTenant?.id ?? '';
  const [offset, setOffset] = useState(0);
  const [messageOffset, setMessageOffset] = useState(0);
  const [content, setContent] = useState('');
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; mimeType: string; filename: string } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const liveState = useTenantConversationLiveEvents(tenantId, conversationId);
  const { requestedCount: unresolvedAttention, refreshAttention } = useLiveSupportAttention();
  useEffect(() => {
    setMessageOffset(0);
  }, [conversationId]);

  const conversationsQuery = useQuery({ queryKey: tenantKeys.conversations(tenantId, pageSize, offset), queryFn: () => tenantApi.listConversations(tenantId, { limit: pageSize, offset }), enabled: Boolean(tenantId) });
  const conversationQuery = useQuery({ queryKey: tenantKeys.conversation(tenantId, conversationId ?? ''), queryFn: () => tenantApi.getConversation(tenantId, conversationId ?? ''), enabled: Boolean(tenantId && conversationId) });
  const messagesQuery = useQuery({ queryKey: tenantKeys.messages(tenantId, conversationId ?? '', messagePageSize, messageOffset), queryFn: () => tenantApi.listMessages(tenantId, conversationId ?? '', { limit: messagePageSize, offset: messageOffset }), enabled: Boolean(tenantId && conversationId) });
  const eventsQuery = useQuery({ queryKey: tenantKeys.conversationEvents(tenantId, conversationId ?? ''), queryFn: () => tenantApi.listConversationEvents(tenantId, conversationId ?? ''), enabled: Boolean(tenantId && conversationId) });

  const refresh = async (reason?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversations'] }),
      conversationId ? queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation', conversationId] }) : Promise.resolve(),
      conversationId ? queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation', conversationId, 'messages'] }) : Promise.resolve(),
      conversationId ? queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation', conversationId, 'events'] }) : Promise.resolve(),
    ]);
    if (reason) await refreshAttention(reason === 'agent-message' ? 'AGENT_ACK' : reason.toUpperCase());
  };

  const operation = useMutation({
    mutationFn: (action: string) => {
      if (!conversationId) throw new Error('Conversation not selected');
      if (action === 'takeover') return tenantApi.takeoverConversation(tenantId, conversationId);
      if (action === 'return') return tenantApi.returnConversationToAi(tenantId, conversationId);
      if (action === 'pause') return tenantApi.pauseConversationAi(tenantId, conversationId);
      if (action === 'resume') return tenantApi.resumeConversationAi(tenantId, conversationId);
      return tenantApi.closeConversation(tenantId, conversationId);
    },
    onSuccess: async (_data, action) => { await refresh(action); },
  });

  const send = useMutation({
    mutationFn: (draft: string) => tenantApi.sendAgentMessage(tenantId, conversationId ?? '', draft, crypto.randomUUID()),
    onSuccess: async (_result, sentDraft) => {
      setContent((current) => clearSentAgentDraft(current, sentDraft));
      await refresh('agent-message');
    },
  });


  const closeAttachmentPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setAttachmentPreview(null);
  };

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const openAttachment = async (resource: { id: string; mime_type: string | null; original_filename: string | null }, download: boolean) => {
    if (!conversationId) return;
    setAttachmentError(null);
    try {
      const blob = await tenantApi.getConversationAttachment(tenantId, conversationId, resource.id, download);
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = resource.original_filename || 'attachment';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setAttachmentPreview({ url, mimeType: resource.mime_type || blob.type || 'application/octet-stream', filename: resource.original_filename || 'Attachment' });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setAttachmentError(status === 403 ? 'You are not permitted to access this attachment.' : status === 404 ? 'This attachment is no longer available.' : 'This attachment is currently unavailable.');
    }
  };

  const conversations = conversationsQuery.data ?? [];
  const conversation = conversationQuery.data;
  const messages = messagesQuery.data ?? [];
  const isAdmin = user?.system_role === 'OWNER' || tenantRole === 'ADMIN';
  const isAgent = tenantRole === 'AGENT';
  const isOwn = conversation?.assigned_agent_user_id === user?.id;
  const canTakeOver = Boolean(conversation && conversation.status === 'open' && conversation.handling_mode === 'AI' && !conversation.assigned_agent_user_id && (isAdmin || isAgent));
  const canReturn = Boolean(conversation && conversation.status === 'open' && conversation.handling_mode === 'HUMAN' && (isAdmin || (isAgent && isOwn)));
  const canSend = Boolean(conversation && conversation.status === 'open' && canUseHumanReplyComposer(conversation.channel_type, conversation.human_delivery_configured) && conversation.handling_mode === 'HUMAN' && (isAdmin || (isAgent && isOwn)));

  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its conversations." />;
  if (conversationsQuery.isLoading) return <div className="space-y-5"><SkeletonBlock className="h-16 w-72" /><SkeletonBlock className="h-[38rem]" /></div>;
  if (conversationsQuery.isError) return <QueryErrorState error={conversationsQuery.error} onRetry={() => void conversationsQuery.refetch()} resource="conversations" />;

  return <div className="space-y-5">
    <header className="flex items-end justify-between gap-4"><div><p className="eyebrow">SamChe live customer inbox</p><h1 className="page-title mt-2">Conversations</h1><p className="mt-2 text-sm text-stone-400">Real tenant channel activity and human handoff controls.</p></div><LiveState state={liveState} /></header>
    <div className="grid min-h-[42rem] gap-4 xl:grid-cols-[19rem_minmax(0,1fr)_18rem]">
      <section className={'panel overflow-hidden ' + (conversationId ? 'hidden xl:block' : '')}>
        <header className="border-b border-line px-4 py-4"><p className="font-semibold text-ink">Conversation inbox</p><p className="mt-1 text-xs text-stone-400">Latest tenant activity</p></header>
        {conversations.length === 0 ? <div className="p-5"><EmptyState title="No conversations yet" description="Connected channel traffic will appear here." icon={<MessageSquareText size={20} />} /></div> : <ul className="divide-y divide-line">{conversations.map((item) => <li key={item.id}><Link to={'/app/' + tenantId + '/conversations/' + item.id} className={'block px-4 py-4 transition hover:bg-white/[0.035] ' + (item.id === conversationId ? 'bg-signal/10 ' : '') + (item.human_attention_state === 'REQUESTED' ? 'bg-red-500/10 ring-1 ring-inset ring-red-400/30' : '')}><div className="flex justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{item.customer_external_id || item.external_conversation_id || 'Customer conversation'}</p><p className="mt-1 truncate text-xs text-stone-400">{item.last_message_preview || item.channel_display_name || 'No message preview'}</p></div><time className="shrink-0 text-[11px] text-stone-500">{formatDateTime(item.last_activity_at || item.created_at)}</time></div><div className="mt-3 flex gap-1.5"><span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-stone-300">{item.channel_type || 'CHANNEL'}</span><span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-stone-300">{handlingLabel(item.handling_mode)}</span>{item.human_attention_state === 'REQUESTED' && <span className="rounded border border-red-400/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.1em] text-red-200">LIVE SUPPORT</span>}</div></Link></li>)}</ul>}
        <footer className="flex justify-between border-t border-line px-3 py-3"><button type="button" onClick={() => setOffset((value) => Math.max(0, value - pageSize))} disabled={offset === 0} className="text-xs text-stone-400 disabled:opacity-40"><ChevronLeft className="inline" size={14} /> Previous</button><button type="button" onClick={() => setOffset((value) => value + pageSize)} disabled={conversations.length < pageSize} className="text-xs text-stone-400 disabled:opacity-40">Next <ChevronRight className="inline" size={14} /></button></footer>
      </section>

      <section className={'panel flex min-h-[42rem] flex-col overflow-hidden ' + (!conversationId ? 'hidden xl:flex' : '')}>
        {!conversationId ? <EmptyState title="Select a conversation" description="Choose an inbox item to inspect its real message history." icon={<MessageSquareText size={22} />} /> : conversationQuery.isLoading || messagesQuery.isLoading ? <div className="space-y-4 p-5"><SkeletonBlock className="h-20" /><SkeletonBlock className="h-80" /></div> : conversationQuery.isError || messagesQuery.isError ? <QueryErrorState error={conversationQuery.error ?? messagesQuery.error!} onRetry={() => { void conversationQuery.refetch(); void messagesQuery.refetch(); }} resource="conversation" /> : conversation ? <>
          <header className="border-b border-line px-5 py-4"><div className="flex flex-wrap justify-between gap-3"><div><Link to={'/app/' + tenantId + '/conversations'} className="text-xs text-stone-400 xl:hidden">← Inbox</Link><p className="mt-1 text-base font-semibold text-ink">{conversation.customer_external_id || 'Customer conversation'}</p><p className="mt-1 text-xs text-stone-400">{conversation.channel_display_name || conversation.channel_type} · {handlingLabel(conversation.handling_mode)}</p></div><div className="flex flex-wrap gap-2">{canTakeOver && <button type="button" onClick={() => operation.mutate('takeover')} className="button-primary"><Headphones size={15} />Take over</button>}{canReturn && <button type="button" onClick={() => operation.mutate('return')} className="button-secondary"><Bot size={15} />Return to AI</button>}{isAdmin && conversation.handling_mode === 'AI' && <button type="button" onClick={() => operation.mutate('pause')} className="button-secondary">Pause AI</button>}{isAdmin && conversation.handling_mode === 'PAUSED' && <button type="button" onClick={() => operation.mutate('resume')} className="button-secondary">Resume AI</button>}{isAdmin && conversation.status === 'open' && <button type="button" onClick={() => operation.mutate('close')} className="button-danger">Close</button>}</div></div>{operation.error instanceof Error && <p role="alert" className="mt-3 text-xs text-red-300">{operation.error.message}</p>}</header>
          {attachmentPreview && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Attachment preview">
            <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-2xl">
              <header className="flex items-center justify-between border-b border-line px-5 py-3"><div className="min-w-0"><p className="text-sm font-semibold text-ink">Attachment preview</p><p className="truncate text-xs text-stone-400">{attachmentPreview.filename}</p></div><button type="button" onClick={closeAttachmentPreview} className="button-secondary h-9 w-9 !p-0" aria-label="Close attachment preview"><X size={17} /></button></header>
              <div className="min-h-0 flex-1 overflow-auto bg-black/30 p-4">{attachmentPreview.mimeType.startsWith('image/') ? <img src={attachmentPreview.url} alt={attachmentPreview.filename} className="mx-auto max-h-[72vh] max-w-full object-contain" /> : attachmentPreview.mimeType === 'application/pdf' ? <iframe title={attachmentPreview.filename} src={attachmentPreview.url} className="h-[72vh] w-full rounded border border-line bg-white" /> : <p className="text-sm text-stone-300">Preview is unavailable for this file type.</p>}</div>
              <footer className="flex justify-end border-t border-line px-5 py-3"><a href={attachmentPreview.url} download={attachmentPreview.filename} className="button-primary"><Download size={15} />Download</a></footer>
            </section>
          </div>}
          <div className="flex-1 space-y-4 overflow-y-auto bg-black/10 p-5">{messages.map((message) => <article key={message.id} className={'max-w-[88%] rounded-xl border px-4 py-3 ' + senderTone(message.sender_type)}><div className="flex justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{senderLabel(message.sender_type)}{message.actor_email ? ' · ' + message.actor_email : ''}</p><time className="text-[10px] opacity-60">{formatDateTime(message.created_at)}</time></div><div className="mt-2 min-w-0 break-words text-sm leading-6"><SafeRichMessage content={message.content} /></div>{message.resources.length > 0 && <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Message attachments">{message.resources.map((resource) => <li key={resource.id} className="rounded-lg border border-white/10 bg-black/15 p-3 text-xs"><div className="flex items-start gap-3">{resource.media_category === 'IMAGE' ? <ImageIcon className="mt-0.5 shrink-0 text-gold" size={20} /> : <FileText className="mt-0.5 shrink-0 text-gold" size={20} />}<div className="min-w-0 flex-1"><p className="truncate font-medium text-stone-100">{resource.original_filename || (resource.media_category === 'IMAGE' ? 'Image attachment' : 'Document attachment')}</p><p className="mt-1 text-stone-400">{resource.mime_type || 'Unknown type'}{resource.size_bytes ? ' · ' + Math.ceil(resource.size_bytes / 1024) + ' KB' : ''}{resource.processing_status === 'FAILED' ? ' · Unavailable' : ''}</p><div className="mt-2 flex gap-3">{resource.processing_status !== 'FAILED' && isInlinePreviewableAttachment(resource.mime_type) && <button type="button" onClick={() => void openAttachment(resource, false)} className="inline-flex items-center gap-1 text-gold hover:text-gold/80"><ExternalLink size={13} />View</button>}<button type="button" onClick={() => void openAttachment(resource, true)} className="inline-flex items-center gap-1 text-gold hover:text-gold/80"><Download size={13} />Download</button></div></div></div></li>)}</ul>}</article>)}{messages.length === 0 && <EmptyState title="No messages yet" description="Messages will appear as the channel receives them." />}{messages.length > 0 && <div className="flex justify-between pt-2 text-xs text-stone-400"><button type="button" onClick={() => setMessageOffset((value) => Math.max(0, value - messagePageSize))} disabled={messageOffset === 0} className="disabled:opacity-40"><ChevronLeft className="inline" size={14} /> Previous messages</button><button type="button" onClick={() => setMessageOffset((value) => value + messagePageSize)} disabled={messages.length < messagePageSize} className="disabled:opacity-40">Next messages <ChevronRight className="inline" size={14} /></button></div>}</div>
          {attachmentError && <p role="alert" className="mx-5 mt-3 text-xs text-red-300">{attachmentError}</p>}<footer className="border-t border-line bg-black/10 px-5 py-4">{canSend ? <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (content.trim()) send.mutate(content.trim()); }}><label className="sr-only" htmlFor="agent-message">Reply as human agent</label><textarea id="agent-message" value={content} onChange={(event) => setContent(event.target.value)} className="field min-h-24 w-full resize-y" placeholder="Write a response to the customer…" maxLength={8000} /><div className="mt-3 flex justify-between gap-3"><p className="text-xs text-stone-500">{conversation.channel_type === 'WHATSAPP' ? 'Sent through the configured WhatsApp channel.' : 'Sent to the Samcheguide conversation feed.'}</p><button type="submit" disabled={!content.trim() || send.isPending} className="button-primary"><Send size={15} />Send</button></div>{send.error instanceof Error && <p role="alert" className="mt-2 text-xs text-red-300">{send.error.message}</p>}</form> : <p className="text-xs text-stone-400">{conversation.handling_mode === 'HUMAN' ? 'Only the assigned operator can reply.' : 'Take over to enable a supported human reply.'}</p>}</footer>
        </> : <EmptyState title="Conversation not found" description="This conversation is unavailable in the selected tenant." />}
      </section>

      <aside className="panel hidden p-5 xl:block"><p className="eyebrow">Conversation context</p>{conversation ? <div className="mt-5 space-y-6 text-sm"><div><p className="text-xs uppercase tracking-wide text-stone-500">Customer</p><p className="mt-2 break-all font-medium text-ink">{conversation.customer_external_id || 'Customer identifier unavailable'}</p><p className="mt-1 text-xs text-stone-400">{conversation.channel_display_name || conversation.channel_type}</p></div><div><p className="text-xs uppercase tracking-wide text-stone-500">Handling</p><p className="mt-2 flex items-center gap-2 font-medium text-ink"><UserRound size={15} />{handlingLabel(conversation.handling_mode)}</p><p className="mt-1 text-xs text-stone-400">{conversation.assigned_agent_email ? 'Assigned to ' + conversation.assigned_agent_email : 'No human operator assigned'}</p></div><div><p className="text-xs uppercase tracking-wide text-stone-500">AI</p><p className="mt-2 font-medium text-ink">{conversation.assistant_name || 'No assistant associated'}</p></div><div><p className="text-xs uppercase tracking-wide text-stone-500">Operational events</p><div className="mt-2 space-y-2">{eventsQuery.data?.length ? eventsQuery.data.map((event) => <p key={event.id} className="rounded border border-white/[0.06] bg-white/[0.025] px-2 py-2 text-xs text-stone-300">{event.event_type.split('_').join(' ')} · {formatDateTime(event.created_at)}</p>) : <p className="text-xs text-stone-500">No operational events yet.</p>}</div></div></div> : <p className="mt-5 text-sm text-stone-500">Select a conversation.</p>}</aside>
    </div>
  </div>;
}
