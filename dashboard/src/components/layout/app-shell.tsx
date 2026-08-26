import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/auth-context';
import { useTenant } from '../../features/tenants/tenant-context';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { GlobalLiveSupportIndicator, LiveSupportAttentionProvider } from '../../features/live-support/live-support-attention-provider';
import samcheBrandLogo from '../../assets/branding/samche-company-llc-logo.png';

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { tenants, selectedTenant, tenantRole, selectTenant } = useTenant();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!selectedTenant || !user) return null;

  const role = user.system_role === 'OWNER' ? 'OWNER' : tenantRole;
  const switchTenant = (tenantId: string) => {
    selectTenant(tenantId);
    navigate(`/app/${tenantId}/overview`);
  };

  return (
    <LiveSupportAttentionProvider tenantId={selectedTenant.id} userId={user.id}><div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[18rem_1fr]">
      <div className="hidden lg:block"><Sidebar tenantId={selectedTenant.id} tenantName={selectedTenant.name} tenantRole={role} email={user.email} onLogout={() => { logout(); navigate('/login'); }} onNavigate={() => undefined} /></div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-ink/45" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-72 shadow-2xl">
            <button type="button" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-lg text-stone-300 hover:bg-white/10" aria-label="Close navigation">
              <X aria-hidden="true" size={18} />
            </button>
            <Sidebar tenantId={selectedTenant.id} tenantName={selectedTenant.name} tenantRole={role} email={user.email} onLogout={() => { logout(); navigate('/login'); }} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        <Topbar tenants={tenants} selectedTenantId={selectedTenant.id} email={user.email} onSelectTenant={switchTenant} onOpenNavigation={() => setMobileOpen(true)} onLogout={() => { logout(); navigate('/login'); }} />
        <GlobalLiveSupportIndicator tenantId={selectedTenant.id} />
        <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-7 lg:px-10">{children}</main>
        <footer className="mx-auto flex w-full max-w-7xl items-center gap-3 border-t border-line px-4 py-4 text-xs text-stone-500 sm:px-7 lg:px-10">
          <img src={samcheBrandLogo} alt="SamChe" className="h-5 w-auto object-contain" />
          <span>{selectedTenant.name}</span><span aria-hidden="true">·</span><span>Dashboard</span>
        </footer>
      </div>
    </div></LiveSupportAttentionProvider>
  );
}

