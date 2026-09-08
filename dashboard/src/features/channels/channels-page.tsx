import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ui/confirmation-dialog';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { MutationFeedback } from '../../components/ui/mutation-feedback';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { selectTenantAssistants } from '../resources/resource-utils';
import { useTenant } from '../tenants/tenant-context';
import type { Assistant, TenantChannel } from '../../types/api';
import { ApiError } from '../../lib/api-client';

type ChannelPayload = Omit<TenantChannel, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>;
export interface WhatsAppOwnershipConflict {
  ownership: 'OTHER_TENANT';
  external_channel_id: string;
  transfer_required: true;
  source_channel_id?: string;
  source_tenant_id?: string;
  platform_transfer_available?: boolean;
}

export function ChannelForm({ canManage, assistants, initial, onSubmit, isPending = false }: { canManage: boolean; assistants: Assistant[]; initial?: TenantChannel; onSubmit(payload: ChannelPayload): void; isPending?: boolean }) {
  const eligibleAssistants = assistants.filter((assistant) => assistant.status === 'active');
  const [channelType, setChannelType] = useState<TenantChannel['channel_type']>(initial?.channel_type ?? 'WEB_CHAT');
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [externalChannelId, setExternalChannelId] = useState(initial?.external_channel_id ?? '');
  const [assistantId, setAssistantId] = useState(initial?.assistant_id ?? '');
  const [status, setStatus] = useState<TenantChannel['status']>(initial?.status ?? 'active');
  const [validationError, setValidationError] = useState<string>();

  useEffect(() => {
    if (channelType === 'WHATSAPP' && status === 'active' && !eligibleAssistants.some((assistant) => assistant.id === assistantId)) {
      setAssistantId(eligibleAssistants[0]?.id ?? '');
    }
  }, [assistantId, channelType, eligibleAssistants, status]);

  if (!canManage) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim()) return setValidationError('Display name is required.');
    if (channelType === 'WHATSAPP' && !externalChannelId.trim()) return setValidationError('External channel ID is required for WhatsApp.');
    if (channelType === 'WHATSAPP' && status === 'active' && !assistantId) return setValidationError('An active assistant is required for an active WhatsApp channel.');
    setValidationError(undefined);
    onSubmit({ channel_type: channelType, display_name: displayName.trim(), external_channel_id: externalChannelId.trim() || null, assistant_id: assistantId || null, status });
  }
  function changeChannelType(value: TenantChannel['channel_type']) {
    setChannelType(value);
    if (value === 'WHATSAPP' && !assistantId) setAssistantId(eligibleAssistants[0]?.id ?? '');
  }
  return <form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-medium">Channel type<select aria-label="Channel type" value={channelType} onChange={(event) => changeChannelType(event.target.value as TenantChannel['channel_type'])} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm"><option value="WEB_CHAT">Web Chat</option><option value="WHATSAPP">WhatsApp</option></select></label>
    <label className="block text-sm font-medium">Display name<input aria-label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    <label className="block text-sm font-medium">External channel ID<input aria-label="External channel ID" value={externalChannelId ?? ''} onChange={(event) => setExternalChannelId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    <label className="block text-sm font-medium">Assigned assistant<select aria-label="Assigned assistant" value={assistantId ?? ''} onChange={(event) => setAssistantId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm">{channelType !== 'WHATSAPP' && <option value="">No assistant assigned</option>}{channelType === 'WHATSAPP' && !eligibleAssistants.length && <option value="">No active assistant available</option>}{eligibleAssistants.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label>
    <label className="block text-sm font-medium">Status<select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as TenantChannel['status'])} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    {validationError && <p role="alert" className="text-sm text-red-700">{validationError}</p>}<button type="submit" disabled={isPending} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{isPending ? 'Saving…' : initial ? 'Save changes' : 'Create channel'}</button>
  </form>;
}

