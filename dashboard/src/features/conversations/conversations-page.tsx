import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, BookOpenText, CircleX, Download, ExternalLink, FileText, Headphones, Image as ImageIcon, MessageSquareText, Mic, MoreHorizontal, Paperclip, Pause, Plus, Search, Send, Smile, UserRound, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDateTime } from '../../lib/format';
import { useAuth } from '../auth/auth-context';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { ApiError } from '../../lib/api-client';
import { useTenant } from '../tenants/tenant-context';
import { canTakeOverConversation, canUseHumanReplyComposer, clearSentAgentDraft, deliveryTickPresentation, displayConversationCustomerIdentifier, isInlinePreviewableAttachment, isVoiceResource, resourceDisplayName, senderLabel, voiceResourceDisplayLabel } from './conversation-utils';
import { buildVerifiedWhatsAppVoiceFile, selectWhatsAppVoiceRecordingFormat } from './voice-recording';
import { useLiveSupportAttention } from '../live-support/live-support-attention-provider';
import { SafeRichMessage } from './safe-rich-message';
import { useTenantConversationLiveEvents } from './use-live-conversation-events';
import { conversationCapabilities, conversationListLoadMoreLabel, type ConversationCapabilityKey, workspaceVisualIdentity } from './conversation-workspace-config';
import { shouldShowConversationWorkspaceSkeleton } from './conversation-list-search-state';

const pageSize = 25;
const maxConversationLimit = 100;
const messagePageSize = 50;

function handlingLabel(mode?: string) {
  return mode === 'HUMAN' ? 'Human handling' : mode === 'PAUSED' ? 'AI paused' : 'AI handling';
}

