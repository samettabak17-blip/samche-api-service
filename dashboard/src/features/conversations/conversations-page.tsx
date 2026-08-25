import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronLeft, ChevronRight, Headphones, MessageSquareText, Send, UserRound } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDateTime } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { canUseHumanReplyComposer, senderLabel, senderTone } from './conversation-utils';
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
  const [audioArmed, setAudioArmed] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const liveState = useTenantConversationLiveEvents(tenantId, conversationId);
  useEffect(() => {
    setMessageOffset(0);
  }, [conversationId]);

  const conversationsQuery = useQuery({ queryKey: tenantKeys.conversations(tenantId, pageSize, offset), queryFn: () => tenantApi.listConversations(tenantId, { limit: pageSize, offset }), enabled: Boolean(tenantId) });
  const conversationQuery = useQuery({ queryKey: tenantKeys.conversation(tenantId, conversationId ?? ''), queryFn: () => tenantApi.getConversation(tenantId, conversationId ?? ''), enabled: Boolean(tenantId && conversationId) });
  const messagesQuery = useQuery({ queryKey: tenantKeys.messages(tenantId, conversationId ?? '', messagePageSize, messageOffset), queryFn: () => tenantApi.listMessages(tenantId, conversationId ?? '', { limit: messagePageSize, offset: messageOffset }), enabled: Boolean(tenantId && conversationId) });
  const eventsQuery = useQuery({ queryKey: tenantKeys.conversationEvents(tenantId, conversationId ?? ''), queryFn: () => tenantApi.listConversationEvents(tenantId, conversationId ?? ''), enabled: Boolean(tenantId && conversationId) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversations'] });
    if (conversationId) {
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'conversation-events', conversationId] });
    }
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
    onSuccess: refresh,
  });

  const send = useMutation({
    mutationFn: () => tenantApi.sendAgentMessage(tenantId, conversationId ?? '', content.trim(), crypto.randomUUID()),
    onSuccess: () => { setContent(''); refresh(); },
  });

  const attentionQuery = useQuery({ queryKey: tenantKeys.humanAttention(tenantId), queryFn: () => tenantApi.getHumanAttentionSummary(tenantId), enabled: Boolean(tenantId) });
  const unresolvedAttention = attentionQuery.data?.unresolvedCount ?? 0;
  useEffect(() => {
    const normalTitle = 'SamChe Dashboard';
    document.title = unresolvedAttention > 0 ? '(' + unresolvedAttention + ') ' + normalTitle : normalTitle;
    return () => { document.title = normalTitle; };
  }, [unresolvedAttention]);
  useEffect(() => {
    const arm = () => setAudioArmed(true);
    window.addEventListener('pointerdown', arm, { once: true });
    return () => window.removeEventListener('pointerdown', arm);
  }, []);
  useEffect(() => {
    if (!audioArmed || unresolvedAttention < 1) return;
    const alert = () => {
      try {
        const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        audioContext.current ??= new Context();
        if (audioContext.current.state === 'suspended') { void audioContext.current.resume().catch(() => {}); }
        const oscillator = audioContext.current.createOscillator();
        const gain = audioContext.current.createGain();
        gain.gain.setValueAtTime(0.035, audioContext.current.currentTime);
        oscillator.frequency.setValueAtTime(880, audioContext.current.currentTime);
        oscillator.connect(gain).connect(audioContext.current.destination);
        oscillator.start(); oscillator.stop(audioContext.current.currentTime + 0.16);
      } catch { /* visual attention remains available if browser audio is blocked */ }
    };
    alert();
    const timer = window.setInterval(alert, 3000);
    return () => window.clearInterval(timer);
  }, [audioArmed, unresolvedAttention]);

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
    <header className="flex items-end justify-between gap-4"><div><p className="eyebrow">SamChe live customer inbox</p><h1 className="page-title mt-2">Conversations</h1><p className="mt-2 text-sm text-stone-400">Real tenant channel activity and human handoff controls.</p>{unresolvedAttention > 0 && <p className="mt-2 inline-flex rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-200">{unresolvedAttention} needs attention</p>}{unresolvedAttention > 0 && !audioArmed && <p className="mt-2 text-xs text-gold">Click anywhere in Dashboard to activate sound alerts.</p>}</div><LiveState state={liveState} /></header>
    <div className="grid min-h-[42rem] gap-4 xl:grid-cols-[19rem_minmax(0,1fr)_18rem]">
      <section className={'panel overflow-hidden ' + (conversationId ? 'hidden xl:block' : '')}>
        <header className="border-b border-line px-4 py-4"><p className="font-semibold text-ink">Conversation inbox</p><p className="mt-1 text-xs text-stone-400">Latest tenant activity</p></header>
        {conversations.length === 0 ? <div className="p-5"><EmptyState title="No conversations yet" description="Connected channel traffic will appear here." icon={<MessageSquareText size={20} />} /></div> : <ul className="divide-y divide-line">{conversations.map((item) => <li key={item.id}><Link to={'/app/' + tenantId + '/conversations/' + item.id} className={'block px-4 py-4 transition hover:bg-white/[0.035] ' + (item.id === conversationId ? 'bg-signal/10 ' : '') + (item.human_attention_state === 'REQUESTED' ? 'bg-red-500/10 ring-1 ring-inset ring-red-400/30' : '')}><div className="flex justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{item.customer_external_id || item.external_conversation_id || 'Customer conversation'}</p><p className="mt-1 truncate text-xs text-stone-400">{item.last_message_preview || item.channel_display_name || 'No message preview'}</p></div><time className="shrink-0 text-[11px] text-stone-500">{formatDateTime(item.last_activity_at || item.created_at)}</time></div><div className="mt-3 flex gap-1.5"><span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-stone-300">{item.channel_type || 'CHANNEL'}</span><span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-stone-300">{handlingLabel(item.handling_mode)}</span>{item.human_attention_state === 'REQUESTED' && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-200">Needs attention</span>}</div></Link></li>)}</ul>}
        <footer className="flex justify-between border-t border-line px-3 py-3"><button type="button" onClick={() => setOffset((value) => Math.max(0, value - pageSize))} disabled={offset === 0} className="text-xs text-stone-400 disabled:opacity-40"><ChevronLeft className="inline" size={14} /> Previous</button><button type="button" onClick={() => setOffset((value) => value + pageSize)} disabled={conversations.length < pageSize} className="text-xs text-stone-400 disabled:opacity-40">Next <ChevronRight className="inline" size={14} /></button></footer>
      </section>

      <section className={'panel flex min-h-[42rem] flex-col overflow-hidden ' + (!conversationId ? 'hidden xl:flex' : '')}>
        {!conversationId ? <EmptyState title="Select a conversation" description="Choose an inbox item to inspect its real message history." icon={<MessageSquareText size={22} />} /> : conversationQuery.isLoading || messagesQuery.isLoading ? <div className="space-y-4 p-5"><SkeletonBlock className="h-20" /><SkeletonBlock className="h-80" /></div> : conversationQuery.isError || messagesQuery.isError ? <QueryErrorState error={conversationQuery.error ?? messagesQuery.error!} onRetry={() => { void conversationQuery.refetch(); void messagesQuery.refetch(); }} resource="conversation" /> : conversation ? <>
          <header className="border-b border-line px-5 py-4"><div className="flex flex-wrap justify-between gap-3"><div><Link to={'/app/' + tenantId + '/conversations'} className="text-xs text-stone-400 xl:hidden">← Inbox</Link><p className="mt-1 text-base font-semibold text-ink">{conversation.customer_external_id || 'Customer conversation'}</p><p className="mt-1 text-xs text-stone-400">{conversation.channel_display_name || conversation.channel_type} · {handlingLabel(conversation.handling_mode)}</p></div><div className="flex flex-wrap gap-2">{canTakeOver && <button type="button" onClick={() => operation.mutate('takeover')} className="button-primary"><Headphones size={15} />Take over</button>}{canReturn && <button type="button" onClick={() => operation.mutate('return')} className="button-secondary"><Bot size={15} />Return to AI</button>}{isAdmin && conversation.handling_mode === 'AI' && <button type="button" onClick={() => operation.mutate('pause')} className="button-secondary">Pause AI</button>}{isAdmin && conversation.handling_mode === 'PAUSED' && <button type="button" onClick={() => operation.mutate('resume')} className="button-secondary">Resume AI</button>}{isAdmin && conversation.status === 'open' && <button type="button" onClick={() => operation.mutate('close')} className="button-danger">Close</button>}</div></div>{operation.error instanceof Error && <p role="alert" className="mt-3 text-xs text-red-300">{operation.error.message}</p>}</header>
          <div className="flex-1 space-y-4 overflow-y-auto bg-black/10 p-5">{messages.map((message) => <article key={message.id} className={'max-w-[88%] rounded-xl border px-4 py-3 ' + senderTone(message.sender_type)}><div className="flex justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{senderLabel(message.sender_type)}{message.actor_email ? ' · ' + message.actor_email : ''}</p><time className="text-[10px] opacity-60">{formatDateTime(message.created_at)}</time></div><div className="mt-2 min-w-0 break-words text-sm leading-6"><SafeRichMessage content={message.content} /></div>{message.resources.length > 0 && <ul className="mt-3 space-y-2" aria-label="Message attachments">{message.resources.map((resource) => <li key={resource.id} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs"><p className="font-medium text-stone-100">{resource.media_category === 'IMAGE' ? 'Image' : 'Document'} · {resource.original_filename || 'Attachment'}</p><p className="mt-1 text-stone-400">{resource.mime_type || 'Unknown type'} · {resource.processing_status}{resource.processing_status === 'FAILED' ? ' · Processing failed' : ''}</p></li>)}</ul>}</article>)}{messages.length === 0 && <EmptyState title="No messages yet" description="Messages will appear as the channel receives them." />}{messages.length > 0 && <div className="flex justify-between pt-2 text-xs text-stone-400"><button type="button" onClick={() => setMessageOffset((value) => Math.max(0, value - messagePageSize))} disabled={messageOffset === 0} className="disabled:opacity-40"><ChevronLeft className="inline" size={14} /> Previous messages</button><button type="button" onClick={() => setMessageOffset((value) => value + messagePageSize)} disabled={messages.length < messagePageSize} className="disabled:opacity-40">Next messages <ChevronRight className="inline" size={14} /></button></div>}</div>
          <footer className="border-t border-line bg-black/10 px-5 py-4">{canSend ? <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (content.trim()) send.mutate(); }}><label className="sr-only" htmlFor="agent-message">Reply as human agent</label><textarea id="agent-message" value={content} onChange={(event) => setContent(event.target.value)} className="field min-h-24 w-full resize-y" placeholder="Write a response to the customer…" maxLength={8000} /><div className="mt-3 flex justify-between gap-3"><p className="text-xs text-stone-500">{conversation.channel_type === 'WHATSAPP' ? 'Sent through the configured WhatsApp channel.' : 'Sent to the Samcheguide conversation feed.'}</p><button type="submit" disabled={!content.trim() || send.isPending} className="button-primary"><Send size={15} />Send</button></div>{send.error instanceof Error && <p role="alert" className="mt-2 text-xs text-red-300">{send.error.message}</p>}</form> : <p className="text-xs text-stone-400">{conversation.handling_mode === 'HUMAN' ? 'Only the assigned operator can reply.' : 'Take over to enable a supported human reply.'}</p>}</footer>
        </> : <EmptyState title="Conversation not found" description="This conversation is unavailable in the selected tenant." />}
      </section>

      <aside className="panel hidden p-5 xl:block"><p className="eyebrow">Conversation context</p>{conversation ? <div className="mt-5 space-y-6 text-sm"><div><p className="text-xs uppercase tracking-wide text-stone-500">Customer</p><p className="mt-2 break-all font-medium text-ink">{conversation.customer_external_id || 'Customer identifier unavailable'}</p><p className="mt-1 text-xs text-stone-400">{conversation.channel_display_name || conversation.channel_type}</p></div><div><p className="text-xs uppercase tracking-wide text-stone-500">Handling</p><p className="mt-2 flex items-center gap-2 font-medium text-ink"><UserRound size={15} />{handlingLabel(conversation.handling_mode)}</p><p className="mt-1 text-xs text-stone-400">{conversation.assigned_agent_email ? 'Assigned to ' + conversation.assigned_agent_email : 'No human operator assigned'}</p></div><div><p className="text-xs uppercase tracking-wide text-stone-500">AI</p><p className="mt-2 font-medium text-ink">{conversation.assistant_name || 'No assistant associated'}</p></div><div><p className="text-xs uppercase tracking-wide text-stone-500">Operational events</p><div className="mt-2 space-y-2">{eventsQuery.data?.length ? eventsQuery.data.map((event) => <p key={event.id} className="rounded border border-white/[0.06] bg-white/[0.025] px-2 py-2 text-xs text-stone-300">{event.event_type.split('_').join(' ')} · {formatDateTime(event.created_at)}</p>) : <p className="text-xs text-stone-500">No operational events yet.</p>}</div></div></div> : <p className="mt-5 text-sm text-stone-500">Select a conversation.</p>}</aside>
    </div>
  </div>;
}