export function WhatsAppOwnershipConflictPanel({ isPlatformOwner, conflict, onTransfer, isPending }: {
  isPlatformOwner: boolean;
  conflict: WhatsAppOwnershipConflict;
  onTransfer(): void;
  isPending: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const canTransfer = Boolean(
    isPlatformOwner
    && conflict.platform_transfer_available
    && conflict.source_channel_id
    && conflict.source_tenant_id
  );
  return <div role="alert" className="rounded-xl border border-amber-400/35 bg-amber-950/25 p-4 text-sm text-amber-100">
    <p className="font-semibold">This physical WhatsApp channel is owned by another tenant.</p>
    <p className="mt-1 text-amber-100/80">Tenant administrators cannot claim it. A platform owner must use the audited transfer action.</p>
    {canTransfer && <div className="mt-4 space-y-3">
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label="Confirm cross-tenant transfer" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" /><span>I confirm this channel should be retired from its current owner and activated for this tenant. Historical conversations will remain with their original tenant.</span></label>
      <button type="button" disabled={!confirmed || isPending} onClick={onTransfer} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-amber-950 disabled:opacity-50">{isPending ? 'Transferring…' : 'Transfer channel'}</button>
    </div>}
  </div>;
}

function ownershipConflictFromError(error: unknown): WhatsAppOwnershipConflict | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object' || !('conflict' in error.body)) return null;
  const conflict = error.body.conflict;
  if (!conflict || typeof conflict !== 'object' || !('ownership' in conflict) || conflict.ownership !== 'OTHER_TENANT') return null;
  return conflict as WhatsAppOwnershipConflict;
}

