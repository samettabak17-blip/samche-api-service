import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from '../components/layout/app-shell';
import { LoginPage } from '../features/auth/login-page';
import { AcceptInvitationPage } from '../features/auth/accept-invitation-page';
import { ResetPasswordPage } from '../features/auth/reset-password-page';
import { useAuth } from '../features/auth/auth-context';
import { useTenant } from '../features/tenants/tenant-context';
import { OverviewPage } from '../features/overview/overview-page';
import { ConversationsPage } from '../features/conversations/conversations-page';
import { TeamPage } from '../features/team/team-page';
import { SettingsPage } from '../features/settings/settings-page';
import { AssistantsPage } from '../features/assistants/assistants-page';
import { ChannelsPage } from '../features/channels/channels-page';
import { KnowledgeBasePage } from '../features/knowledge-base/knowledge-base-page';
import { GuideExperiencePage } from '../features/guide-experience/guide-experience-page';
import { LeadsPage } from '../features/leads/leads-page';
import { PipelinePage } from '../features/pipeline/pipeline-page';
import { KnowledgeIntelligencePage } from '../features/knowledge-intelligence/knowledge-intelligence-page';

function LoadingScreen() { return <div className="grid min-h-screen place-items-center bg-canvas text-sm text-stone-500">Loading workspace…</div>; }
function RequireAuth({ children }: { children: ReactNode }) { const { status } = useAuth(); if (status === 'checking') return <LoadingScreen />; return status === 'authenticated' ? <>{children}</> : <Navigate to="/login" replace />; }
function DashboardEntry() {
  const { isLoading, selectedTenant, error } = useTenant();
  if (isLoading) return <LoadingScreen />;
  if (error) return <div className="panel p-6 text-sm text-red-800">Unable to load your tenants. Please refresh and try again.</div>;
  if (!selectedTenant) return <div className="panel max-w-xl p-7"><p className="eyebrow">No workspace access</p><h1 className="mt-2 text-xl font-semibold">No tenant is assigned to this account.</h1><p className="mt-2 text-sm text-stone-600">Contact your SamChe workspace owner to request access.</p></div>;
  return <Navigate to={`/app/${selectedTenant.id}/overview`} replace />;
}

/**
 * One authenticated tenant layout stays mounted while nested dashboard pages
 * change. The global Live Support coordinator therefore owns exactly one
 * attention stream, title, favicon and alarm per active dashboard tab.
 */
function TenantDashboardLayout() {
  const { tenantId } = useParams();
  const { tenants, selectedTenant, isLoading, selectTenant } = useTenant();
  if (isLoading) return <LoadingScreen />;
  if (!tenantId || !tenants.some((item) => item.id === tenantId)) return <Navigate to="/app" replace />;
  if (selectedTenant?.id !== tenantId) { selectTenant(tenantId); return <LoadingScreen />; }
  return <AppShell><Outlet /></AppShell>;
}

export function AppRouter() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/app" element={<RequireAuth><DashboardEntry /></RequireAuth>} />
    <Route path="/app/:tenantId" element={<RequireAuth><TenantDashboardLayout /></RequireAuth>}>
      <Route path="overview" element={<OverviewPage />} />
      <Route path="conversations" element={<Navigate to="whatsapp" replace />} />
      <Route path="conversations/:channel" element={<ConversationsPage />} />
      <Route path="conversations/:channel/:conversationId" element={<ConversationsPage />} />
      <Route path="leads" element={<LeadsPage />} />
      <Route path="leads/:leadId" element={<LeadsPage />} />
      <Route path="pipeline" element={<PipelinePage />} />
      <Route path="pipeline/:dealId" element={<PipelinePage />} />
      <Route path="team" element={<TeamPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="assistants" element={<AssistantsPage />} />
      <Route path="assistants/:assistantId" element={<AssistantsPage />} />
      <Route path="channels" element={<ChannelsPage />} />
      <Route path="channels/:channelId" element={<ChannelsPage />} />
      <Route path="guide-experience" element={<GuideExperiencePage />} />
      <Route path="knowledge-base" element={<KnowledgeBasePage />} />
      <Route path="knowledge-base/:documentId" element={<KnowledgeBasePage />} />
      <Route path="knowledge" element={<KnowledgeIntelligencePage />} />
      <Route path="knowledge-base/intelligence" element={<KnowledgeIntelligencePage />} />
      <Route path="knowledge-base/sources" element={<KnowledgeIntelligencePage />} />
      <Route path="knowledge-base/candidates" element={<KnowledgeIntelligencePage />} />
      <Route path="knowledge-base/gaps" element={<KnowledgeIntelligencePage />} />
      <Route path="knowledge-base/profile" element={<KnowledgeIntelligencePage />} />
      <Route path="knowledge-base/configurations" element={<KnowledgeIntelligencePage />} />
      <Route path="knowledge-base/retrieval" element={<KnowledgeIntelligencePage />} />
    </Route>
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes>;
}
