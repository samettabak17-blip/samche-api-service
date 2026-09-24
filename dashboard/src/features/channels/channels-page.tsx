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
import { WhatsAppEmbeddedSignup } from './whatsapp-embedded-signup';
import { InstagramConnectionCard } from './instagram-connection-card';


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
  const eligibleAssistants = assistants.filter((assistant) => String(assistant.status ?? 'active').toLowerCase() === 'active');
  const [channelType, setChannelType] = useState<TenantChannel['channel_type']>(initial?.channel_type ?? 'WEB_CHAT');
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [externalChannelId, setExternalChannelId] = useState(initial?.external_channel_id ?? '');
  const [assistantId, setAssistantId] = useState(initial?.assistant_id ?? '');
  const [status, setStatus] = useState<TenantChannel['status']>(initial?.status ?? 'active');
  const [validationError, setValidationError] = useState<string>();

  useEffect(() => {
    if (initial) {
      setChannelType(initial.channel_type);
      setDisplayName(initial.display_name);
      setExternalChannelId(initial.external_channel_id ?? '');
      setAssistantId(initial.assistant_id ?? '');
      setStatus(initial.status);
    }
  }, [initial]);

  useEffect(() => {
    if (channelType === 'WHATSAPP' && status === 'active' && eligibleAssistants.length > 0) {
      if (!assistantId || !eligibleAssistants.some((assistant) => assistant.id === assistantId)) {
        const preferred = (initial?.assistant_id && eligibleAssistants.some((a) => a.id === initial.assistant_id))
          ? initial.assistant_id
          : eligibleAssistants[0].id;
        setAssistantId(preferred);
      }
    }
  }, [assistantId, channelType, eligibleAssistants, initial?.assistant_id, status]);

  if (!canManage) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim()) return setValidationError('Display name is required.');
    if (channelType === 'WHATSAPP' && !externalChannelId.trim()) return setValidationError('External channel ID is required for WhatsApp.');
    if (channelType === 'WHATSAPP' && status === 'active' && !assistantId) return setValidationError('An active assistant is required for an active WhatsApp channel.');
    setValidationError(undefined);
    onSubmit({
      channel_type: channelType,
      display_name: displayName.trim(),
      external_channel_id: ['WHATSAPP', 'INSTAGRAM'].includes(channelType) ? (externalChannelId.trim() || null) : null,
      assistant_id: assistantId || null,
      status,
    });
  }
  function changeChannelType(value: TenantChannel['channel_type']) {
    setChannelType(value);
    if (value === 'WHATSAPP' && !assistantId) setAssistantId(eligibleAssistants[0]?.id ?? '');
  }
  return <form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-medium">Channel type<select aria-label="Channel type" value={channelType} onChange={(event) => changeChannelType(event.target.value as TenantChannel['channel_type'])} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm"><option value="WEB_CHAT">Web Chat</option><option value="WHATSAPP">WhatsApp</option><option value="INSTAGRAM">Instagram</option></select></label>
    <label className="block text-sm font-medium">Display name<input aria-label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    {['WHATSAPP', 'INSTAGRAM'].includes(channelType) && (
      <label className="block text-sm font-medium">External channel ID (Page ID or Account ID)<input aria-label="External channel ID" value={externalChannelId ?? ''} onChange={(event) => setExternalChannelId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    )}
    {channelType === 'WEB_CHAT' && (
      <div className="rounded-lg border border-line/60 bg-canvas/30 p-3 text-xs text-stone-400">
        <span>Integration key and embed snippet are generated automatically. Manage full appearance, behavior, and preview in the </span>
        <span className="text-signal font-medium">Web Chat Experience</span>.
      </div>
    )}
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
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Distribution</p>
          <h1 className="page-title mt-2">Channels</h1>
          <p className="mt-2 text-sm text-stone-400">Connect tenant-scoped Web Chat, WhatsApp, and Instagram channels.</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Link
              to={`/app/${tenantId}/channels/web-chat`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-stone-300 hover:text-white"
            >
              Web Chat Experience
            </Link>
            <button
              onClick={() => {
                setMode('create');
                setOwnershipConflict(null);
                navigate(`/app/${tenantId}/channels`);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Plus size={16} />New channel
            </button>
          </div>
        )}
      </header>

      <MutationFeedback error={ownershipConflict ? undefined : create.error ?? update.error ?? transfer.error ?? remove.error} success={notice} />

      {ownershipConflict && (
        <WhatsAppOwnershipConflictPanel
          isPlatformOwner={isOwner}
          conflict={ownershipConflict}
          onTransfer={() => transfer.mutate()}
          isPending={transfer.isPending}
        />
      )}

      <WhatsAppEmbeddedSignup
        tenantId={tenantId!}
        canManage={canManage}
        assistants={tenantAssistants}
      />

      <InstagramConnectionCard
        tenantId={tenantId!}
        canManage={canManage}
        assistants={tenantAssistants}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
        <div className="panel overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h3 className="text-sm font-semibold text-white">Configured Channels</h3>
          </div>
          {list.isLoading ? (
            <div className="space-y-3 p-5">
              <SkeletonBlock className="h-14" />
              <SkeletonBlock className="h-14" />
            </div>
          ) : list.error ? (
            <QueryErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data?.length ? (
            <EmptyState title="No channels yet" description="Create a Web Chat, WhatsApp, or Instagram channel for this tenant." />
          ) : (
            <ul className="divide-y divide-line">
              {list.data.map((channel) => (
                <li key={channel.id}>
                  <Link to={`/app/${tenantId}/channels/${channel.id}`} className="block px-5 py-4 hover:bg-canvas">
                    <div className="flex justify-between gap-3">
                      <strong className="text-sm text-white">{channel.display_name}</strong>
                      <span className="text-xs uppercase tracking-wide text-stone-400">{channel.status}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-stone-400">
                      <span>{channel.channel_type}</span>
                      {channel.external_channel_id && <span>• ID: {channel.external_channel_id}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {mode === 'create' ? (
            <div className="panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">New channel</h2>
                <button type="button" onClick={() => setMode(undefined)} className="text-xs text-stone-400 hover:text-white">Cancel</button>
              </div>
              <ChannelForm canManage={canManage} assistants={tenantAssistants} onSubmit={(payload) => create.mutate(payload)} isPending={create.isPending} />
            </div>
          ) : selected ? (
            <div className="panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">{mode === 'edit' ? 'Edit channel' : selected.display_name}</h2>
                {canManage && (
                  <div className="flex items-center gap-2">
                    {mode !== 'edit' && (
                      <button type="button" onClick={() => setMode('edit')} className="inline-flex items-center gap-1 text-xs text-stone-300 hover:text-white">
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                    <button type="button" onClick={() => setDeleteTarget(selected)} className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                )}
              </div>
              {mode === 'edit' ? (
                <ChannelForm canManage={canManage} assistants={tenantAssistants} initial={selected} onSubmit={(payload) => update.mutate(payload)} isPending={update.isPending} />
              ) : (
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-stone-400">Channel type</dt>
                    <dd className="font-medium text-white">{selected.channel_type}</dd>
                  </div>
                  {selected.external_channel_id && (
                    <div>
                      <dt className="text-xs text-stone-400">External ID</dt>
                      <dd className="font-mono text-xs text-stone-300">{selected.external_channel_id}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-stone-400">Assigned assistant</dt>
                    <dd className="font-medium text-white">{assistants.data?.find((a) => a.id === selected.assistant_id)?.name ?? 'None'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-400">Status</dt>
                    <dd className="text-xs uppercase text-stone-300">{selected.status}</dd>
                  </div>
                </dl>
              )}
            </div>
          ) : (
            <div className="panel p-8 text-center text-sm text-stone-400">
              Select a channel from the list or create a new one.
            </div>
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="Delete Channel"
        description={`Are you sure you want to delete ${deleteTarget?.display_name}? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        isPending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(undefined)}
      />
    </section>
  );
}