export function ChannelsPage() {
  const { tenantId, channelId } = useParams(); const { canManage, isOwner } = useTenant(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const [mode, setMode] = useState<'create' | 'edit' | undefined>(); const [deleteTarget, setDeleteTarget] = useState<TenantChannel>(); const [notice, setNotice] = useState<string>();
  const [ownershipConflict, setOwnershipConflict] = useState<WhatsAppOwnershipConflict | null>(null);
  const [pendingWhatsAppPayload, setPendingWhatsAppPayload] = useState<ChannelPayload | null>(null);
  const list = useQuery({ queryKey: tenantKeys.channels(tenantId ?? ''), queryFn: () => tenantApi.listChannels(tenantId!), enabled: Boolean(tenantId) });
  const assistants = useQuery({ queryKey: tenantKeys.assistants(tenantId ?? ''), queryFn: () => tenantApi.listAssistants(tenantId!), enabled: Boolean(tenantId) });
  const detail = useQuery({ queryKey: tenantKeys.channel(tenantId ?? '', channelId ?? ''), queryFn: () => tenantApi.getChannel(tenantId!, channelId!), enabled: Boolean(tenantId && channelId) });
  const tenantAssistants = selectTenantAssistants(assistants.data ?? [], tenantId ?? '');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: tenantKeys.channels(tenantId!) });
  const create = useMutation({ mutationFn: (payload: ChannelPayload) => tenantApi.createChannel(tenantId!, payload), onMutate: (payload) => { setPendingWhatsAppPayload(payload.channel_type === 'WHATSAPP' ? payload : null); setOwnershipConflict(null); }, onError: (error) => setOwnershipConflict(ownershipConflictFromError(error)), onSuccess: async () => { await invalidate(); setMode(undefined); setOwnershipConflict(null); setNotice('Channel created.'); } });
  const update = useMutation({ mutationFn: (payload: ChannelPayload) => tenantApi.updateChannel(tenantId!, channelId!, payload), onMutate: (payload) => { setPendingWhatsAppPayload(payload.channel_type === 'WHATSAPP' ? payload : null); setOwnershipConflict(null); }, onError: (error) => setOwnershipConflict(ownershipConflictFromError(error)), onSuccess: async () => { await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: tenantKeys.channel(tenantId!, channelId!) })]); setMode(undefined); setOwnershipConflict(null); setNotice('Channel updated.'); } });
  const transfer = useMutation({ mutationFn: async () => {
    if (!ownershipConflict?.source_channel_id || !pendingWhatsAppPayload?.external_channel_id || !pendingWhatsAppPayload.assistant_id) throw new Error('Transfer context is incomplete.');
    return tenantApi.transferWhatsAppChannel(tenantId!, {
      external_channel_id: pendingWhatsAppPayload.external_channel_id,
      expected_source_channel_id: ownershipConflict.source_channel_id,
      target_assistant_id: pendingWhatsAppPayload.assistant_id,
      display_name: pendingWhatsAppPayload.display_name,
      confirmation: 'TRANSFER',
    });
  }, onSuccess: async (result) => { await invalidate(); setMode(undefined); setOwnershipConflict(null); setNotice('WhatsApp channel transferred with an audit record.'); navigate(`/app/${tenantId}/channels/${result.channel.id}`); } });
  const remove = useMutation({ mutationFn: (id: string) => tenantApi.deleteChannel(tenantId!, id), onSuccess: async () => { await invalidate(); setDeleteTarget(undefined); setNotice('Channel deleted.'); navigate(`/app/${tenantId}/channels`); } });
  const selected = detail.data ?? list.data?.find((channel) => channel.id === channelId);
  return <section className="space-y-6"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Distribution</p><h1 className="page-title mt-2">Channels</h1><p className="mt-2 text-sm text-stone-600">Connect tenant-scoped Web Chat and WhatsApp channels.</p></div>{canManage && <button onClick={() => { setMode('create'); setOwnershipConflict(null); navigate(`/app/${tenantId}/channels`); }} className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16} />New channel</button>}</header><MutationFeedback error={ownershipConflict ? undefined : create.error ?? update.error ?? transfer.error ?? remove.error} success={notice} />{ownershipConflict && <WhatsAppOwnershipConflictPanel isPlatformOwner={isOwner} conflict={ownershipConflict} onTransfer={() => transfer.mutate()} isPending={transfer.isPending} />}<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]"><div className="panel overflow-hidden">{list.isLoading ? <div className="space-y-3 p-5"><SkeletonBlock className="h-14" /><SkeletonBlock className="h-14" /></div> : list.error ? <QueryErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="No channels yet" description="Create a Web Chat or WhatsApp channel for this tenant." /> : <ul className="divide-y divide-line">{list.data.map((channel) => <li key={channel.id}><Link to={`/app/${tenantId}/channels/${channel.id}`} className="block px-5 py-4 hover:bg-canvas"><div className="flex justify-between gap-3"><strong className="text-sm">{channel.display_name}</strong><span className="text-xs uppercase tracking-wide text-stone-500">{channel.status}</span></div><p className="mt-1 text-xs text-stone-500">{channel.channel_type === 'WEB_CHAT' ? 'Web Chat' : channel.channel_type === 'SAMCHEGUIDE' ? 'AI Guide' : 'WhatsApp'}</p></Link></li>)}</ul>}</div><aside className="panel p-5">{mode === 'create' ? <><h2 className="text-lg font-semibold">New channel</h2><div className="mt-5"><ChannelForm canManage={canManage} assistants={tenantAssistants} onSubmit={(payload) => create.mutate(payload)} isPending={create.isPending} /></div></> : detail.isLoading && channelId ? <SkeletonBlock className="h-52" /> : selected ? <><div className="flex justify-between gap-3"><div><p className="eyebrow">Channel detail</p><h2 className="mt-2 text-lg font-semibold">{selected.display_name}</h2></div>{canManage && (selected.channel_type === 'SAMCHEGUIDE' ? <Link to={`/app/${tenantId}/guide-experience`} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-stone-300 hover:text-white">Manage in Guide</Link> : <div className="flex gap-2"><button aria-label="Edit channel" onClick={() => setMode('edit')} className="rounded-lg border border-line p-2"><Pencil size={16} /></button><button aria-label="Delete channel" onClick={() => setDeleteTarget(selected)} className="rounded-lg border border-red-200 p-2 text-red-700"><Trash2 size={16} /></button></div>)}</div>{mode === 'edit' ? <div className="mt-5"><ChannelForm canManage={canManage} assistants={tenantAssistants} initial={selected} onSubmit={(payload) => update.mutate(payload)} isPending={update.isPending} /></div> : <dl className="mt-5 space-y-4 text-sm"><div><dt className="text-stone-500">Type</dt><dd className="mt-1">{selected.channel_type}</dd></div><div><dt className="text-stone-500">Status</dt><dd className="mt-1 capitalize">{selected.status}</dd></div><div><dt className="text-stone-500">Assistant</dt><dd className="mt-1">{tenantAssistants.find((assistant) => assistant.id === selected.assistant_id)?.name ?? 'Not assigned'}</dd></div></dl>}</> : <EmptyState title="Select a channel" description="Choose a channel to inspect its configuration." />}</aside></div><ConfirmationDialog open={Boolean(deleteTarget)} title="Delete channel" description={`Delete ${deleteTarget?.display_name ?? 'this channel'}? This action cannot be undone.`} confirmLabel="Delete" onCancel={() => setDeleteTarget(undefined)} onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)} isPending={remove.isPending} /></section>;
}

