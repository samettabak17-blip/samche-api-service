import { Bell, Building2, CalendarDays, ChevronLeft, ChevronRight, LogOut, Menu, Search } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AuthUser, Tenant, TenantRole } from '../../types/api';
import { useOverviewDateRange } from '../../features/overview/overview-date-range-context';
import { useLiveSupportAttention } from '../../features/live-support/live-support-attention-provider';
import { tenantApi } from '../../features/dashboard/dashboard-api';
import { onboardingApi } from '../../features/dashboard/dashboard-api';
import { Modal } from '../ui/modal';
import { DashboardButton, DashboardField, DashboardFormMessage, DashboardInput, DashboardSelect, dashboardButtonClass } from '../ui/dashboard-control';

interface TopbarProps { tenants: Tenant[]; selectedTenantId: string; tenantId: string; email: string; systemRole: 'OWNER' | 'CUSTOMER'; selectedTenantRole?: TenantRole; onCreateTenant(name: string): Promise<Tenant>; onAdoptTenant(tenantId: string): Promise<void>; onSelectTenant(tenantId: string): void; onOpenNavigation(): void; onLogout(): void; }

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const navigationDestinations = [
  ['Overview', 'Overview', 'overview'], ['AI Assistants', 'AI assistants', 'assistants'], ['Channels', 'Channels', 'channels'], ['Knowledge Base', 'Knowledge documents', 'knowledge-base'],
  ['Conversations', 'Customer engagement', 'conversations/whatsapp'], ['WhatsApp', 'Conversations', 'conversations/whatsapp'], ['AI Guide', 'Conversations', 'conversations/guide'], ['Web Chatbot', 'Conversations', 'conversations/web-chat'],
  ['Leads', 'Customer engagement', 'leads'], ['Pipeline', 'Customer engagement', 'pipeline'], ['Team', 'Operations', 'team'], ['Settings', 'Settings', 'settings'],
] as const;
const presets = [
  ['today', 'Today'], ['last-7-days', 'Last 7 days'], ['last-30-days', 'Last 30 days'], ['this-month', 'This month'], ['previous-month', 'Previous month'],
] as const;
const parseDate = (value: string) => new Date(value + 'T00:00:00Z');
const asDate = (date: Date) => date.toISOString().slice(0, 10);
const compactRange = (start: string, end: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(parseDate(start)) + ' → ' + new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(parseDate(end));
const headerOverlayCloseEvent = 'samche:close-header-overlays';
const requestHeaderOverlayClose = () => window.dispatchEvent(new Event(headerOverlayCloseEvent));

function DateRangeControl() {
  const { preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, applyCustomRange, clearCustomRange, activeRange } = useOverviewDateRange();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
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
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener(headerOverlayCloseEvent, close);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener(headerOverlayCloseEvent, close); };
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
    <button ref={triggerRef} type="button" onClick={() => { if (!open) requestHeaderOverlayClose(); setOpen((value) => !value); }} aria-expanded={open} className="topbar-range-control group glass-surface inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition hover:bg-signal/10">
      <CalendarDays size={15} className="text-stone-100 transition-colors group-hover:text-signal" /><span>{activeRange.label}</span><ChevronRight size={14} className={open ? 'rotate-90 text-stone-300 transition-transform' : 'text-stone-500 transition-transform'} />
    </button>
    {open && typeof document !== 'undefined' && createPortal(<section ref={popoverRef} role="dialog" aria-label="Date range" style={{ position: 'fixed', top: overlayPosition.top, left: overlayPosition.left, zIndex: 60 }} className="w-[23rem] rounded-2xl border border-white/[.14] bg-[#09121f]/95 p-3 text-left shadow-[0_22px_60px_rgba(0,0,0,.55),0_0_28px_rgba(212,33,41,.13)] backdrop-blur-2xl">
      <div className="grid grid-cols-2 gap-1.5 border-b border-white/[.08] pb-3">{presets.map(([value, label]) => <button key={value} type="button" onClick={() => selectPreset(value)} className={'rounded-lg px-2.5 py-2 text-left text-xs transition ' + (preset === value ? 'bg-signal/20 text-white ring-1 ring-inset ring-signal/45' : 'text-stone-300 hover:bg-white/[.06]')}>{label}</button>)}<button type="button" onClick={() => { setPreset('custom'); setChoosingStart(true); }} className={'rounded-lg px-2.5 py-2 text-left text-xs transition ' + (preset === 'custom' ? 'bg-signal/20 text-white ring-1 ring-inset ring-signal/45' : 'text-stone-300 hover:bg-white/[.06]')}>Custom range</button></div>
      {preset === 'custom' && <div className="pt-3">
        <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg text-stone-300 hover:bg-white/[.07]"><ChevronLeft size={16} /></button><p className="text-sm font-semibold text-white">{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</p><button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))} className="grid h-8 w-8 place-items-center rounded-lg text-stone-300 hover:bg-white/[.07]"><ChevronRight size={16} /></button></div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-stone-500">{weekdayLabels.map((label) => <span key={label} className="py-1">{label}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">{days.map((date) => { const value = asDate(date); const inMonth = date.getUTCMonth() === cursor.getUTCMonth(); const selected = value === customStart || value === customEnd; const between = value > customStart && value < customEnd; const today = value === asDate(new Date()); return <button key={value} type="button" onClick={() => chooseDay(date)} className={'grid h-9 place-items-center rounded-lg text-xs transition ' + (!inMonth ? 'text-stone-700' : selected ? 'bg-signal text-white shadow-[0_0_14px_rgba(239,52,61,.45)]' : between ? 'bg-signal/18 text-red-100' : today ? 'border border-signal/45 text-white' : 'text-stone-300 hover:bg-white/[.08]')}>{date.getUTCDate()}</button>; })}</div>
        <div className="mt-3 flex items-center justify-between border-t border-white/[.08] pt-3"><button type="button" onClick={clearCustomRange} className="rounded-lg px-2.5 py-1.5 text-xs text-stone-300 hover:bg-signal/10 hover:text-white">Clear</button><span className="text-[10px] text-stone-500">{compactRange(customStart, customEnd)}</span><button type="button" onClick={() => { applyCustomRange(); setOpen(false); }} className="rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-white hover:bg-signal/90">Apply</button></div>
      </div>}
    </section>, document.body)}
  </div>;
}

export function Topbar({ tenants, selectedTenantId, tenantId, email, systemRole, selectedTenantRole, onCreateTenant, onAdoptTenant, onSelectTenant, onOpenNavigation, onLogout }: TopbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { requestedCount } = useLiveSupportAttention();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchTriggerRef = useRef<HTMLFormElement | null>(null);
  const searchOverlayRef = useRef<HTMLElement | null>(null);
  const notificationTriggerRef = useRef<HTMLDivElement | null>(null);
  const notificationOverlayRef = useRef<HTMLElement | null>(null);
  const [searchPosition, setSearchPosition] = useState({ top: 0, left: 0 });
  const [notificationPosition, setNotificationPosition] = useState({ top: 0, left: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [planReviewOpen, setPlanReviewOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [administratorFirstName, setAdministratorFirstName] = useState('');
  const [administratorLastName, setAdministratorLastName] = useState('');
  const [administratorEmail, setAdministratorEmail] = useState('');
  const [companyPlanCode, setCompanyPlanCode] = useState('');
  const onboardingIdempotencyKey = useRef<string | null>(null);
  const companyNameRef = useRef<HTMLInputElement>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [pendingInvitation, setPendingInvitation] = useState<{ tenantId: string; invitationId: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [customerUsers, setCustomerUsers] = useState<Array<Pick<AuthUser, 'id' | 'email' | 'system_role'>>>([]);
  const [assignedUserId, setAssignedUserId] = useState('');
  const [tenantRole, setTenantRole] = useState<'ADMIN' | 'AGENT'>('ADMIN');
  const [assignPending, setAssignPending] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState(false);
  const navigationMatches = navigationDestinations.filter(([label, group]) => (label + ' ' + group).toLowerCase().includes(search.trim().toLowerCase())).slice(0, 7);
  const openDestination = (path: string) => { setSearch(''); setSearchOpen(false); navigate('/app/' + selectedTenantId + '/' + path); };
  useEffect(() => {
    const position = () => {
      const searchRect = searchTriggerRef.current?.getBoundingClientRect();
      if (searchRect) setSearchPosition({ top: searchRect.bottom + 10, left: Math.max(16, Math.min(searchRect.right - 288, window.innerWidth - 304)) });
      const notificationRect = notificationTriggerRef.current?.getBoundingClientRect();
      if (notificationRect) setNotificationPosition({ top: notificationRect.bottom + 10, left: Math.max(16, Math.min(notificationRect.right - 320, window.innerWidth - 336)) });
    };
    if (!searchOpen && !notificationsOpen) return;
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [searchOpen, notificationsOpen]);
  useEffect(() => {
    if (!assignOpen || systemRole !== 'OWNER') return;
    void tenantApi.listCustomerUsers().then((users) => { setCustomerUsers(users); setAssignedUserId((current) => current || users[0]?.id || ''); }).catch(() => setAssignError('Could not load customer users. Please try again.'));
  }, [assignOpen, systemRole]);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchOpen && !searchTriggerRef.current?.contains(target) && !searchOverlayRef.current?.contains(target)) setSearchOpen(false);
      if (notificationsOpen && !notificationTriggerRef.current?.contains(target) && !notificationOverlayRef.current?.contains(target)) setNotificationsOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSearchOpen(false); setNotificationsOpen(false); } };
    const close = () => { setSearchOpen(false); setNotificationsOpen(false); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener(headerOverlayCloseEvent, close);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener(headerOverlayCloseEvent, close); };
  }, [searchOpen, notificationsOpen]);
  const knownSection = location.pathname.split('/').find((segment) => ['overview', 'conversations', 'leads', 'pipeline', 'assistants', 'channels', 'knowledge', 'knowledge-base', 'team', 'settings'].includes(segment));
  const isKnowledgeIntelligenceRoute = location.pathname.includes('/knowledge') || /\/knowledge-base\/(intelligence|sources|candidates|gaps|profile|configurations|retrieval)$/.test(location.pathname);
  const title = isKnowledgeIntelligenceRoute ? 'Knowledge Intelligence' : (({ overview: 'Dashboard Overview', conversations: 'Conversations', leads: 'Leads', pipeline: 'Pipeline', assistants: 'AI Assistants', channels: 'Channels', 'knowledge-base': 'Knowledge Base', team: 'Team', settings: 'Settings' } as Record<string, string>)[knownSection ?? ''] ?? 'Dashboard Overview');
  const isOverview = knownSection === 'overview';
  const notifications = useQuery({
    queryKey: ['tenant', selectedTenantId, 'header-live-support'],
    queryFn: () => tenantApi.listConversations(selectedTenantId, { limit: 20, offset: 0 }),
    enabled: notificationsOpen && requestedCount > 0,
  });
  const waiting = (notifications.data ?? []).filter((item) => item.human_attention_state === 'REQUESTED');
  const planNotifications = useQuery({
    queryKey: ['platform-plan-upgrade-notifications'],
    queryFn: () => tenantApi.listPlanUpgradeNotifications(),
    enabled: systemRole === 'OWNER',
    refetchInterval: systemRole === 'OWNER' ? 15_000 : false,
  });
  const unreadPlanNotifications = (planNotifications.data ?? []).filter((item) => item.status === 'PENDING');
  const unreadNotificationCount = requestedCount + unreadPlanNotifications.length;
  const displayRole = systemRole === 'OWNER' ? 'Platform Owner' : selectedTenantRole === 'AGENT' ? 'Agent' : 'Administrator';
  const invitationStatuses = useQuery({
    queryKey: ['tenant', tenantId, 'invitation-delivery-status'],
    queryFn: () => onboardingApi.listInvitationStatuses(tenantId),
    enabled: systemRole === 'OWNER' && Boolean(tenantId),
    refetchInterval: 15_000,
  });
  const planCatalog = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => tenantApi.listPlans(),
    enabled: systemRole === 'OWNER' && createOpen,
  });
  const planRequests = useQuery({ queryKey: ['platform-plan-upgrade-requests'], queryFn: () => tenantApi.listPlanUpgradeRequests(), enabled: systemRole === 'OWNER' && planReviewOpen });
  const selectedInvitation = pendingInvitation
    ? invitationStatuses.data?.find((invitation) => invitation.id === pendingInvitation.invitationId)
    : invitationStatuses.data?.find((invitation) => invitation.status === 'PENDING');
  const invitationDeliveryLabel = selectedInvitation?.delivery_status === 'SENT'
    ? 'Invitation sent.'
    : selectedInvitation?.delivery_status === 'DELIVERY_FAILED'
      ? 'Invitation delivery failed.'
      : selectedInvitation ? 'Invitation pending.' : null;
  const submitCreateTenant = async (event: FormEvent) => {
    event.preventDefault();
    const name = companyName.trim();
    const firstName = administratorFirstName.trim();
    const lastName = administratorLastName.trim();
    const email = administratorEmail.trim();
    if (!name || !companyPlanCode || !firstName || !lastName || !email) { setCreateError('Company name, plan, administrator name, and email are required.'); return; }
    setCreatePending(true); setCreateError(null); setCreateSuccess(false);
    try {
      const idempotencyKey = onboardingIdempotencyKey.current ?? crypto.randomUUID();
      onboardingIdempotencyKey.current = idempotencyKey;
      const response = await onboardingApi.createCompanyInvitation({ name, plan_code: companyPlanCode as 'STARTER' | 'GROWTH' | 'BUSINESS' | 'ENTERPRISE', first_name: firstName, last_name: lastName, email }, idempotencyKey);
      await onAdoptTenant(response.onboarding.tenant.id);
      if (response.onboarding.invitation?.status === 'PENDING') setPendingInvitation({ tenantId: response.onboarding.tenant.id, invitationId: response.onboarding.invitation.id });
      void invitationStatuses.refetch();
      setCompanyName(''); setCompanyPlanCode(''); setAdministratorFirstName(''); setAdministratorLastName(''); setAdministratorEmail(''); setCreateOpen(false); setCreateSuccess(true); onboardingIdempotencyKey.current = null;
    } catch { setCreateError('Could not create the invitation. Please try again.'); }
    finally { setCreatePending(false); }
  };
  const submitAssignment = async (event: FormEvent) => {
    event.preventDefault();
    if (!assignedUserId) { setAssignError('Select a customer user.'); return; }
    setAssignPending(true); setAssignError(null); setAssignSuccess(false);
    try { await tenantApi.assignTenantUser(tenantId, assignedUserId, tenantRole); setAssignSuccess(true); setAssignOpen(false); }
    catch { setAssignError('Could not assign customer. Please try again.'); }
    finally { setAssignPending(false); }
  };
  const resendInvitation = async (invitation = pendingInvitation) => {
    if (!invitation) return;
    setCreateError(null);
    try {
      const result = await onboardingApi.resendInvitation(invitation.tenantId, invitation.invitationId);
      setPendingInvitation({ tenantId: invitation.tenantId, invitationId: result.invitation.id });
      void invitationStatuses.refetch();
    } catch { setCreateError('Could not resend the invitation. Please try again.'); }
  };
  const revokeInvitation = async (invitation = pendingInvitation) => {
    if (!invitation) return;
    setCreateError(null);
    try { await onboardingApi.revokeInvitation(invitation.tenantId, invitation.invitationId); setPendingInvitation(null); }
    catch { setCreateError('Could not revoke the invitation. Please try again.'); }
  };
  return <header className="relative z-50 flex min-h-[4.25rem] items-center justify-between border-b border-line/80 bg-shell/85 px-4 backdrop-blur-xl sm:px-6 lg:px-7">
    <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={onOpenNavigation} className="grid h-10 w-10 place-items-center rounded-lg text-stone-300 hover:bg-white/[0.04] lg:hidden" aria-label="Open navigation"><Menu aria-hidden="true" size={21} /></button><p className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</p></div>
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <form ref={searchTriggerRef} onSubmit={(event) => { event.preventDefault(); if (navigationMatches[searchIndex]) openDestination(navigationMatches[searchIndex][2]); }} className="relative hidden xl:block"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" /><input value={search} onFocus={() => { requestHeaderOverlayClose(); setSearchOpen(true); }} onClick={() => { requestHeaderOverlayClose(); setSearchOpen(true); }} onChange={(event) => { setSearch(event.target.value); setSearchIndex(0); setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setSearchIndex((index) => Math.min(index + 1, Math.max(navigationMatches.length - 1, 0))); } if (event.key === 'ArrowUp') { event.preventDefault(); setSearchIndex((index) => Math.max(index - 1, 0)); } }} className="h-10 w-48 rounded-xl border border-line bg-black/15 pl-9 pr-3 text-xs text-ink outline-none transition placeholder:text-stone-500 focus:border-signal/50 2xl:w-60" placeholder="Search anything…" aria-label="Search dashboard destinations" />{searchOpen && typeof document !== 'undefined' && createPortal(<section ref={searchOverlayRef} role="listbox" aria-label="Dashboard destinations" style={{ position: 'fixed', top: searchPosition.top, left: searchPosition.left, zIndex: 60 }} className="w-72 overflow-hidden rounded-xl border border-white/[.14] bg-[#09121f]/95 p-1 shadow-2xl backdrop-blur-2xl">{navigationMatches.length ? navigationMatches.map(([label, group, path], index) => <button key={label + '-' + path} type="button" role="option" aria-selected={index === searchIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => openDestination(path)} className={'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition ' + (index === searchIndex ? 'bg-white/[.09] text-white' : 'text-stone-300 hover:bg-white/[.06]')}><span>{label}</span><span className="text-[10px] text-stone-500">{group}</span></button>) : <p className="px-3 py-2 text-xs text-stone-500">No dashboard destinations</p>}</section>, document.body)}</form>
      {isOverview && <DateRangeControl />}
      <div ref={notificationTriggerRef} className="relative"><button type="button" onClick={() => { if (!notificationsOpen) requestHeaderOverlayClose(); setNotificationsOpen((value) => !value); }} aria-label="Notifications" aria-expanded={notificationsOpen} className="topbar-notification-control relative grid h-10 w-10 place-items-center rounded-xl transition hover:bg-signal/10"><Bell size={17} />{unreadNotificationCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-signal px-1 text-[9px] font-bold text-white">{unreadNotificationCount}</span>}</button>{notificationsOpen && typeof document !== 'undefined' && createPortal(<section ref={notificationOverlayRef} role="dialog" aria-label="Notifications" style={{ position: 'fixed', top: notificationPosition.top, left: notificationPosition.left, zIndex: 60 }} className="w-80 overflow-hidden rounded-2xl border border-white/[.14] bg-[#09121f]/95 shadow-2xl backdrop-blur-2xl"><header className="border-b border-white/[.08] px-4 py-3"><p className="text-sm font-semibold text-white">Notifications</p><p className="mt-0.5 text-xs text-stone-400">{unreadNotificationCount ? unreadNotificationCount + ' notification' + (unreadNotificationCount === 1 ? '' : 's') + ' waiting' : 'No active notifications'}</p></header><div className="max-h-72 overflow-y-auto">{unreadPlanNotifications.map((item) => <button key={item.id} type="button" onClick={() => { void Promise.resolve(tenantApi.markPlanUpgradeNotificationRead(item.id)).then(() => planNotifications.refetch()); setNotificationsOpen(false); setPlanReviewOpen(true); }} className="block w-full border-b border-white/[.06] px-4 py-3 text-left transition hover:bg-signal/10"><p className="text-xs font-bold tracking-[.1em] text-red-300">PLAN UPGRADE</p><p className="mt-1 text-sm font-medium text-white">{item.title}</p><p className="mt-1 truncate text-xs text-stone-300">{item.tenant_name} · {item.current_plan_code} → {item.requested_plan_code}</p><p className="mt-1 truncate text-xs text-stone-400">Requested by {item.requested_by_email}</p></button>)}{waiting.map((item) => <button key={item.id} type="button" onClick={() => { setNotificationsOpen(false); navigate('/app/' + selectedTenantId + '/conversations/whatsapp/' + item.id); }} className="block w-full border-b border-white/[.06] px-4 py-3 text-left transition hover:bg-signal/10"><p className="text-xs font-bold tracking-[.1em] text-red-300">LIVE SUPPORT</p><p className="mt-1 truncate text-sm font-medium text-white">{item.contact_display_name || item.contact_phone || 'Customer waiting'}</p><p className="mt-1 truncate text-xs text-stone-400">{item.last_message_preview || 'Customer requested a representative'}</p></button>)}{!unreadPlanNotifications.length && !waiting.length && <p className="px-4 py-7 text-center text-sm text-stone-400">{(requestedCount > 0 || planNotifications.isLoading) ? 'Loading current requests…' : 'No active notifications.'}</p>}</div></section>, document.body)}</div>
      <div className="glass-surface hidden min-w-0 items-center gap-2 rounded-xl px-3 py-2 lg:flex"><span className="inline-grid h-7 w-7 place-items-center rounded-full bg-signal/15 text-xs font-bold text-signal">{displayRole.slice(0, 1)}</span><div className="min-w-0"><p className="max-w-40 truncate text-xs font-semibold text-ink">{tenants.find((tenant) => tenant.id === selectedTenantId)?.name || 'Workspace'}</p><p className="text-[10px] text-stone-400">{displayRole}</p></div></div>
      <div className="hidden 2xl:block"><label className="sr-only" htmlFor="tenant-select">Selected tenant</label><select id="tenant-select" value={selectedTenantId} onChange={(event) => onSelectTenant(event.target.value)} className="max-w-40 truncate rounded-xl border border-line bg-elevated/60 px-2 py-2 text-xs font-semibold text-ink outline-none">{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div>
      {systemRole === 'OWNER' && <>
        <DashboardButton type="button" variant="secondary" onClick={() => setPlanReviewOpen(true)} className="topbar-action text-xs">Upgrade requests</DashboardButton>
        <Modal open={planReviewOpen} title="Plan upgrade requests" onClose={() => setPlanReviewOpen(false)} className="max-w-3xl">
          <div className="mt-5 space-y-3">{planRequests.isLoading && <p className="dashboard-helper text-sm">Loading upgrade requests…</p>}{(planRequests.data ?? []).length === 0 && !planRequests.isLoading && <p className="dashboard-helper text-sm">No plan upgrade requests.</p>}{(planRequests.data ?? []).map((request) => <div key={request.id} className="rounded-xl border border-line bg-elevated/70 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-white">{request.tenant_name}</p><p className="mt-1 text-xs text-stone-300">{request.current_plan_code} → {request.requested_plan_code} · {request.requested_by_email}</p><p className="mt-1 text-xs text-stone-400">{new Date(request.created_at).toLocaleString()}</p></div>{request.status === 'PENDING' ? <div className="flex gap-2"><DashboardButton type="button" variant="destructive" className="h-9 text-xs" onClick={() => void tenantApi.resolvePlanUpgradeRequest(request.id, 'reject').then(() => planRequests.refetch())}>Reject</DashboardButton><DashboardButton type="button" variant="primary" className="h-9 text-xs" onClick={() => void tenantApi.resolvePlanUpgradeRequest(request.id, 'approve').then(() => planRequests.refetch())}>Approve</DashboardButton></div> : <span className="text-xs font-semibold text-stone-300">{request.status}</span>}</div></div>)}</div>
        </Modal>
        <DashboardButton type="button" variant="outline" onClick={() => { onboardingIdempotencyKey.current = null; setCreateOpen(true); setCreateError(null); setCreateSuccess(false); }} className="topbar-action border-signal/40 bg-signal/10 text-xs text-white hover:bg-signal/20"><Building2 size={15} />Create company</DashboardButton>
        <Modal open={createOpen} title="Create company" onClose={() => { if (!createPending) setCreateOpen(false); }} initialFocusRef={companyNameRef} closeOnEscape={!createPending} className="max-w-lg">
          <form onSubmit={submitCreateTenant} className="mt-5 space-y-4"><p className="text-sm leading-6 text-stone-300">Create the company and invite its first administrator to set up their account.</p>
            <DashboardField label="Company name"><DashboardInput ref={companyNameRef} aria-label="Company name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></DashboardField>
            <DashboardField label="Plan"><DashboardSelect aria-label="Plan" value={companyPlanCode} onChange={(event) => setCompanyPlanCode(event.target.value)} disabled={planCatalog.isLoading}><option value="">Select a plan</option>{(planCatalog.data ?? []).map((plan) => <option key={plan.code} value={plan.code}>{plan.display_name}</option>)}</DashboardSelect></DashboardField>
            <div className="grid gap-4 sm:grid-cols-2"><DashboardField label="First name"><DashboardInput aria-label="First name" value={administratorFirstName} onChange={(event) => setAdministratorFirstName(event.target.value)} /></DashboardField><DashboardField label="Last name"><DashboardInput aria-label="Last name" value={administratorLastName} onChange={(event) => setAdministratorLastName(event.target.value)} /></DashboardField></div>
            <DashboardField label="Email"><DashboardInput aria-label="Email" type="email" autoComplete="email" value={administratorEmail} onChange={(event) => setAdministratorEmail(event.target.value)} /></DashboardField>
            {createError && <DashboardFormMessage>{createError}</DashboardFormMessage>}
            <div className="flex flex-col-reverse gap-3 border-t border-white/[.08] pt-5 sm:flex-row sm:justify-between"><DashboardButton type="button" variant="secondary" disabled={createPending} onClick={() => { setCreateOpen(false); setAssignOpen(true); }}>Assign existing customer</DashboardButton><DashboardButton type="submit" variant="primary" disabled={createPending || !companyPlanCode}>{createPending ? 'Creating invitation…' : 'Create company & invite administrator'}</DashboardButton></div>
          </form>
        </Modal>
        {createSuccess && <span role="status">Invitation created.</span>}{invitationStatuses.isError && <span role="alert" className="text-xs text-red-200">Invitation status is unavailable.</span>}
        {selectedInvitation && invitationDeliveryLabel && <div className="hidden xl:flex invitation-delivery-status items-center gap-2 rounded-lg border border-line/70 bg-elevated/40 px-2 py-1"><span role="status" className={selectedInvitation.delivery_status === 'DELIVERY_FAILED' ? 'invitation-delivery-label text-[10px] font-semibold text-red-200' : 'invitation-delivery-label text-[10px] font-semibold text-emerald-200'}>{invitationDeliveryLabel}</span>{selectedInvitation.delivery_code && <span className="invitation-delivery-code text-[10px] font-medium text-stone-300">{selectedInvitation.delivery_code}</span>}<DashboardButton type="button" variant="ghost" onClick={() => void resendInvitation({ tenantId, invitationId: selectedInvitation.id })} className="topbar-status-action px-2 text-[10px] text-stone-100">Resend</DashboardButton><DashboardButton type="button" variant="destructive" onClick={() => void revokeInvitation({ tenantId, invitationId: selectedInvitation.id })} className="topbar-status-action px-2 text-[10px]">Revoke</DashboardButton></div>}
      </>}
      {systemRole === 'OWNER' && tenantId && <><button type="button" onClick={() => { setAssignOpen(true); setAssignError(null); setAssignSuccess(false); }} className={`${dashboardButtonClass('secondary')} topbar-action text-xs`}><Building2 size={15} />Assign customer</button><Modal open={assignOpen} title="Assign customer" onClose={() => { if (!assignPending) setAssignOpen(false); }} closeOnEscape={!assignPending} className="max-w-md"><form onSubmit={submitAssignment} className="mt-5"><label htmlFor="customer-user" className="text-sm font-medium text-stone-100">Customer user</label><select id="customer-user" value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white"><option value="">Select customer</option>{customerUsers.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select><label htmlFor="tenant-role" className="mt-4 block text-sm font-medium text-stone-100">Tenant role</label><select id="tenant-role" aria-label="Tenant role" value={tenantRole} onChange={(event) => setTenantRole(event.target.value === 'AGENT' ? 'AGENT' : 'ADMIN')} className="mt-2 h-11 w-full rounded-xl border border-white/20 bg-black/20 px-3 text-sm text-white"><option value="ADMIN">ADMIN</option><option value="AGENT">AGENT</option></select>{assignError && <p role="alert" className="mt-4 rounded-xl border border-red-400/35 bg-red-950/35 px-3 py-2.5 text-sm text-red-100">{assignError}</p>}<div className="mt-5 flex justify-end"><button type="submit" disabled={assignPending || !assignedUserId} className="rounded-xl bg-signal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{assignPending ? 'Assigning…' : 'Assign'}</button></div></form></Modal>{assignSuccess && <span role="status" className="sr-only">Customer assigned.</span>}</>}
      <button type="button" onClick={onLogout} className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-elevated/60 text-stone-400 transition hover:border-signal/30 hover:text-ink" aria-label="Sign out"><LogOut aria-hidden="true" size={18} /></button>
    </div>
  </header>;
}
