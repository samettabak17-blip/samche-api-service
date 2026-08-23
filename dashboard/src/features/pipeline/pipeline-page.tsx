import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ChevronRight, Plus, Save } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ui/confirmation-dialog';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { MutationFeedback } from '../../components/ui/mutation-feedback';
import { formatDate } from '../../lib/format';
import type { CrmContact, CrmDeal, CrmPipelineStage, TeamMember } from '../../types/api';
import { tenantApi, tenantKeys, type DealPayload } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';

const unknown = 'Not provided';
const amount = (value?: number | string | null, currency?: string | null) => value === null || value === undefined ? unknown : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value)) + (currency ? ' ' + currency : '');
const contactName = (contact: CrmContact) => contact.display_name || contact.email || contact.phone || 'Unnamed contact';
const dealContact = (deal: CrmDeal) => deal.contact_display_name || deal.contact_email || deal.contact_phone || unknown;

type DealFormProps = {
  contacts: CrmContact[];
  stages: CrmPipelineStage[];
  members: TeamMember[];
  initial?: CrmDeal;
  onSubmit(payload: DealPayload): void;
  pending?: boolean;
};

export function DealForm({ contacts, stages, members, initial, onSubmit, pending = false }: DealFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [contactId, setContactId] = useState(initial?.contact_id ?? '');
  const [stageId, setStageId] = useState(initial?.pipeline_stage_id ?? stages[0]?.id ?? '');
  const [value, setValue] = useState(initial?.value?.toString() ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'AED');
  const [probability, setProbability] = useState(initial?.probability?.toString() ?? '');
  const [closeDate, setCloseDate] = useState(initial?.expected_close_date ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [ownerUserId, setOwnerUserId] = useState(initial?.owner_user_id ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError('Deal title is required.');
    if (!initial && !contactId) return setError('Choose an existing CRM contact.');
    const parsedValue = value.trim() ? Number(value) : null;
    const parsedProbability = probability.trim() ? Number(probability) : null;
    if (parsedValue !== null && (!Number.isFinite(parsedValue) || parsedValue < 0)) return setError('Deal value must be zero or greater.');
    if (parsedProbability !== null && (!Number.isInteger(parsedProbability) || parsedProbability < 0 || parsedProbability > 100)) return setError('Probability must be a whole number from 0 to 100.');
    if (currency.trim() && !/^[A-Z]{3}$/.test(currency.trim())) return setError('Currency must use a three-letter uppercase code.');
    setError(undefined);
    onSubmit({
      contact_id: initial?.contact_id ?? contactId,
      title: title.trim(),
      pipeline_stage_id: stageId || undefined,
      value: parsedValue,
      currency: currency.trim() || null,
      probability: parsedProbability,
      expected_close_date: closeDate || null,
      owner_user_id: ownerUserId || null,
      source: source.trim() || null,
      notes: notes.trim() || null,
    });
  }

  return <form onSubmit={submit} className="space-y-4">
    {!initial && <label className="block text-sm font-medium text-ink">Contact<select aria-label="Deal contact" value={contactId} onChange={(event) => setContactId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm"><option value="">Select a CRM contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contactName(contact)}</option>)}</select></label>}
    <label className="block text-sm font-medium text-ink">Deal title<input aria-label="Deal title" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    {!initial && <label className="block text-sm font-medium text-ink">Pipeline stage<select aria-label="Deal pipeline stage" value={stageId} onChange={(event) => setStageId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm">{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>}
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium text-ink">Value<input aria-label="Deal value" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label><label className="block text-sm font-medium text-ink">Currency<input aria-label="Deal currency" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label></div>
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium text-ink">Probability<input aria-label="Deal probability" inputMode="numeric" value={probability} onChange={(event) => setProbability(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label><label className="block text-sm font-medium text-ink">Expected close<input aria-label="Expected close date" type="date" value={closeDate} onChange={(event) => setCloseDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label></div>
    <label className="block text-sm font-medium text-ink">Owner<select aria-label="Deal owner" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm"><option value="">No owner assigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.email}</option>)}</select></label>
    <label className="block text-sm font-medium text-ink">Source<input aria-label="Deal source" value={source} onChange={(event) => setSource(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    <label className="block text-sm font-medium text-ink">Notes<textarea aria-label="Deal notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="mt-1.5 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm" /></label>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button type="submit" disabled={pending || (!initial && contacts.length === 0)} className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Save aria-hidden="true" size={15} />{pending ? 'Saving…' : initial ? 'Save deal' : 'Create deal'}</button>
  </form>;
}

export function PipelineBoard({ stages, deals, tenantId, canManage, onMove }: { stages: CrmPipelineStage[]; deals: CrmDeal[]; tenantId: string; canManage: boolean; onMove(dealId: string, stageId: string): void }) {
  return <div className="grid gap-4 xl:grid-cols-6">{stages.map((stage) => {
    const inStage = deals.filter((deal) => deal.pipeline_stage_id === stage.id);
    return <section key={stage.id} className="min-w-0 rounded-xl border border-line bg-white/[0.02]"><header className="flex items-center justify-between border-b border-line px-4 py-3"><p className="text-sm font-semibold text-ink">{stage.name}</p><span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-stone-400">{inStage.length}</span></header><div className="space-y-3 p-3">{inStage.length === 0 ? <p className="py-3 text-center text-xs text-stone-500">No deals</p> : inStage.map((deal) => <article key={deal.id} className="rounded-lg border border-line bg-canvas p-3 shadow-sm"><Link to={'/app/' + tenantId + '/pipeline/' + deal.id} className="block"><p className="text-sm font-semibold text-ink">{deal.title}</p><p className="mt-1 text-xs text-stone-500">{dealContact(deal)}</p><p className="mt-3 text-sm font-medium text-ink">{amount(deal.value, deal.currency)}</p>{deal.expected_close_date && <p className="mt-1 text-xs text-stone-500">Close {formatDate(deal.expected_close_date)}</p>}</Link>{canManage && <label className="mt-3 block text-xs text-stone-500">Move to<select aria-label={'Move ' + deal.title} value={stage.id} onChange={(event) => onMove(deal.id, event.target.value)} className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-xs">{stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}</article>)}</div></section>;
  })}</div>;
}

export function PipelinePage() {
  const { tenantId, dealId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useTenant();
  const [mode, setMode] = useState<'create' | 'edit'>();
  const [archiveTarget, setArchiveTarget] = useState<CrmDeal>();
  const [notice, setNotice] = useState<string>();
  const dealFilters = useMemo(() => ({ limit: 100, offset: 0 }), []);
  const key = useMemo(() => new URLSearchParams(Object.entries(dealFilters).map(([name, value]) => [name, String(value)])).toString(), [dealFilters]);
  const stages = useQuery({ queryKey: tenantKeys.pipelines(tenantId ?? ''), queryFn: () => tenantApi.listPipelines(tenantId!), enabled: Boolean(tenantId) });
  const deals = useQuery({ queryKey: tenantKeys.deals(tenantId ?? '', key), queryFn: () => tenantApi.listDeals(tenantId!, dealFilters), enabled: Boolean(tenantId) });
  const contacts = useQuery({ queryKey: tenantKeys.contacts(tenantId ?? '', 'limit=100&offset=0'), queryFn: () => tenantApi.listContacts(tenantId!, { limit: 100, offset: 0 }), enabled: Boolean(tenantId) });
  const team = useQuery({ queryKey: tenantKeys.team(tenantId ?? ''), queryFn: () => tenantApi.listTeam(tenantId!), enabled: Boolean(tenantId) });
  const detail = useQuery({ queryKey: tenantKeys.deal(tenantId ?? '', dealId ?? ''), queryFn: () => tenantApi.getDeal(tenantId!, dealId!), enabled: Boolean(tenantId && dealId) });
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'deals'] }),
    queryClient.invalidateQueries({ queryKey: tenantKeys.pipelineSummary(tenantId!) }),
    queryClient.invalidateQueries({ queryKey: tenantKeys.crmOverview(tenantId!) }),
    queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'contacts'] }),
    dealId ? queryClient.invalidateQueries({ queryKey: tenantKeys.deal(tenantId!, dealId) }) : Promise.resolve(),
  ]);
  const create = useMutation({ mutationFn: (payload: DealPayload) => tenantApi.createDeal(tenantId!, payload), onSuccess: async (deal) => { await invalidate(); setMode(undefined); setNotice('Deal created.'); navigate('/app/' + tenantId + '/pipeline/' + deal.id); } });
  const update = useMutation({ mutationFn: (payload: Partial<DealPayload>) => tenantApi.updateDeal(tenantId!, dealId!, payload), onSuccess: async () => { await invalidate(); setMode(undefined); setNotice('Deal updated.'); } });
  const move = useMutation({ mutationFn: ({ id, stageId }: { id: string; stageId: string }) => tenantApi.setDealStage(tenantId!, id, stageId), onSuccess: async () => { await invalidate(); setNotice('Deal stage updated.'); } });
  const archive = useMutation({ mutationFn: (id: string) => tenantApi.archiveDeal(tenantId!, id), onSuccess: async () => { await invalidate(); setArchiveTarget(undefined); setNotice('Deal archived.'); navigate('/app/' + tenantId + '/pipeline'); } });

  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a workspace to view its sales pipeline." />;
  if (stages.isLoading || deals.isLoading || contacts.isLoading || team.isLoading) return <div className="space-y-4"><SkeletonBlock className="h-20" /><SkeletonBlock className="h-[32rem]" /></div>;
  const primaryError = stages.error ?? deals.error ?? contacts.error ?? team.error;
  if (primaryError) return <QueryErrorState error={primaryError} onRetry={() => { void stages.refetch(); void deals.refetch(); void contacts.refetch(); void team.refetch(); }} resource="sales pipeline" />;
  const selected = detail.data ?? deals.data?.items.find((deal) => deal.id === dealId);
  if (dealId && detail.isError) return <QueryErrorState error={detail.error} onRetry={() => void detail.refetch()} resource="deal" />;

  return <section className="space-y-6"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">CRM</p><h1 className="page-title mt-2">Pipeline</h1><p className="mt-2 text-sm text-stone-500">Move real tenant opportunities through the persisted sales pipeline.</p></div>{canManage && <button type="button" onClick={() => { setMode('create'); navigate('/app/' + tenantId + '/pipeline'); }} className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-white"><Plus aria-hidden="true" size={16} />New deal</button>}</header><MutationFeedback error={create.error ?? update.error ?? move.error ?? archive.error} success={notice} />
    {mode === 'create' ? <aside className="panel max-w-2xl p-5"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">New opportunity</p><h2 className="mt-2 text-lg font-semibold text-ink">Create deal</h2></div><button type="button" className="text-sm text-stone-400" onClick={() => setMode(undefined)}>Cancel</button></div>{contacts.data?.items.length ? <DealForm contacts={contacts.data.items} stages={stages.data ?? []} members={team.data ?? []} onSubmit={(payload) => create.mutate(payload)} pending={create.isPending} /> : <EmptyState title="No CRM contacts available" description="A deal must be linked to an existing tenant CRM contact." />}</aside> : dealId ? (detail.isLoading ? <SkeletonBlock className="h-96" /> : selected ? <aside className="panel max-w-3xl p-5"><Link to={'/app/' + tenantId + '/pipeline'} className="text-sm font-semibold text-signal">← Back to pipeline</Link><div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Deal detail</p><h2 className="mt-2 text-xl font-semibold text-ink">{selected.title}</h2><p className="mt-1 text-sm text-stone-500">{dealContact(selected)}</p></div>{canManage && <div className="flex gap-2"><button type="button" onClick={() => setMode('edit')} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink">Edit</button><button type="button" onClick={() => setArchiveTarget(selected)} className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-semibold text-red-300"><Archive aria-hidden="true" size={15} />Archive</button></div>}</div>{mode === 'edit' && canManage ? <div className="mt-6"><DealForm contacts={contacts.data?.items ?? []} stages={stages.data ?? []} members={team.data ?? []} initial={selected} onSubmit={(payload) => update.mutate(payload)} pending={update.isPending} /></div> : <dl className="mt-6 grid gap-5 sm:grid-cols-2"><div><dt className="text-xs uppercase tracking-wide text-stone-500">Stage</dt><dd className="mt-1 text-sm text-ink">{selected.pipeline_stage || unknown}</dd></div><div><dt className="text-xs uppercase tracking-wide text-stone-500">Value</dt><dd className="mt-1 text-sm text-ink">{amount(selected.value, selected.currency)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-stone-500">Probability</dt><dd className="mt-1 text-sm text-ink">{selected.probability === null || selected.probability === undefined ? unknown : selected.probability + '%'}</dd></div><div><dt className="text-xs uppercase tracking-wide text-stone-500">Expected close</dt><dd className="mt-1 text-sm text-ink">{selected.expected_close_date ? formatDate(selected.expected_close_date) : unknown}</dd></div><div><dt className="text-xs uppercase tracking-wide text-stone-500">Owner</dt><dd className="mt-1 text-sm text-ink">{selected.owner_email || unknown}</dd></div><div><dt className="text-xs uppercase tracking-wide text-stone-500">Source</dt><dd className="mt-1 text-sm text-ink">{selected.source || unknown}</dd></div><div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-stone-500">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-ink">{selected.notes || unknown}</dd></div></dl>}</aside> : <EmptyState title="Deal not found" description="This deal is unavailable in the selected tenant." />) : <>{deals.data?.items.length ? <PipelineBoard stages={stages.data ?? []} deals={deals.data.items} tenantId={tenantId} canManage={canManage} onMove={(id, stageId) => move.mutate({ id, stageId })} /> : <EmptyState title="No deals yet" description={canManage ? 'Create the first opportunity for an existing CRM contact.' : 'No tenant deals have been recorded yet.'} icon={<ChevronRight aria-hidden="true" size={21} />} />}</>}
    <ConfirmationDialog open={Boolean(archiveTarget)} title="Archive deal" description={'Archive ' + (archiveTarget?.title ?? 'this deal') + '? It will be removed from active pipeline metrics.'} confirmLabel="Archive" onCancel={() => setArchiveTarget(undefined)} onConfirm={() => archiveTarget && archive.mutate(archiveTarget.id)} isPending={archive.isPending} />
  </section>;
}
