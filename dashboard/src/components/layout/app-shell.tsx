import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/auth-context';
import { useTenant } from '../../features/tenants/tenant-context';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { GlobalLiveSupportIndicator, LiveSupportAttentionProvider } from '../../features/live-support/live-support-attention-provider';
import { OverviewDateRangeProvider } from '../../features/overview/overview-date-range-context';

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { tenants, selectedTenant, tenantRole, selectTenant, createTenant, adoptTenant } = useTenant();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    if (typeof document === 'undefined') return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOpen]);
  if (!user) return null;
  const role = user.system_role === 'OWNER' ? 'OWNER' : tenantRole;
  const switchTenant = (tenantId: string) => { selectTenant(tenantId); navigate('/app/' + tenantId + '/overview'); };
  if (!selectedTenant) {
    return <div className="min-h-screen bg-canvas"><Topbar tenants={tenants} selectedTenantId="" tenantId="" email={user.email} systemRole={user.system_role} selectedTenantRole={tenantRole} onCreateTenant={createTenant} onAdoptTenant={adoptTenant} onSelectTenant={switchTenant} onOpenNavigation={() => setMobileOpen(true)} onLogout={() => { logout(); navigate('/login'); }} /><main className="mx-auto max-w-2xl px-6 py-16"><h1 className="text-2xl font-semibold text-ink">Create your first company</h1><p className="mt-2 text-sm text-stone-400">Create a company to start setting up your workspace.</p></main></div>;
  }
  return <LiveSupportAttentionProvider tenantId={selectedTenant.id} userId={user.id}><OverviewDateRangeProvider><div className="dashboard-shell min-h-screen w-full max-w-full overflow-x-hidden bg-canvas lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
    <div className="hidden lg:block"><Sidebar tenantId={selectedTenant.id} tenantName={selectedTenant.name} tenantRole={role} email={user.email} onLogout={() => { logout(); navigate('/login'); }} onNavigate={() => undefined} /></div>
    {mobileOpen && <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu"><button type="button" aria-label="Close navigation" className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={() => setMobileOpen(false)} /><div className="relative z-10 flex h-screen h-[100dvh] max-h-screen max-h-[100dvh] min-h-0 w-72 max-w-[calc(100vw-3rem)] flex-col overflow-hidden shadow-2xl"><button type="button" onClick={() => setMobileOpen(false)} className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top,0.75rem))] z-20 grid h-10 w-10 place-items-center rounded-lg text-stone-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal" aria-label="Close navigation"><X aria-hidden="true" size={20} /></button><Sidebar tenantId={selectedTenant.id} tenantName={selectedTenant.name} tenantRole={role} email={user.email} onLogout={() => { logout(); navigate('/login'); }} onNavigate={() => setMobileOpen(false)} /></div></div>}
    <div className="min-w-0 w-full flex flex-col"><Topbar tenants={tenants} selectedTenantId={selectedTenant.id} tenantId={selectedTenant.id} email={user.email} systemRole={user.system_role} selectedTenantRole={tenantRole} onCreateTenant={createTenant} onAdoptTenant={adoptTenant} onSelectTenant={switchTenant} onOpenNavigation={() => setMobileOpen(true)} onLogout={() => { logout(); navigate('/login'); }} /><GlobalLiveSupportIndicator tenantId={selectedTenant.id} /><main className="w-full min-w-0 flex-1 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom,1.25rem))] sm:px-6 lg:px-7">{children}</main></div>
  </div></OverviewDateRangeProvider></LiveSupportAttentionProvider>;
}