function supportedWhatsAppVoiceFormat() {
  if (!window.MediaRecorder) return null;
  return selectWhatsAppVoiceRecordingFormat((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function LiveState({ state }: { state: string }) {
  const label = state === 'connected' ? 'Live' : state === 'reconnecting' ? 'Reconnecting' : state === 'connecting' ? 'Connecting' : 'Offline';
  return <span className="inline-flex items-center gap-2 rounded-full border border-gold/20 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold"><span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>;
}

function deliveryIndicator(status?: string | null) {
  const tick = deliveryTickPresentation(status);
  if (!tick) return null;
  const tone = tick.tone === 'read' ? 'text-sky-300' : tick.tone === 'delivered' ? 'text-emerald-200' : tick.tone === 'failed' ? 'text-red-200' : '';
  return <span className={'ml-1 ' + tone} title={tick.label}>{tick.glyph}</span>;
}

function InlineVoicePlayer({ resource, tenantId, conversationId, tone }: { resource: { id: string; mime_type: string | null }; tenantId: string; conversationId: string; tone: 'inbound' | 'outbound' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void tenantApi.getConversationAttachment(tenantId, conversationId, resource.id, false).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => active && setFailed(true));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [tenantId, conversationId, resource.id]);
  if (failed) return <p className={tone === 'inbound' ? 'text-xs text-stone-600' : 'text-xs text-emerald-100'}>Voice message unavailable.</p>;
  return <div className="min-w-[17rem] max-w-[22rem]"><p className={'mb-1 text-[10px] font-semibold uppercase tracking-[.12em] ' + (tone === 'inbound' ? 'text-stone-500' : 'text-emerald-100/75')}>Voice message</p>{url ? <audio controls preload="metadata" src={url} className="h-9 w-full max-w-full" /> : <div className={'h-9 animate-pulse rounded-full ' + (tone === 'inbound' ? 'bg-stone-200/80' : 'bg-emerald-950/35')} />}</div>;
}

export function ConversationsPage() {
  const { selectedTenant, tenantRole } = useTenant();
  const { user } = useAuth();
  const { conversationId, channel } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const tenantId = selectedTenant?.id ?? '';
  const channelContext: { type: 'WEB_CHAT' | 'SAMCHEGUIDE' | 'WHATSAPP'; label: string } = channel === 'web-chat' ? { type: 'WEB_CHAT', label: 'Web Chatbot' } : channel === 'guide' ? { type: 'SAMCHEGUIDE', label: 'AI Guide' } : { type: 'WHATSAPP', label: 'WhatsApp' };
  const [conversationLimit, setConversationLimit] = useState(pageSize);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageSearchIndex, setMessageSearchIndex] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [content, setContent] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingVoicePreviewUrl, setPendingVoicePreviewUrl] = useState<string | null>(null);
  const [pendingVoiceDuration, setPendingVoiceDuration] = useState(0);
  const [voicePreviewPlaying, setVoicePreviewPlaying] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [newMessagesWaiting, setNewMessagesWaiting] = useState(false);
  const [firstNewMessageId, setFirstNewMessageId] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; mimeType: string; filename: string } | null>(null);
  const [resourcePanel, setResourcePanel] = useState<ConversationCapabilityKey | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const discardVoiceRecordingRef = useRef(false);
  const recorderSessionRef = useRef(0);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const atMessageBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const knownMessageCountRef = useRef(0);
  const liveState = useTenantConversationLiveEvents(tenantId, conversationId);
  const { refreshAttention } = useLiveSupportAttention();
  useEffect(() => {
    knownMessageCountRef.current = 0;
    setNewMessagesWaiting(false);
    setFirstNewMessageId(null);
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderSessionRef.current += 1;
    discardVoiceRecordingRef.current = true;
    if (recorder.state !== 'inactive') recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    setRecording(false);
    setRecordingSeconds(0);
    setPendingFile((current) => current?.type.startsWith('audio/') ? null : current);
  }, [conversationId]);
  useEffect(() => {
    const requestedSearch = searchParams.get('q')?.trim();
    if (requestedSearch) setSearch(requestedSearch);
  }, [searchParams]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setMessageSearchIndex(0);
  }, [messageSearch]);
  useEffect(() => {
    if (!pendingFile?.type.startsWith('audio/')) { setPendingVoicePreviewUrl(null); return; }
    const url = URL.createObjectURL(pendingFile);
    setPendingVoicePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const conversationsQuery = useQuery({
    queryKey: [...tenantKeys.conversations(tenantId, conversationLimit, 0), channelContext.type, debouncedSearch, statusFilter],
    queryFn: () => tenantApi.listConversations(tenantId, { limit: conversationLimit, offset: 0 }, { channelType: channelContext.type, search: debouncedSearch, status: statusFilter === 'all' ? undefined : statusFilter }),
    enabled: Boolean(tenantId),
    placeholderData: (previousData) => previousData,
  });
  const conversationQuery = useQuery({ queryKey: tenantKeys.conversation(tenantId, conversationId ?? ''), queryFn: () => tenantApi.getConversation(tenantId, conversationId ?? ''), enabled: Boolean(tenantId && conversationId) });
  useEffect(() => {
    if (!conversationId && conversationsQuery.data?.[0]?.id && tenantId) {
      navigate('/app/' + tenantId + '/conversations/' + channel + '/' + conversationsQuery.data[0].id, { replace: true });
    }
  }, [channel, conversationId, conversationsQuery.data, navigate, tenantId]);
  const messagesQuery = useInfiniteQuery({
    queryKey: ['tenant', tenantId, 'conversation', conversationId ?? '', 'messages', 'latest-window', messagePageSize],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => tenantApi.listMessages(tenantId, conversationId ?? '', { limit: messagePageSize, offset: pageParam }),
    getNextPageParam: (lastPage, _pages, lastPageParam) => lastPage.length === messagePageSize ? lastPageParam + messagePageSize : undefined,
    enabled: Boolean(tenantId && conversationId),
  });

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
  const sendMedia = useMutation({
    mutationFn: async ({ file, caption }: { file: File; caption: string }) => {
      if (file.type.startsWith('audio/')) console.info('VOICE_UPLOAD_STARTED');
      const result = await tenantApi.sendAgentMedia(tenantId, conversationId ?? '', file, caption, crypto.randomUUID());
      if (file.type.startsWith('audio/')) console.info('VOICE_UPLOAD_COMPLETED');
      return result;
    },
    onSuccess: async (_result, payload) => {
      if (payload.file.type.startsWith('audio/')) { console.info('VOICE_PERSISTED'); setVoicePreviewPlaying(false); setPendingVoiceDuration(0); }
      setPendingFile((current) => current === payload.file ? null : current);
      setContent((current) => clearSentAgentDraft(current, payload.caption));
      setAttachmentError(null);
      await refresh('agent-message');
    },
    onError: (error, payload) => {
      if (payload.file.type.startsWith('audio/')) {
        setAttachmentError('Voice message could not be sent. The recorded audio format was not accepted. Record a new note and try again.');
      }
    },
  });

  const chooseComposerFile = (file: File | undefined) => {
    if (!file) return;
    setVoicePreviewPlaying(false);
    setPendingVoiceDuration(0);
    setPendingFile(file);
  };
  const insertEmoji = (emoji: string) => {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? content.length;
    const end = input?.selectionEnd ?? content.length;
    setContent(content.slice(0, start) + emoji + content.slice(end));
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  const releaseVoiceRecorder = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    recorder?.stream.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setRecordingSeconds(0);
  };
  const stopVoiceRecording = () => {
    discardVoiceRecordingRef.current = false;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') { releaseVoiceRecorder(); return; }
    recorder.stop();
  };
  const cancelVoiceRecording = () => {
    discardVoiceRecordingRef.current = true;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') { releaseVoiceRecorder(); return; }
    recorder.stop();
  };
  const startVoiceRecording = async () => {
    const format = supportedWhatsAppVoiceFormat();
    console.info('VOICE_RECORDER_SUPPORT=' + Boolean(format));
    console.info('VOICE_RECORDER_MIME=' + (format?.recorderMime ?? 'none'));
    if (recording || recorderRef.current?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia || !format) { setAttachmentError('Voice notes are unavailable because this browser cannot produce a verified WhatsApp-compatible recording.'); return; }
    setAttachmentError(null);
    const session = recorderSessionRef.current + 1;
    recorderSessionRef.current = session;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: format.recorderMime });
      console.info('VOICE_SEND stage=BROWSER_FORMAT_SELECTED mime=' + recorder.mimeType);
      console.info('VOICE_RECORDING_STARTED');
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        releaseVoiceRecorder();
        console.info('VOICE_RECORDING_STOPPED');
        if (discardVoiceRecordingRef.current || recorderSessionRef.current !== session) {
          discardVoiceRecordingRef.current = false;
          return;
        }
        if (chunks.length) {
          void buildVerifiedWhatsAppVoiceFile(chunks, format, recorder.mimeType || format.recorderMime).then(({ file, detectedContainer }) => {
            if (recorderSessionRef.current !== session) return;
            console.info('VOICE_AUDIO_DIAGNOSTIC browser_requested_mime=' + format.recorderMime
              + ' browser_selected_mime=' + (recorder.mimeType || 'unknown')
              + ' blob_mime=' + file.type
              + ' blob_size=' + file.size
              + ' detected_container=' + detectedContainer);
            chooseComposerFile(file);
          }).catch(() => {
            if (recorderSessionRef.current === session) setAttachmentError('Unsupported or invalid voice recording format. No voice note was uploaded.');
          });
        }
      };
      discardVoiceRecordingRef.current = false;
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      releaseVoiceRecorder();
      setAttachmentError('Microphone access is unavailable in this browser.');
    }
  };


  const closeAttachmentPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setAttachmentPreview(null);
  };

  useEffect(() => () => {
    recorderSessionRef.current += 1;
    discardVoiceRecordingRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    releaseVoiceRecorder();
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
        link.download = resourceDisplayName(resource);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setAttachmentPreview({ url, mimeType: resource.mime_type || blob.type || 'application/octet-stream', filename: resourceDisplayName(resource) });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setAttachmentError(status === 403 ? 'You are not permitted to access this attachment.' : status === 404 ? 'This attachment is no longer available.' : 'This attachment is currently unavailable.');
    }
  };

  const conversations = conversationsQuery.data ?? [];
  const showConversationWorkspaceSkeleton = shouldShowConversationWorkspaceSkeleton({
    isLoading: conversationsQuery.isLoading,
    hasData: Boolean(conversationsQuery.data),
    search: debouncedSearch,
  });
  const conversation = conversationQuery.data;
  // API returns each window newest-first for efficient latest-first loading.
  // Render accumulated windows chronologically so the messaging timeline reads naturally.
  const messages = messagesQuery.data?.pages.slice().reverse().flatMap((page) => page.slice().reverse()) ?? [];
  const normalizedMessageSearch = messageSearch.trim().toLocaleLowerCase();
  const messageSearchMatches = normalizedMessageSearch ? messages.filter((message) => {
    const text = [message.content, ...message.resources.map((resource) => resourceDisplayName(resource))].filter(Boolean).join(' ').toLocaleLowerCase();
    return text.includes(normalizedMessageSearch);
  }) : [];
  const activeMessageSearchMatch = messageSearchMatches[messageSearchIndex] ?? null;
  useEffect(() => {
    if (!activeMessageSearchMatch) return;
    const element = document.querySelector('[data-message-id="' + activeMessageSearchMatch.id + '"]');
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeMessageSearchMatch?.id]);
  const loadOlderMessages = async () => {
    if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return;
    loadingOlderRef.current = true;
    const list = messageListRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    const previousTop = list?.scrollTop ?? 0;
    try {
      await messagesQuery.fetchNextPage();
      requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - previousHeight + previousTop;
      });
    } finally {
      loadingOlderRef.current = false;
    }
  };
  const scrollToLatest = () => {
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    atMessageBottomRef.current = true;
    setNewMessagesWaiting(false);
    setFirstNewMessageId(null);
  };
  const scrollToFirstNewMessage = () => {
    if (firstNewMessageId) {
      document.querySelector('[data-message-id="' + firstNewMessageId + '"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      scrollToLatest();
    }
    setNewMessagesWaiting(false);
    setFirstNewMessageId(null);
  };
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    const previous = knownMessageCountRef.current;
    knownMessageCountRef.current = messages.length;
    if (previous === 0 || atMessageBottomRef.current) {
      requestAnimationFrame(() => requestAnimationFrame(scrollToLatest));
    } else if (!loadingOlderRef.current && messages.length > previous) {
      setFirstNewMessageId(messages[previous]?.id ?? messages[messages.length - 1]?.id ?? null);
      setNewMessagesWaiting(true);
    }
  }, [conversationId, messages.length]);
  const isAdmin = user?.system_role === 'OWNER' || tenantRole === 'ADMIN';
  const isAgent = tenantRole === 'AGENT';
  const isOwn = conversation?.assigned_agent_user_id === user?.id;
  const canTakeOver = canTakeOverConversation({ status: conversation?.status, handlingMode: conversation?.handling_mode, assignedAgentUserId: conversation?.assigned_agent_user_id, humanAttentionState: conversation?.human_attention_state, operatorAllowed: isAdmin || isAgent });
  const canReturn = Boolean(conversation && conversation.status === 'open' && conversation.handling_mode === 'HUMAN' && (isAdmin || (isAgent && isOwn)));
  const canSend = Boolean(conversation && conversation.status === 'open' && canUseHumanReplyComposer(conversation.channel_type, conversation.human_delivery_configured) && conversation.handling_mode === 'HUMAN' && (isAdmin || (isAgent && isOwn)));
  const messageMetrics = {
    total: messages.length,
    customer: messages.filter((message) => message.sender_type === 'CUSTOMER').length,
    assistant: messages.filter((message) => message.sender_type === 'ASSISTANT').length,
    agent: messages.filter((message) => message.sender_type === 'AGENT').length,
    attachments: messages.reduce((total, message) => total + message.resources.length, 0),
  };

  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its conversations." />;
  if (showConversationWorkspaceSkeleton) return <div className="space-y-5"><SkeletonBlock className="h-16 w-72" /><SkeletonBlock className="h-[38rem]" /></div>;

  return <div className="mx-auto max-w-[1600px] space-y-3">
    <header className={'relative overflow-hidden rounded-2xl border px-5 py-4 shadow-panel ' + (channelContext.type === 'WHATSAPP' ? 'border-emerald-500/20 bg-[#081713]' : 'border-signal/25 bg-[radial-gradient(circle_at_82%_0%,rgba(212,33,41,.16),transparent_22rem),#0a111b]')}><div className="relative flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow">{channelContext.type === 'WHATSAPP' ? 'Live customer inbox' : 'SamChe customer workspace'}</p><h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">Conversations <span className="text-stone-500">/</span> <span className={channelContext.type === 'WHATSAPP' ? 'text-whatsapp-400' : 'text-ink'}>{channelContext.label}</span></h1></div><LiveState state={liveState} /></div></header>
    <section aria-label="Conversation capabilities" className="glass-surface flex w-fit max-w-full flex-wrap items-center overflow-hidden rounded-xl">
      {conversationCapabilities.map((capability, index) => <button key={capability.key} type="button" onClick={() => setResourcePanel(capability.key)} className={'inline-flex items-center gap-2 border border-transparent px-3.5 py-2.5 text-xs font-semibold text-stone-200 transition hover:border-emerald-400/35 hover:bg-emerald-400/[.08] hover:text-white ' + (resourcePanel === capability.key ? 'border-emerald-400/40 bg-emerald-400/[.12] text-emerald-50 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_0_18px_rgba(34,197,94,.10)] ' : '') + (index ? 'border-l-white/[.07]' : '')}>
        {capability.key === 'documents' ? <BookOpenText size={15} /> : capability.key === 'voice' ? <Headphones size={15} /> : <ImageIcon size={15} />}{capability.label}
      </button>)}
    </section>
    <div className="grid h-[calc(100vh-14rem)] min-h-[38rem] gap-2 xl:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(18rem,22rem)]">
      <section className={'dashboard-card flex min-h-0 flex-col overflow-hidden rounded-lg ' + (conversationId ? 'hidden xl:flex' : '')}>
        <header className="border-b border-line bg-elevated/35 px-4 py-3.5"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-ink">{channelContext.label}</p><p className="mt-1 text-xs text-stone-400">Most recent activity first</p></div><span className="rounded border border-white/10 px-2 py-1 text-[10px] text-stone-400">{conversations.length}</span></div><label className={'relative mt-4 block ' + (channelContext.type === 'WHATSAPP' ? 'rounded-xl border-2 border-red-500/90 p-1 shadow-[0_0_0_2px_rgba(239,68,68,.22),0_0_20px_rgba(239,68,68,.20)]' : '')}><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setConversationLimit(pageSize); }} className="field w-full !py-2 !pl-9 text-xs" placeholder="Search conversations" aria-label="Search conversations" /></label><div className="mt-3 flex gap-1.5" role="group" aria-label="Conversation status filters">{(['all', 'open', 'closed'] as const).map((value) => <button type="button" key={value} onClick={() => { setStatusFilter(value); setConversationLimit(pageSize); }} className={'rounded-md px-2.5 py-1 text-[10px] font-medium capitalize ' + (statusFilter === value ? 'bg-[#159b61] text-white' : 'border border-white/10 text-stone-400 hover:bg-white/[.04]')}>{value}</button>)}</div></header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#09111B]">{conversationsQuery.isError ? <div className="p-5"><p className="text-sm font-medium text-red-200">Unable to search conversations.</p><button type="button" onClick={() => void conversationsQuery.refetch()} className="mt-3 rounded-lg border border-red-300/30 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/10">Retry</button></div> : conversations.length === 0 ? <div className="p-5"><EmptyState title={debouncedSearch ? 'No conversations found' : 'No conversations yet'} description={debouncedSearch ? 'Try another name, phone number, or message phrase.' : 'Connected channel traffic will appear here.'} icon={<MessageSquareText size={20} />} /></div> : <ul className="divide-y divide-line">{conversations.map((item) => <li key={item.id}><Link to={'/app/' + tenantId + '/conversations/' + channel + '/' + item.id} className={'block border-l-2 border-transparent px-4 py-3 transition hover:bg-white/[0.035] ' + (item.id === conversationId ? (channelContext.type === 'WHATSAPP' ? 'border-emerald-400 bg-emerald-400/[.10] shadow-[inset_0_0_22px_rgba(34,197,94,.07)] ' : 'border-signal bg-elevated/80 ') : '') + (item.human_attention_state === 'REQUESTED' ? 'border-red-400 bg-red-500/10 ring-1 ring-inset ring-red-400/30' : '')}><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-[#152231] text-xs font-semibold text-stone-300">{item.contact_display_name ? item.contact_display_name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() : <UserRound size={19} aria-label="Customer avatar" />}</span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-sm font-semibold text-ink">{item.contact_display_name || displayConversationCustomerIdentifier(item.customer_external_id || item.external_conversation_id)}</p><time className="shrink-0 text-[11px] text-stone-500">{formatDateTime(item.last_activity_at || item.created_at)}</time></div><p className="mt-1 truncate text-xs text-stone-400">{item.last_message_preview || item.channel_display_name || 'No message preview'}</p></div></div><div className="mt-3 flex gap-1.5"><span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-stone-300">{handlingLabel(item.handling_mode)}</span>{item.human_attention_state === 'REQUESTED' && <span className="rounded border border-red-400/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-[0.1em] text-red-200">LIVE SUPPORT</span>}</div></Link></li>)}</ul>}</div>
        <footer className="flex justify-center border-t border-line bg-elevated/35 px-3 py-2.5">{conversationLimit < maxConversationLimit && conversations.length >= conversationLimit && <button type="button" onClick={() => setConversationLimit((limit) => Math.min(maxConversationLimit, limit + pageSize))} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-stone-300 transition hover:border-white/20 hover:bg-white/[.04]">{conversationListLoadMoreLabel}</button>}</footer>
      </section>

      <section className={'dashboard-card flex min-h-[42rem] flex-col overflow-hidden rounded-lg ' + (!conversationId ? 'hidden xl:flex' : '')}>
        {!conversationId ? <EmptyState title="Select a conversation" description="Choose an inbox item to inspect its real message history." icon={<MessageSquareText size={22} />} /> : conversationQuery.isLoading || messagesQuery.isLoading ? <div className="space-y-4 p-5"><SkeletonBlock className="h-20" /><SkeletonBlock className="h-80" /></div> : conversationQuery.isError || messagesQuery.isError ? <QueryErrorState error={conversationQuery.error ?? messagesQuery.error!} onRetry={() => { void conversationQuery.refetch(); void messagesQuery.refetch(); }} resource="conversation" /> : conversation ? <>
          <header className="relative border-b border-line bg-elevated/35 px-5 py-3.5"><div className="flex flex-wrap items-center justify-between gap-3"><div><Link to={'/app/' + tenantId + '/conversations'} className="text-xs text-stone-400 xl:hidden">← Inbox</Link><p className="mt-1 text-base font-semibold text-ink">{conversation.contact_display_name || displayConversationCustomerIdentifier(conversation.customer_external_id)}</p><p className="mt-1 text-xs text-stone-400">{conversation.contact_phone || displayConversationCustomerIdentifier(conversation.customer_external_id)} · {conversation.channel_display_name || channelContext.label} · {handlingLabel(conversation.handling_mode)}</p></div><div className="relative flex items-center gap-2"><button type="button" onClick={() => setMessageSearchOpen((open) => !open)} className={'grid h-9 w-9 place-items-center rounded-lg border text-stone-200 transition hover:bg-white/[.06] ' + (messageSearchOpen ? (channelContext.type === 'WHATSAPP' ? 'border-emerald-300/60 bg-emerald-500/15' : 'border-red-300/60 bg-red-500/15') : 'border-line bg-black/10')} aria-label="Search in conversation"><Search size={16} /></button>{canTakeOver && <button type="button" onClick={() => operation.mutate('takeover')} className="inline-flex items-center gap-1.5 rounded-lg border border-gold/35 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold shadow-[0_0_20px_rgba(224,169,79,.1)] transition hover:bg-gold/20"><Headphones size={15} />Take Over</button>}{canReturn && <button type="button" onClick={() => operation.mutate('return')} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/20"><Bot size={15} />Return to AI</button>}{isAdmin && conversation.handling_mode === 'AI' && <button type="button" onClick={() => operation.mutate('pause')} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-black/10 px-3 py-2 text-xs font-medium text-stone-200 hover:bg-white/[.06]"><Pause size={14} />Pause AI</button>}<button type="button" aria-label="Conversation actions" aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)} className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-black/10 text-stone-300 transition hover:bg-white/[.06] hover:text-white"><MoreHorizontal size={18} /></button>{actionsOpen && <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-xl border border-line bg-[#101a27] p-1.5 shadow-2xl"><p className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.16em] text-stone-500">Conversation actions</p>{isAdmin && conversation.handling_mode === 'PAUSED' && <button type="button" onClick={() => { setActionsOpen(false); operation.mutate('resume'); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-stone-200 hover:bg-white/[.06]"><Pause size={14} />Resume AI</button>}{isAdmin && conversation.status === 'open' && <button type="button" onClick={() => { setActionsOpen(false); operation.mutate('close'); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"><CircleX size={14} />Close conversation</button>}</div>}</div></div>{messageSearchOpen && <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-black/15 p-2"><Search size={15} className={channelContext.type === 'WHATSAPP' ? 'text-emerald-300' : 'text-red-300'} /><input autoFocus value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setMessageSearchOpen(false); setMessageSearch(''); } if (event.key === 'ArrowDown' && messageSearchMatches.length) { event.preventDefault(); setMessageSearchIndex((index) => (index + 1) % messageSearchMatches.length); } if (event.key === 'ArrowUp' && messageSearchMatches.length) { event.preventDefault(); setMessageSearchIndex((index) => (index - 1 + messageSearchMatches.length) % messageSearchMatches.length); } }} className="min-w-0 flex-1 bg-transparent px-1 py-1 text-xs text-ink outline-none placeholder:text-stone-500" placeholder="Search in conversation" aria-label="Search in conversation" /><span className="shrink-0 text-[11px] text-stone-400">{messageSearch ? (messageSearchMatches.length ? (messageSearchIndex + 1) + ' of ' + messageSearchMatches.length : 'No matches') : 'Search messages'}</span><button type="button" onClick={() => messageSearchMatches.length && setMessageSearchIndex((index) => (index - 1 + messageSearchMatches.length) % messageSearchMatches.length)} disabled={!messageSearchMatches.length} className="rounded px-1.5 py-1 text-stone-300 hover:bg-white/[.06] disabled:opacity-40" aria-label="Previous match">↑</button><button type="button" onClick={() => messageSearchMatches.length && setMessageSearchIndex((index) => (index + 1) % messageSearchMatches.length)} disabled={!messageSearchMatches.length} className="rounded px-1.5 py-1 text-stone-300 hover:bg-white/[.06] disabled:opacity-40" aria-label="Next match">↓</button><button type="button" onClick={() => { setMessageSearchOpen(false); setMessageSearch(''); }} className="grid h-7 w-7 place-items-center rounded text-stone-300 hover:bg-white/[.06]" aria-label="Close message search"><X size={15} /></button></div>}{operation.error instanceof Error && <p role="alert" className="mt-3 text-xs text-red-300">{operation.error.message}</p>}</header>
          {resourcePanel && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={resourcePanel === 'documents' ? 'Document Reading' : resourcePanel === 'voice' ? 'Voice Messages' : 'Images and Media'}><section className="glass-surface flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"><header className="flex items-center justify-between border-b border-line px-5 py-3.5"><div><p className="text-sm font-semibold text-ink">{resourcePanel === 'documents' ? 'Document Reading' : resourcePanel === 'voice' ? 'Voice Messages' : 'Images & Media'}</p><p className="mt-1 text-xs text-stone-400">Current conversation only</p></div><button type="button" onClick={() => setResourcePanel(null)} aria-label="Close resource panel" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-stone-300 hover:bg-white/[.06]"><X size={16} /></button></header><div className="subtle-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{messages.flatMap((message) => message.resources.map((resource) => ({ message, resource }))).filter(({ resource }) => resourcePanel === 'documents' ? resource.media_category === 'DOCUMENT' || resource.mime_type === 'application/pdf' : resourcePanel === 'voice' ? Boolean(resource.mime_type?.startsWith('audio/')) : resource.media_category === 'IMAGE' || Boolean(resource.mime_type?.startsWith('image/'))).map(({ message, resource }) => <article key={resource.id} className="flex items-center gap-3 rounded-xl border border-line bg-black/15 p-3"><span className="icon-orb h-9 w-9 text-gold">{resourcePanel === 'voice' ? <Headphones size={16} /> : resourcePanel === 'documents' ? <FileText size={16} /> : <ImageIcon size={16} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{resource.original_filename || (resourcePanel === 'voice' ? 'Voice message' : resourcePanel === 'documents' ? 'Document' : 'Image')}</p><p className="mt-1 text-[11px] text-stone-500">{resource.mime_type || 'Unknown type'}{resource.size_bytes ? ' · ' + Math.ceil(resource.size_bytes / 1024) + ' KB' : ''} · {formatDateTime(message.created_at)}</p></div><div className="flex gap-2">{(isInlinePreviewableAttachment(resource.mime_type) || Boolean(resource.mime_type?.startsWith('audio/'))) && <button type="button" onClick={() => void openAttachment(resource, false)} className="text-xs font-medium text-gold hover:text-gold/80">{resourcePanel === 'voice' ? 'Play' : 'View'}</button>}<button type="button" onClick={() => void openAttachment(resource, true)} className="text-xs font-medium text-gold hover:text-gold/80">Download</button></div></article>)}{messages.flatMap((message) => message.resources).filter((resource) => resourcePanel === 'documents' ? resource.media_category === 'DOCUMENT' || resource.mime_type === 'application/pdf' : resourcePanel === 'voice' ? Boolean(resource.mime_type?.startsWith('audio/')) : resource.media_category === 'IMAGE' || Boolean(resource.mime_type?.startsWith('image/'))).length === 0 && <p className="py-10 text-center text-sm text-stone-500">{resourcePanel === 'documents' ? 'No documents in this conversation.' : resourcePanel === 'voice' ? 'No voice messages in this conversation.' : 'No media in this conversation.'}</p>}</div></section></div>}
          {attachmentPreview && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Attachment preview">
            <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-2xl">
              <header className="flex items-center justify-between border-b border-line px-5 py-3"><div className="min-w-0"><p className="text-sm font-semibold text-ink">Attachment preview</p><p className="truncate text-xs text-stone-400">{attachmentPreview.filename}</p></div><button type="button" onClick={closeAttachmentPreview} className="button-secondary h-9 w-9 !p-0" aria-label="Close attachment preview"><X size={17} /></button></header>
              <div className="min-h-0 flex-1 overflow-auto bg-black/30 p-4">{attachmentPreview.mimeType.startsWith('image/') ? <img src={attachmentPreview.url} alt={attachmentPreview.filename} className="mx-auto max-h-[72vh] max-w-full object-contain" /> : attachmentPreview.mimeType === 'application/pdf' ? <iframe title={attachmentPreview.filename} src={attachmentPreview.url} className="h-[72vh] w-full rounded border border-line bg-white" /> : attachmentPreview.mimeType.startsWith('audio/') ? <div className="grid h-52 place-items-center"><audio controls autoPlay src={attachmentPreview.url} className="w-full max-w-xl" /></div> : <p className="text-sm text-stone-300">Preview is unavailable for this file type.</p>}</div>
              <footer className="flex justify-end border-t border-line px-5 py-3"><a href={attachmentPreview.url} download={attachmentPreview.filename} className="button-primary"><Download size={15} />Download</a></footer>
            </section>
          </div>}
          <div ref={messageListRef} onScroll={(event) => { const element = event.currentTarget; atMessageBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72; if (atMessageBottomRef.current) { setNewMessagesWaiting(false); setFirstNewMessageId(null); } if (element.scrollTop < 64) void loadOlderMessages(); }} className={"subtle-scrollbar flex-1 space-y-3 overflow-y-auto p-4 sm:p-5 [background-image:radial-gradient(circle_at_20%_20%,rgba(80,108,124,.11)_1px,transparent_1px),radial-gradient(circle_at_80%_75%,rgba(65,112,95,.10)_1px,transparent_1px)] [background-size:22px_22px] " + workspaceVisualIdentity(channelContext.type).canvas}>{messagesQuery.hasNextPage && <div className="flex justify-center"><button type="button" onClick={() => void loadOlderMessages()} disabled={messagesQuery.isFetchingNextPage} className="rounded border border-white/10 px-3 py-1.5 text-xs text-stone-300 hover:bg-white/[0.04] disabled:opacity-50">{messagesQuery.isFetchingNextPage ? 'Loading earlier messages…' : 'Load earlier messages'}</button></div>}{messages.map((message) => {
            const isCustomer = message.sender_type === 'CUSTOMER';
            const isAgentMessage = message.sender_type === 'AGENT';
            const identity = workspaceVisualIdentity(channelContext.type);
            const bubbleTone = isCustomer ? 'border-black/10 bg-[#f7f7f3] text-[#142018]' : identity.outgoing;
            const contactIdentity = conversation.contact_display_name || conversation.contact_phone || displayConversationCustomerIdentifier(conversation.customer_external_id);
            const technicalVoicePlaceholder = message.resources.some(isVoiceResource) && /^\[AUDIO:/i.test(message.content ?? '');
            const isActiveSearchMatch = activeMessageSearchMatch?.id === message.id;
            return <div key={message.id} data-message-id={message.id} className={'flex scroll-mt-24 ' + (isCustomer ? 'justify-start' : 'justify-end')}><article className={'w-fit max-w-[74%] rounded-2xl border px-3.5 py-2.5 shadow-sm transition ' + bubbleTone + (isActiveSearchMatch ? (channelContext.type === 'WHATSAPP' ? ' ring-2 ring-emerald-300/75' : ' ring-2 ring-red-300/75') : '')}><div className="flex items-center justify-between gap-4 text-[10px] opacity-65"><span className="font-semibold uppercase tracking-[0.1em]">{isAgentMessage ? 'AGENT' : senderLabel(message.sender_type)}</span><time>{formatDateTime(message.created_at)}{!isCustomer && deliveryIndicator(message.delivery_status)}</time></div>{message.content && !technicalVoicePlaceholder && <div className="mt-1.5 min-w-0 break-words text-sm leading-6"><SafeRichMessage content={message.content} /></div>}{message.resources.length > 0 && <ul className="mt-3 grid gap-2" aria-label="Message attachments">{message.resources.map((resource) => isVoiceResource(resource) ? <li key={resource.id} className="max-w-full"><InlineVoicePlayer resource={resource} tenantId={tenantId} conversationId={conversationId ?? ''} tone={isCustomer ? 'inbound' : 'outbound'} /><p className={'mt-1 text-[10px] ' + (isCustomer ? 'text-stone-500' : 'text-emerald-100/75')}>{isCustomer ? contactIdentity : 'AGENT'} · {formatDateTime(message.created_at)}</p></li> : <li key={resource.id} className="rounded-xl border border-white/10 bg-black/20 p-2.5 text-xs"><div className="flex items-start gap-2.5">{resource.media_category === 'IMAGE' ? <ImageIcon className="mt-0.5 shrink-0 text-gold" size={17} /> : <FileText className="mt-0.5 shrink-0 text-gold" size={17} />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{resourceDisplayName(resource)}</p><p className="mt-0.5 text-stone-400">{resource.mime_type || 'Unknown type'}{resource.size_bytes ? ' · ' + Math.ceil(resource.size_bytes / 1024) + ' KB' : ''}</p><div className="mt-2 flex flex-wrap gap-2">{resource.processing_status !== 'FAILED' && isInlinePreviewableAttachment(resource.mime_type) && <button type="button" onClick={() => void openAttachment(resource, false)} className={'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[#09111B] ' + (channelContext.type === 'WHATSAPP' ? 'border-emerald-300/60 bg-emerald-500/18 hover:bg-emerald-500/30 focus:ring-emerald-300' : 'border-red-300/60 bg-red-500/18 hover:bg-red-500/30 focus:ring-red-300')}><ExternalLink size={13} />View</button>}<button type="button" onClick={() => void openAttachment(resource, true)} className={'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[#09111B] ' + (channelContext.type === 'WHATSAPP' ? 'border-emerald-300/60 bg-emerald-500/18 hover:bg-emerald-500/30 focus:ring-emerald-300' : 'border-red-300/60 bg-red-500/18 hover:bg-red-500/30 focus:ring-red-300')}><Download size={13} />Download</button></div></div></div></li>)}</ul>}</article></div>;
          })}{messages.length === 0 && <EmptyState title="No messages yet" description="Messages will appear as the channel receives them." />}{newMessagesWaiting && <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center"><button type="button" onClick={scrollToFirstNewMessage} className={'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold text-white shadow-[0_10px_28px_rgba(0,0,0,.35)] backdrop-blur-xl transition ' + (channelContext.type === 'WHATSAPP' ? 'border-emerald-200/45 bg-emerald-950/85 hover:bg-emerald-900/95' : 'border-red-200/45 bg-red-950/85 hover:bg-red-900/95')}>New messages <span aria-hidden="true">↓</span></button></div>}</div>
          {attachmentError && <p role="alert" className="mx-5 mt-3 text-xs text-red-300">{attachmentError}</p>}<footer className="border-t border-line bg-elevated/35 px-3 py-3">
            {canSend ? <form onKeyDown={(event) => { if (pendingFile?.type.startsWith('audio/') && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.requestSubmit(); } }} onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              if (send.isPending || sendMedia.isPending) return;
              if (recording) { stopVoiceRecording(); return; }
              if (pendingFile) { sendMedia.mutate({ file: pendingFile, caption: content.trim() }); return; }
              if (content.trim()) send.mutate(content.trim());
            }}>
              <input ref={documentInputRef} className="hidden" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => { chooseComposerFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
              <input ref={imageInputRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseComposerFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
              <div className={'relative flex items-center gap-1.5 rounded-2xl border bg-[#08131e]/90 px-2 py-2 shadow-inner ' + (channelContext.type === 'WHATSAPP' ? 'border-emerald-400/30 shadow-emerald-950/30' : 'border-signal/30 shadow-red-950/25')}>
                <button type="button" onClick={() => documentInputRef.current?.click()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-stone-300 transition hover:bg-white/[.07] hover:text-white" aria-label="Add document"><Plus size={20} /></button>
                {recording ? <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-sm text-red-100"><button type="button" onClick={cancelVoiceRecording} className="shrink-0 rounded-full px-2 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/15" aria-label="Cancel voice recording">Cancel</button><Mic size={16} className="shrink-0 text-red-300" /><span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-400" /><span className="shrink-0 font-medium">Recording {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</span><span className="min-w-0 flex-1 border-t border-dashed border-red-300/35" /><span className="hidden text-xs text-red-200/75 sm:inline">Tap to cancel</span><button type="button" onClick={stopVoiceRecording} className="shrink-0 rounded-full bg-red-500/18 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/28" aria-label="Stop and prepare voice recording">Stop</button></div> : pendingFile?.type.startsWith('audio/') ? <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-sm"><audio ref={voicePreviewAudioRef} src={pendingVoicePreviewUrl ?? undefined} className="hidden" onLoadedMetadata={(event) => setPendingVoiceDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onEnded={() => setVoicePreviewPlaying(false)} /><button type="button" onClick={() => { const audio = voicePreviewAudioRef.current; if (!audio) return; if (audio.paused) { void audio.play().then(() => setVoicePreviewPlaying(true)).catch(() => setAttachmentError('Voice preview could not start.')); } else { audio.pause(); setVoicePreviewPlaying(false); } }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/25" aria-label={voicePreviewPlaying ? 'Pause voice note' : 'Play voice note'}>{voicePreviewPlaying ? 'Ⅱ' : '▶'}</button><span className="font-medium text-stone-100">{sendMedia.isPending ? 'Sending voice message…' : 'Voice note'}</span><span className="min-w-0 flex-1 border-t border-dashed border-emerald-300/35" /><span className="tabular-nums text-xs text-stone-300">{String(Math.floor(pendingVoiceDuration / 60)).padStart(2, '0')}:{String(Math.floor(pendingVoiceDuration % 60)).padStart(2, '0')}</span><button type="button" onClick={() => { voicePreviewAudioRef.current?.pause(); setVoicePreviewPlaying(false); setPendingVoiceDuration(0); setPendingFile(null); setAttachmentError(null); }} disabled={sendMedia.isPending} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-stone-300 hover:bg-white/[.07] hover:text-red-200 disabled:opacity-50" aria-label="Delete voice note">⌫</button><button type="submit" disabled={sendMedia.isPending} className={'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-white disabled:opacity-50 ' + (channelContext.type === 'WHATSAPP' ? 'bg-[#159b61] hover:bg-[#118452]' : 'bg-signal hover:bg-signal/85')} aria-label="Send voice note"><Send size={15} />{sendMedia.isPending ? 'Sending…' : sendMedia.isError ? 'Retry' : 'Send'}</button></div> : <><label className="sr-only" htmlFor="agent-message">Reply as human agent</label><textarea ref={composerInputRef} id="agent-message" value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} className="min-h-9 max-h-28 flex-1 resize-none border-0 !bg-transparent px-1 py-2 text-sm outline-none placeholder:text-stone-500" placeholder={pendingFile ? 'Add an optional caption…' : 'Type a message…'} maxLength={8000} rows={1} />
                <div className="relative"><button type="button" onClick={() => setEmojiOpen((open) => !open)} className="grid h-9 w-9 place-items-center rounded-full text-stone-300 hover:bg-white/[.07] hover:text-white" aria-label="Insert emoji"><Smile size={19} /></button>{emojiOpen && <div className="absolute bottom-11 right-0 z-30 flex gap-1 rounded-xl border border-line bg-[#101a27] p-2 shadow-xl">{['😀','😁','😂','😊','😍','🤝','👍','👏','🙏','❤️','🎉','✅','💼','📌','📎','🌟','🔥','👋','🤔','😢','😮','📞','🏢','✈️'].map((emoji) => <button key={emoji} type="button" onClick={() => insertEmoji(emoji)} className="grid h-7 w-7 place-items-center rounded hover:bg-white/[.08]" aria-label={'Insert ' + emoji}>{emoji}</button>)}</div>}</div>
                <button type="button" onClick={() => documentInputRef.current?.click()} className="grid h-9 w-9 place-items-center rounded-full text-stone-300 hover:bg-white/[.07] hover:text-white" aria-label="Send document"><Paperclip size={19} /></button>
                <button type="button" onClick={() => imageInputRef.current?.click()} className="grid h-9 w-9 place-items-center rounded-full text-stone-300 hover:bg-white/[.07] hover:text-white" aria-label="Send image"><ImageIcon size={19} /></button>
                {content.trim() || pendingFile ? <button type="submit" disabled={send.isPending || sendMedia.isPending} className={'grid h-10 min-w-10 place-items-center rounded-full text-white disabled:opacity-50 ' + (channelContext.type === 'WHATSAPP' ? 'bg-[#159b61] hover:bg-[#118452]' : 'bg-signal hover:bg-signal/85')} aria-label={pendingFile ? 'Send attachment' : 'Send message'}><Send size={17} /></button> : (typeof window !== 'undefined' && Boolean(supportedWhatsAppVoiceFormat()) ? <button type="button" onClick={() => void startVoiceRecording()} className={'grid h-10 w-10 place-items-center rounded-full text-white ' + (channelContext.type === 'WHATSAPP' ? 'bg-[#159b61] hover:bg-[#118452]' : 'bg-signal hover:bg-signal/85')} aria-label="Record voice note"><Mic size={18} /></button> : <span className="grid h-10 w-10 place-items-center rounded-full bg-white/[.04] text-stone-600" title="Voice notes are unavailable in this browser"><Mic size={18} /></span>)}</>}</div>
              {pendingFile && !pendingFile.type.startsWith('audio/') && <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-black/15 px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate text-stone-300">{pendingFile.name} · {Math.ceil(pendingFile.size / 1024)} KB</span><button type="button" onClick={() => setPendingFile(null)} className="text-stone-400 hover:text-white">Remove</button></div>}
              {(send.error instanceof Error || (sendMedia.error instanceof Error && !pendingFile?.type.startsWith('audio/'))) && <p role="alert" className="mt-2 text-xs text-red-300">{(send.error ?? sendMedia.error as Error).message}</p>}
            </form> : <p className="text-xs text-stone-400">{conversation.handling_mode === 'HUMAN' ? 'Only the assigned operator can reply.' : 'Take over to enable a supported human reply.'}</p>}
          </footer>
        </> : <EmptyState title="Conversation not found" description="This conversation is unavailable in the selected tenant." />}
      </section>

      <aside className="dashboard-card hidden min-h-0 overflow-y-auto rounded-lg bg-[#09111B] p-3 xl:block">{conversation ? <div className="space-y-3">
        <section className="rounded-lg border border-line bg-elevated/45 p-4"><p className="text-[10px] font-semibold tracking-[0.16em] text-stone-500">CONTACT INFORMATION</p><p className="mt-3 break-all text-sm font-semibold text-ink">{conversation.contact_display_name || (conversation.customer_external_id ? displayConversationCustomerIdentifier(conversation.customer_external_id) : 'Customer identifier unavailable')}</p><dl className="mt-3 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-stone-500">Phone</dt><dd className="text-right text-stone-200">{conversation.contact_phone || (conversation.customer_external_id ? displayConversationCustomerIdentifier(conversation.customer_external_id) : '—')}</dd></div><div className="flex justify-between gap-3"><dt className="text-stone-500">Language</dt><dd className="text-right text-stone-200">{({ tr: 'Turkish', en: 'English', ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German' } as Record<string, string>)[conversation.communication_language || conversation.contact_language || ''] || '—'}</dd></div><div className="flex justify-between gap-3"><dt className="text-stone-500">Country</dt><dd className="text-right text-stone-200">{conversation.contact_country || '—'}</dd></div><div className="flex justify-between gap-3"><dt className="text-stone-500">Channel</dt><dd className="text-right text-stone-200">{conversation.channel_display_name || channelContext.label}</dd></div><div className="flex justify-between gap-3"><dt className="text-stone-500">Last activity</dt><dd className="text-right text-stone-200">{formatDateTime(conversation.last_activity_at)}</dd></div></dl></section>
        <section className="rounded-lg border border-line bg-elevated/45 p-4"><p className="text-[10px] font-semibold tracking-[0.16em] text-stone-500">AI AUTOMATION</p><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between gap-3"><span>AI Reply</span><span className={conversation.handling_mode === 'AI' ? 'text-emerald-300' : 'text-stone-400'}>{conversation.handling_mode === 'AI' ? 'Active' : 'Paused'}</span></div><div className="flex justify-between gap-3"><span>Human Handling</span><span className={conversation.handling_mode === 'HUMAN' ? 'text-gold' : 'text-stone-400'}>{conversation.handling_mode === 'HUMAN' ? 'Active' : 'Inactive'}</span></div><div className="flex justify-between gap-3"><span>Document Reading</span><span className={messageMetrics.attachments > 0 ? 'text-emerald-300' : 'text-stone-400'}>{messageMetrics.attachments > 0 ? 'Available' : 'Unavailable'}</span></div></div></section>
        <section className="rounded-lg border border-line bg-elevated/45 p-4"><p className="text-[10px] font-semibold tracking-[0.16em] text-stone-500">CONVERSATION ANALYTICS</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border border-line/70 bg-[#09111B] p-2.5"><p className="text-stone-500">Messages</p><p className="mt-1 text-base font-semibold text-ink">{messageMetrics.total}</p></div><div className="rounded-lg border border-line/70 bg-[#09111B] p-2.5"><p className="text-stone-500">Attachments</p><p className="mt-1 text-base font-semibold text-ink">{messageMetrics.attachments}</p></div><div className="rounded-lg border border-line/70 bg-[#09111B] p-2.5"><p className="text-stone-500">Customer</p><p className="mt-1 text-base font-semibold text-ink">{messageMetrics.customer}</p></div><div className="rounded-lg border border-line/70 bg-[#09111B] p-2.5"><p className="text-stone-500">AI / Agent</p><p className="mt-1 text-base font-semibold text-ink">{messageMetrics.assistant + messageMetrics.agent}</p></div></div><div className="mt-3 border-t border-white/[0.06] pt-3 text-xs"><p className="font-medium text-ink">{conversation.human_attention_state === 'REQUESTED' ? 'LIVE SUPPORT WAITING' : handlingLabel(conversation.handling_mode)}</p><p className="mt-1 text-stone-500">{conversation.assigned_agent_user_id ? 'Handled by SamChe Support' : 'No operator assigned'}</p></div></section>
      </div> : <p className="mt-5 text-sm text-stone-500">Select a conversation.</p>}</aside>
    </div>
  </div>;
}
