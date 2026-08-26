import { Bell, Building2, CalendarDays, ChevronLeft, ChevronRight, LogOut, Menu, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Tenant } from '../../types/api';
import { useOverviewDateRange } from '../../features/overview/overview-date-range-context';
import { useLiveSupportAttention } from '../../features/live-support/live-support-attention-provider';
import { tenantApi } from '../../features/dashboard/dashboard-api';

interface TopbarProps { tenants: Tenant[]; selectedTenantId: string; email: string; onSelectTenant(tenantId: string): void; onOpenNavigation(): void; onLogout(): void; }

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const presets = [
  ['today', 'Today'], ['last-7-days', 'Last 7 days'], ['last-30-days', 'Last 30 days'], ['this-month', 'This month'], ['previous-month', 'Previous month'],
] as const;
const parseDate = (value: string) => new Date(value + 'T00:00:00Z');
const asDate = (date: Date) => date.toISOString().slice(0, 10);
const compactRange = (start: string, end: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(parseDate(start)) + ' → ' + new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(parseDate(end));

function DateRangeControl() {
  const { preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, applyCustomRange, clearCustomRange, activeRange } = useOverviewDateRange();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [overlayPosition, setOverlayPosition] = useState({ top: 0, left: 0 });
  const [cursor, setCursor] = useState(() => new Date(parseDate(customStart).getUTCFullYear(), parseDate(customStart).getUTCMonth(), 1));
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setOverlayPosition({ top: rect.bottom + 10, left: Math.max(16, Math.min(rect.right - 368, window.innerWidth - 384)) });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  const [choosingStart, setChoosingStart] = useState(true);
  const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), index - offset + 1)));
  const chooseDay = (date: Date) => {
    const value = asDate(date);
    if (choosingStart || value < customStart) { setCustomStart(value); setCustomEnd(value); setChoosingStart(false); return; }
    setCustomEnd(value); setChoosingStart(true);
  };
  const selectPreset = (value: typeof presets[number][0]) => { setPreset(value); setOpen(false); };
  return <div className="relative hidden xl:block">
    <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="group glass-surface inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-stone-200 transition hover:border-signal/35 hover:bg-white/[.055]">
      <CalendarDays size={15} className="text-stone-100 transition-colors group-hover:text-signal" /><span>{activeRange.label}</span><ChevronRight size={14} className={open ? 'rotate-90 text-stone-300 transition-transform' : 'text-stone-500 transition-transform'} />
    </button>
    {open && typeof document !== 'undefined' && createPortal(<section role="dialog" aria-label="Date range" style={{ position: 'fixed', top: overlayPosition.top, left: overlayPosition.left, zIndex: 60 }} className="w-[23rem] rounded-2xl border border-white/[.14] bg-[#09121f]/95 p-3 text-left shadow-[0_22px_60px_rgba(0,0,0,.55),0_0_28px_rgba(212,33,41,.13)] backdrop-blur-2xl">
      <div className="grid grid-cols-2 gap-1.5 border-b border-white/[.08] pb-3">{presets.map(([value, label]) => <button key={value} type="button" onClick={() => selectPreset(value)} className={'rounded-lg px-2.5 py-2 text-left text-xs transition ' + (preset === value ? 'bg-signal/20 text-white ring-1 ring-inset ring-signal/45' : 'text-stone-300 hover:bg-white/[.06]')}>{label}</button>)}<button type="button" onClick={() => { setPreset('custom'); setChoosingStart(true); }} className={'rounded-lg px-2.5 py-2 text-left text-xs transition ' + (preset === 'custom' ? 'bg-signal/20 text-white ring-1 ring-inset ring-signal/45' : 'text-stone-300 hover:bg-white/[.06]')}>Custom range</button></div>
      {preset === 'custom' && <div className="pt-3">
        <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg text-stone-300 hover:bg-white/[.07]"><ChevronLeft size={16} /></button><p className="text-sm font-semibold text-white">{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</p><button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg text-stone-300 hover:bg-white/[.07]"><ChevronRight size={16} /></button></div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-stone-500">{weekdayLabels.map((label) => <span key={label} className="py-1">{label}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">{days.map((date) => { const value = asDate(date); const inMonth = date.getUTCMonth() === cursor.getUTCMonth(); const selected = value === customStart || value === customEnd; const between = value > customStart && value < customEnd; const today = value === asDate(new Date()); return <button key={value} type="button" onClick={() => chooseDay(date)} className={'grid h-9 place-items-center rounded-lg text-xs transition ' + (!inMonth ? 'text-stone-700' : selected ? 'bg-signal text-white shadow-[0_0_14px_rgba(239,52,61,.45)]' : between ? 'bg-signal/18 text-red-100' : today ? 'border border-signal/45 text-white' : 'text-stone-300 hover:bg-white/[.08]')}>{date.getUTCDate()}</button>; })}</div>
        <div className="mt-3 flex items-center justify-between border-t border-white/[.08] pt-3"><button type="button" onClick={clearCustomRange} className="rounded-lg px-2.5 py-1.5 text-xs text-stone-400 hover:bg-white/[.06] hover:text-white">Clear</button><span className="text-[10px] text-stone-500">{compactRange(customStart, customEnd)}</span><button type="button" onClick={() => { applyCustomRange(); setOpen(false); }} className="rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-white hover:bg-signal/90">Apply</button></div>
      </div>}
    </section>, document.body)}
  </div>;
}

