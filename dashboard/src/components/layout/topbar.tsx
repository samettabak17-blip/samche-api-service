import { Building2, LogOut, Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import type { Tenant } from '../../types/api';
interface TopbarProps { tenants: Tenant[]; selectedTenantId: string; email: string; onSelectTenant(tenantId: string): void; onOpenNavigation(): void; onLogout(): void; }
export function Topbar({ tenants, selectedTenantId, email, onSelectTenant, onOpenNavigation, onLogout }: TopbarProps) {
  const location = useLocation();
  const knownSection = location.pathname.split('/').find((segment) => ['overview', 'conversations', 'leads', 'assistants', 'channels', 'knowledge-base', 'team', 'settings'].includes(segment));
  const title = ({ overview: 'Overview', conversations: 'Conversations', leads: 'Leads', assistants: 'AI Assistants', channels: 'Channels', 'knowledge-base': 'Knowledge Base', team: 'Team', settings: 'Settings' } as Record<string, string>)[knownSection ?? ''] ?? 'Overview';
  return <header className="flex min-h-[4.5rem] items-center justify-between border-b border-line bg-[#121214] px-4 sm:px-7 lg:px-10">
    <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={onOpenNavigation} className="grid h-10 w-10 place-items-center rounded-lg text-stone-600 lg:hidden" aria-label="Open navigation"><Menu aria-hidden="true" size={21} /></button><div className="min-w-0"><p className="text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</p></div></div>
    <div className="flex items-center gap-3"><div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"><label className="sr-only" htmlFor="tenant-select">Selected tenant</label><span className="mr-2 inline-block align-middle text-signal"><Building2 aria-hidden="true" size={15} /></span><select id="tenant-select" value={selectedTenantId} onChange={(event) => onSelectTenant(event.target.value)} className="max-w-40 truncate bg-transparent text-sm font-semibold text-ink outline-none sm:max-w-56">{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div><span className="hidden max-w-48 truncate text-sm text-stone-500 xl:block" title={email}>{email}</span><button type="button" onClick={onLogout} className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-stone-50 text-stone-400 transition hover:border-signal/30 hover:text-ink" aria-label="Sign out"><LogOut aria-hidden="true" size={18} /></button></div>
  </header>;
}
