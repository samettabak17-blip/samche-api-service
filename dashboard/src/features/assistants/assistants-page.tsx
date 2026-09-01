import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ui/confirmation-dialog';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { MutationFeedback } from '../../components/ui/mutation-feedback';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import type { Assistant } from '../../types/api';

type AssistantPayload = Pick<Assistant, 'name'> & Partial<Pick<Assistant, 'model' | 'system_prompt' | 'status'>>;

export function AssistantForm({ canManage, isOwner = false, initial, onSubmit, isPending = false }: { canManage: boolean; isOwner?: boolean; initial?: Assistant; onSubmit(payload: AssistantPayload): void; isPending?: boolean }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [model, setModel] = useState(initial?.model ?? 'gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [validationError, setValidationError] = useState<string>();

  if (!canManage) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setValidationError('Assistant name is required.');
    setValidationError(undefined);
    onSubmit({ name: name.trim(), ...(isOwner ? { model: model.trim() || undefined, system_prompt: systemPrompt.trim() || undefined } : {}), status });
  }
  return <form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-medium text-ink">Name<input aria-label="Assistant name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    {isOwner && <label className="block text-sm font-medium text-ink">Model<input aria-label="Model" value={model ?? ''} onChange={(e) => setModel(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>}
    {isOwner && <label className="block text-sm font-medium text-ink">System prompt<textarea aria-label="System prompt" value={systemPrompt ?? ''} onChange={(e) => setSystemPrompt(e.target.value)} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm" /></label>}
    <label className="block text-sm font-medium text-ink">Status<select aria-label="Status" value={status ?? 'active'} onChange={(e) => setStatus(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    {validationError && <p role="alert" className="text-sm text-red-700">{validationError}</p>}
    <button type="submit" disabled={isPending} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white hover:bg-[#B81920] disabled:opacity-60">{isPending ? 'Saving…' : initial ? 'Save changes' : 'Create assistant'}</button>
  </form>;
}

export function AssistantsPage() {
  const { tenantId, assistantId } = useParams();
  const { canManage, isOwner } = useTenant();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'create' | 'edit' | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Assistant>();
  const [notice, setNotice] = useState<string>();
  const list = useQuery({ queryKey: tenantKeys.assistants(tenantId ?? ''), queryFn: () => tenantApi.listAssistants(tenantId!), enabled: Boolean(tenantId) });
  const detail = useQuery({ queryKey: tenantKeys.assistant(tenantId ?? '', assistantId ?? ''), queryFn: () => tenantApi.getAssistant(tenantId!, assistantId!), enabled: Boolean(tenantId && assistantId) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: tenantKeys.assistants(tenantId!) });
  const create = useMutation({ mutationFn: (payload: AssistantPayload) => tenantApi.createAssistant(tenantId!, payload), onSuccess: async () => { await invalidate(); setMode(undefined); setNotice('Assistant created.'); } });
  const update = useMutation({ mutationFn: (payload: AssistantPayload) => tenantApi.updateAssistant(tenantId!, assistantId!, payload), onSuccess: async () => { await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: tenantKeys.assistant(tenantId!, assistantId!) })]); setMode(undefined); setNotice('Assistant updated.'); } });
  const remove = useMutation({ mutationFn: (id: string) => tenantApi.deleteAssistant(tenantId!, id), onSuccess: async () => { await invalidate(); setDeleteTarget(undefined); setNotice('Assistant deleted.'); navigate(`/app/${tenantId}/assistants`); } });
  const selected = detail.data ?? list.data?.find((assistant) => assistant.id === assistantId);

  return <section className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Configuration</p><h1 className="page-title mt-2">AI Assistants</h1><p className="mt-2 text-sm text-stone-600">Define each tenant’s AI behavior and operating model.</p></div>{canManage && <button onClick={() => { setMode('create'); navigate(`/app/${tenantId}/assistants`); }} className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16} />New assistant</button>}</header>
    <MutationFeedback error={create.error ?? update.error ?? remove.error} success={notice} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
      <div className="panel overflow-hidden">{list.isLoading ? <div className="space-y-3 p-5"><SkeletonBlock className="h-14" /><SkeletonBlock className="h-14" /></div> : list.error ? <QueryErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="No assistants yet" description="Create an assistant when your tenant is ready to configure AI behavior." /> : <ul className="divide-y divide-line">{list.data.map((assistant) => <li key={assistant.id}><Link to={`/app/${tenantId}/assistants/${assistant.id}`} className="block px-5 py-4 hover:bg-canvas"><div className="flex items-center justify-between gap-3"><strong className="text-sm text-ink">{assistant.name}</strong><span className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-600">{assistant.status ?? 'active'}</span></div>{isOwner && <p className="mt-1 text-xs text-stone-500">{assistant.model ?? 'Default model'}</p>}</Link></li>)}</ul>}</div>
      <aside className="panel p-5">{mode === 'create' ? <><h2 className="text-lg font-semibold">New assistant</h2><div className="mt-5"><AssistantForm canManage={canManage} isOwner={isOwner} onSubmit={(payload) => create.mutate(payload)} isPending={create.isPending} /></div></> : detail.isLoading && assistantId ? <SkeletonBlock className="h-52" /> : selected ? <><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Assistant detail</p><h2 className="mt-2 text-lg font-semibold">{selected.name}</h2></div>{canManage && <div className="flex gap-2"><button aria-label="Edit assistant" onClick={() => setMode('edit')} className="rounded-lg border border-line p-2"><Pencil size={16} /></button><button aria-label="Delete assistant" onClick={() => setDeleteTarget(selected)} className="rounded-lg border border-red-200 p-2 text-red-700"><Trash2 size={16} /></button></div>}</div>{mode === 'edit' ? <div className="mt-5"><AssistantForm canManage={canManage} isOwner={isOwner} initial={selected} onSubmit={(payload) => update.mutate(payload)} isPending={update.isPending} /></div> : <dl className="mt-5 space-y-4 text-sm">{isOwner && <div><dt className="text-stone-500">Model</dt><dd className="mt-1 text-ink">{selected.model ?? 'Default model'}</dd></div>}<div><dt className="text-stone-500">Status</dt><dd className="mt-1 capitalize text-ink">{selected.status ?? 'active'}</dd></div>{isOwner && <div><dt className="text-stone-500">System prompt</dt><dd className="mt-1 whitespace-pre-wrap text-ink">{selected.system_prompt || 'No system prompt configured.'}</dd></div>}</dl>}</> : <EmptyState title="Select an assistant" description="Choose an assistant to view its configuration." />}</aside>
    </div>
    <ConfirmationDialog open={Boolean(deleteTarget)} title="Delete assistant" description={`Delete ${deleteTarget?.name ?? 'this assistant'}? This action cannot be undone.`} confirmLabel="Delete" onCancel={() => setDeleteTarget(undefined)} onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)} isPending={remove.isPending} />
  </section>;
}

