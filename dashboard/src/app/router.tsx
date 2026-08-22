import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from '../components/layout/app-shell';
import { LoginPage } from '../features/auth/login-page';
import { useAuth } from '../features/auth/auth-context';
import { useTenant } from '../features/tenants/tenant-context';
import { OverviewPage } from '../features/overview/overview-page';
import { ConversationsPage } from '../features/conversations/conversations-page';
import { TeamPage } from '../features/team/team-page';
import { SettingsPage } from '../features/settings/settings-page';

function LoadingScreen() {
  return <div className="grid min-h-screen place-items-center bg-canvas text-sm text-stone-500">Loading workspace…</div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
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

function TenantRoute({ children }: { children: ReactNode }) {
  const { tenantId } = useParams();
  const { tenants, selectedTenant, isLoading, selectTenant } = useTenant();
  if (isLoading) return <LoadingScreen />;
  if (!tenantId || !tenants.some((tenant) => tenant.id === tenantId)) return <Navigate to="/app" replace />;
  if (selectedTenant?.id !== tenantId) {
    selectTenant(tenantId);
    return <LoadingScreen />;
  }

  return <AppShell>{children}</AppShell>;
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <section className="panel px-6 py-8 sm:px-8"><p className="eyebrow">Coming in Phase 4</p><h1 className="page-title mt-3">{title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-stone-600">{description}</p></section>;
}

export function AppRouter() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/app" element={<RequireAuth><DashboardEntry /></RequireAuth>} />
    <Route path="/app/:tenantId/overview" element={<RequireAuth><TenantRoute><OverviewPage /></TenantRoute></RequireAuth>} />
    <Route path="/app/:tenantId/conversations" element={<RequireAuth><TenantRoute><ConversationsPage /></TenantRoute></RequireAuth>} />
    <Route path="/app/:tenantId/conversations/:conversationId" element={<RequireAuth><TenantRoute><ConversationsPage /></TenantRoute></RequireAuth>} />
    <Route path="/app/:tenantId/team" element={<RequireAuth><TenantRoute><TeamPage /></TenantRoute></RequireAuth>} />
    <Route path="/app/:tenantId/settings" element={<RequireAuth><TenantRoute><SettingsPage /></TenantRoute></RequireAuth>} />
    <Route path="/app/:tenantId/assistants" element={<RequireAuth><TenantRoute><PlaceholderPage title="AI Assistants" description="Assistant management is the next functional module." /></TenantRoute></RequireAuth>} />
    <Route path="/app/:tenantId/channels" element={<RequireAuth><TenantRoute><PlaceholderPage title="Channels" description="Channel configuration will be introduced with backend-backed CRUD controls." /></TenantRoute></RequireAuth>} />
    <Route path="/app/:tenantId/knowledge-base" element={<RequireAuth><TenantRoute><PlaceholderPage title="Knowledge Base" description="Text document management will be introduced with backend-backed CRUD controls." /></TenantRoute></RequireAuth>} />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes>;
}

