import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from '../components/layout/app-shell';
import { LoginPage } from '../features/auth/login-page';
import { useAuth } from '../features/auth/auth-context';
import { useTenant } from '../features/tenants/tenant-context';

function LoadingScreen() {
  return <div className="grid min-h-screen place-items-center bg-canvas text-sm text-stone-500">Loading workspace…</div>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'checking') return <LoadingScreen />;
  return status === 'authenticated' ? <>{children}</> : <Navigate to="/login" replace />;
}

function DashboardEntry() {
  const { isLoading, selectedTenant, error } = useTenant();
  if (isLoading) return <LoadingScreen />;
  if (error) return <div className="panel p-6 text-sm text-red-800">Unable to load your tenants. Please refresh and try again.</div>;
  if (!selectedTenant) return <div className="panel max-w-xl p-7"><p className="eyebrow">No workspace access</p><h1 className="mt-2 text-xl font-semibold">No tenant is assigned to this account.</h1><p className="mt-2 text-sm text-stone-600">Contact your SamChe workspace owner to request access.</p></div>;
  return <Navigate to={`/app/${selectedTenant.id}/overview`} replace />;
}

function TenantRoute({ title, description }: { title: string; description: string }) {
  const { tenantId } = useParams();
  const { tenants, selectedTenant, isLoading, selectTenant } = useTenant();
  if (isLoading) return <LoadingScreen />;
  if (!tenantId || !tenants.some((tenant) => tenant.id === tenantId)) return <Navigate to="/app" replace />;
  if (selectedTenant?.id !== tenantId) {
    selectTenant(tenantId);
    return <LoadingScreen />;
  }

  return <AppShell><section className="panel px-6 py-8 sm:px-8"><p className="eyebrow">Phase 1–2 foundation</p><h1 className="page-title mt-3">{title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-stone-600">{description}</p></section></AppShell>;
}

const pages = [
  ['overview', 'Overview', 'Workspace insights will use verified backend data in the next phase.'],
  ['assistants', 'AI Assistants', 'Assistant management is the next functional module.'],
  ['conversations', 'Conversations', 'Conversation history will be introduced as a read-only tenant-scoped view.'],
  ['channels', 'Channels', 'Channel configuration will be introduced with backend-backed CRUD controls.'],
  ['knowledge-base', 'Knowledge Base', 'Text document management will be introduced with backend-backed CRUD controls.'],
  ['team', 'Team', 'Tenant member information will be presented as a read-only view.'],
  ['settings', 'Settings', 'Only backend-supported tenant and account settings will appear here.'],
] as const;

export function AppRouter() {
  return <Routes><Route path="/login" element={<LoginPage />} /><Route path="/app" element={<RequireAuth><DashboardEntry /></RequireAuth>} />{pages.map(([path, title, description]) => <Route key={path} path={`/app/:tenantId/${path}`} element={<RequireAuth><TenantRoute title={title} description={description} /></RequireAuth>} />)}<Route path="*" element={<Navigate to="/app" replace />} /></Routes>;
}

