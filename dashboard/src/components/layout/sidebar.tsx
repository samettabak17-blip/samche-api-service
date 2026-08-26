import { BadgeDollarSign, BookOpenText, Bot, Cable, KanbanSquare, LayoutDashboard, MessagesSquare, Settings, UsersRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';
import type { TenantRole } from '../../types/api';

interface SidebarProps { tenantId: string; tenantName: string; tenantRole: TenantRole | 'OWNER' | undefined; email: string; onLogout(): void; onNavigate(): void; }
const navigation = [
  { label: 'Overview', suffix: '/overview', icon: LayoutDashboard },
  { label: 'AI Assistants', suffix: '/assistants', icon: Bot },
  { label: 'Conversations', suffix: '/conversations', icon: MessagesSquare },
  { label: 'Leads', suffix: '/leads', icon: BadgeDollarSign },
  { label: 'Pipeline', suffix: '/pipeline', icon: KanbanSquare },
  { label: 'Channels', suffix: '/channels', icon: Cable },
  { label: 'Knowledge Base', suffix: '/knowledge-base', icon: BookOpenText },
  { label: 'Team', suffix: '/team', icon: UsersRound },
  { label: 'Settings', suffix: '/settings', icon: Settings },
];
export function workspaceAccessCopy(tenantRole: TenantRole | 'OWNER' | undefined) {
  if (tenantRole === 'OWNER') return { label: 'ADMIN', detail: 'FULL ACCESS' };
  // Subscription data is not currently projected into the authenticated tenant payload.
  // Keep the fallback honest instead of inventing a paid plan.
  return { label: tenantRole === 'AGENT' ? 'TEAM ACCESS' : 'WORKSPACE ACCESS', detail: tenantRole === 'AGENT' ? 'ASSIGNED ROLE' : 'PLAN NOT AVAILABLE' };
}

export function Sidebar({ tenantId, tenantName, tenantRole, email, onLogout, onNavigate }: SidebarProps) {
  const isAgent = tenantRole === 'AGENT';
  const access = workspaceAccessCopy(tenantRole);
  return <aside className="flex h-full w-72 flex-col border-r border-white/[0.07] bg-[#0C0C0E] px-4 py-6 text-white">
    <div className="mb-10 px-3"><img src={samcheLogo} alt="SamChe Company LLC" className="h-16 w-40 object-contain object-left" /><p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-gold">AI Platform</p></div>
    <div className="mb-7 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3"><p className="truncate text-sm font-medium" title={tenantName}>{tenantName}</p><p className="mt-1 text-xs text-stone-400">{isAgent ? 'Read-only access' : tenantRole ?? 'Workspace access'}</p></div>
    <nav aria-label="Dashboard navigation" className="space-y-5">{[
      { title: 'MAIN', labels: ['Overview', 'Conversations'] },
      { title: 'AI SOLUTIONS', labels: ['AI Assistants', 'Channels', 'Knowledge Base'] },
      { title: 'DATA & INSIGHTS', labels: ['Leads', 'Pipeline', 'Team'] },
      { title: 'SETTINGS', labels: ['Settings'] },
    ].map((group) => <section key={group.title}><p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-stone-500">{group.title}</p>{navigation.filter((item) => group.labels.includes(item.label)).map(({ label, suffix, icon: Icon }) => <NavLink key={suffix} to={`/app/${tenantId}${suffix}`} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Icon aria-hidden="true" size={18} strokeWidth={1.8} />{label}</NavLink>)}</section>)}</nav>
    <div className="mt-auto border-t border-white/10 pt-5"><div className="rounded-lg border border-gold/20 bg-gold/10 px-3 py-3"><p className="text-[10px] font-semibold tracking-[0.16em] text-gold">{access.label}</p><p className="mt-1 text-sm font-semibold text-white">{access.detail}</p></div><p className="mt-4 truncate text-sm font-medium text-stone-300" title={email}>{email}</p><span className="mt-2 inline-flex rounded-md border border-gold/25 bg-gold/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold">{tenantRole ?? 'Workspace'}</span><button type="button" onClick={onLogout} className="mt-4 w-full rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-stone-400 transition hover:border-signal/30 hover:bg-signal/10 hover:text-white">Sign out</button></div>
  </aside>;
}