export function Topbar({ tenants, selectedTenantId, email, onSelectTenant, onOpenNavigation, onLogout }: TopbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { requestedCount } = useLiveSupportAttention();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const knownSection = location.pathname.split('/').find((segment) => ['overview', 'conversations', 'leads', 'pipeline', 'assistants', 'channels', 'knowledge-base', 'team', 'settings'].includes(segment));
  const title = ({ overview: 'Dashboard Overview', conversations: 'Conversations', leads: 'Leads', pipeline: 'Pipeline', assistants: 'AI Assistants', channels: 'Channels', 'knowledge-base': 'Knowledge Base', team: 'Team', settings: 'Settings' } as Record<string, string>)[knownSection ?? ''] ?? 'Dashboard Overview';
  const isOverview = knownSection === 'overview';
  const notifications = useQuery({
    queryKey: ['tenant', selectedTenantId, 'header-live-support'],
    queryFn: () => tenantApi.listConversations(selectedTenantId, { limit: 20, offset: 0 }),
    enabled: notificationsOpen && requestedCount > 0,
  });
  const waiting = (notifications.data ?? []).filter((item) => item.human_attention_state === 'REQUESTED');
  const displayRole = 'Administrator';
  return <header className="flex min-h-[4.25rem] items-center justify-between border-b border-line/80 bg-shell/85 px-4 backdrop-blur-xl sm:px-6 lg:px-7">
    <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={onOpenNavigation} className="grid h-10 w-10 place-items-center rounded-lg text-stone-300 hover:bg-white/[0.04] lg:hidden" aria-label="Open navigation"><Menu aria-hidden="true" size={21} /></button><p className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</p></div>
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <form onSubmit={(event) => { event.preventDefault(); const term = search.trim(); if (term) navigate('/app/' + selectedTenantId + '/conversations/whatsapp?q=' + encodeURIComponent(term)); }} className="relative hidden xl:block"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-48 rounded-xl border border-line bg-black/15 pl-9 pr-3 text-xs text-ink outline-none transition placeholder:text-stone-500 focus:border-signal/50 2xl:w-60" placeholder="Search anything…" aria-label="Search conversations" /></form>
      {isOverview && <DateRangeControl />}
      <div className="relative"><button type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-label="Live support notifications" aria-expanded={notificationsOpen} className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-elevated/60 text-stone-200 transition hover:border-signal/35 hover:text-white"><Bell size={17} />{requestedCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-signal px-1 text-[9px] font-bold text-white">{requestedCount}</span>}</button>{notificationsOpen && <section className="absolute right-0 top-12 z-[90] w-80 overflow-hidden rounded-2xl border border-white/[.14] bg-[#09121f]/95 shadow-2xl backdrop-blur-2xl"><header className="border-b border-white/[.08] px-4 py-3"><p className="text-sm font-semibold text-white">Notifications</p><p className="mt-0.5 text-xs text-stone-400">{requestedCount ? requestedCount + ' live support request' + (requestedCount === 1 ? '' : 's') + ' waiting' : 'No active notifications'}</p></header><div className="max-h-72 overflow-y-auto">{waiting.length ? waiting.map((item) => <button key={item.id} type="button" onClick={() => { setNotificationsOpen(false); navigate('/app/' + selectedTenantId + '/conversations/whatsapp/' + item.id); }} className="block w-full border-b border-white/[.06] px-4 py-3 text-left transition hover:bg-white/[.05]"><p className="text-xs font-bold tracking-[.1em] text-red-300">LIVE SUPPORT</p><p className="mt-1 truncate text-sm font-medium text-white">{item.contact_display_name || item.contact_phone || 'Customer waiting'}</p><p className="mt-1 truncate text-xs text-stone-400">{item.last_message_preview || 'Customer requested a representative'}</p></button>) : <p className="px-4 py-7 text-center text-sm text-stone-500">{requestedCount ? 'Loading current requests…' : 'No live support requests.'}</p>}</div></section>}</div>
      <div className="glass-surface hidden min-w-0 items-center gap-2 rounded-xl px-3 py-2 lg:flex"><span className="inline-grid h-7 w-7 place-items-center rounded-full bg-signal/15 text-xs font-bold text-signal">{displayRole.slice(0, 1)}</span><div className="min-w-0"><p className="max-w-40 truncate text-xs font-semibold text-ink">{tenants.find((tenant) => tenant.id === selectedTenantId)?.name || 'Workspace'}</p><p className="text-[10px] text-stone-400">{displayRole}</p></div></div>
      <div className="hidden 2xl:block"><label className="sr-only" htmlFor="tenant-select">Selected tenant</label><select id="tenant-select" value={selectedTenantId} onChange={(event) => onSelectTenant(event.target.value)} className="max-w-40 truncate rounded-xl border border-line bg-elevated/60 px-2 py-2 text-xs font-semibold text-ink outline-none">{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div>
      <button type="button" onClick={onLogout} className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-elevated/60 text-stone-400 transition hover:border-signal/30 hover:text-ink" aria-label="Sign out"><LogOut aria-hidden="true" size={18} /></button>
    </div>
  </header>;
}

