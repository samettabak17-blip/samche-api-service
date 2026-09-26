import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Unlink, Bot, Instagram, ShieldCheck, Key, Download, Bell } from 'lucide-react';
import { DashboardButton, DashboardField, DashboardInput, DashboardSelect, DashboardFormMessage } from '../../components/ui/dashboard-control';
import { ConfirmationDialog } from '../../components/ui/confirmation-dialog';
import { SkeletonBlock } from '../../components/ui/async-state';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import type { Assistant, InstagramChannelStatusResponse, InstagramHistoryImportResponse } from '../../types/api';

export interface InstagramConnectionCardProps {
  tenantId: string;
  canManage: boolean;
  assistants: Assistant[];
}
export function InstagramConnectionCard({
  tenantId,
  canManage,
  assistants,
}: InstagramConnectionCardProps) {
  const queryClient = useQueryClient();
  const eligibleAssistants = assistants.filter(
    (a) => String(a.status ?? 'active').toLowerCase() === 'active'
  );

  const [isConfiguring, setIsConfiguring] = useState(false);
  const [displayName, setDisplayName] = useState('Instagram');
  const [pageId, setPageId] = useState('');
  const [accountUsername, setAccountUsername] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [activationPolicy, setActivationPolicy] = useState<import('../../types/api').AiActivationPolicy>('MANUAL_ONLY');
  const [triggersInput, setTriggersInput] = useState('');
  const [leadNotificationEnabled, setLeadNotificationEnabled] = useState(true);
  const [leadNotificationWhatsapp, setLeadNotificationWhatsapp] = useState('');
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(
    eligibleAssistants[0]?.id ?? ''
  );
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [importSummary, setImportSummary] = useState<InstagramHistoryImportResponse | null>(null);

  const statusQuery = useQuery({
    queryKey: tenantKeys.instagramStatus(tenantId),
    queryFn: () => tenantApi.getInstagramStatus(tenantId),
    staleTime: 30000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tenantKeys.instagramStatus(tenantId) }),
      queryClient.invalidateQueries({ queryKey: tenantKeys.channels(tenantId) }),
    ]);
  };

  const configureMutation = useMutation({
    mutationFn: async () => {
      setLocalFeedback(null);
      const parsedTriggers = triggersInput
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean);

      return tenantApi.configureInstagram(tenantId, {
        display_name: displayName.trim() || 'Instagram',
        auth_mode: 'INSTAGRAM_LOGIN',
        activation_policy: activationPolicy,
        activation_triggers: parsedTriggers,
        lead_notification_enabled: leadNotificationEnabled,
        lead_notification_whatsapp: leadNotificationWhatsapp.trim() || null,
        visual_ai_enabled: false,
        instagram_account_id: pageId.trim() || undefined,
        page_id: pageId.trim() || undefined,
        instagram_business_account_id: pageId.trim() || undefined,
        account_username: accountUsername.trim() || undefined,
        access_token: accessToken.trim() || undefined,
        assistant_id: selectedAssistantId || null,
        status: 'active',
      });
    },
    onSuccess: async () => {
      await invalidate();
      setIsConfiguring(false);
      setAccessToken('');
      setLocalFeedback({ type: 'success', message: 'Instagram channel connected successfully.' });
    },
    onError: (err: any) => {
      setLocalFeedback({
        type: 'error',
        message: err?.body?.message || err?.message || 'Failed to configure Instagram channel.',
      });
    },
  });

  const importHistoryMutation = useMutation({
    mutationFn: () => tenantApi.importInstagramHistory(tenantId, 100),
    onSuccess: (data) => {
      setImportSummary(data);
      setLocalFeedback({
        type: 'success',
        message: `Import completed! ${data.conversations_imported} conversations and ${data.messages_imported} messages imported (${data.duplicates_skipped} duplicates skipped).`,
      });
    },
    onError: (err: any) => {
      setLocalFeedback({
        type: 'error',
        message: err?.body?.message || err?.message || 'Failed to import Instagram history.',
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => tenantApi.disconnectInstagram(tenantId),
    onSuccess: async () => {
      await invalidate();
      setDisconnectDialogOpen(false);
      setIsConfiguring(false);
      setLocalFeedback({ type: 'success', message: 'Instagram channel disconnected.' });
    },
    onError: (err: any) => {
      setLocalFeedback({
        type: 'error',
        message: err?.body?.message || err?.message || 'Failed to disconnect Instagram channel.',
      });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: () => tenantApi.testInstagramConnection(tenantId),
    onSuccess: async (data) => {
      await invalidate();
      if (data.healthy) {
        setLocalFeedback({
          type: 'success',
          message: `Connection healthy! Meta Graph verified account: ${data.account_name || data.account_username || data.instagram_account_id || data.page_id || 'Active'}`,
        });
      } else {
        setLocalFeedback({
          type: 'error',
          message: data.message || data.error || 'Instagram connection test failed.',
        });
      }
    },
    onError: (err: any) => {
      setLocalFeedback({
        type: 'error',
        message: err?.body?.message || err?.message || 'Connection test request failed.',
      });
    },
  });


  if (statusQuery.isLoading) {
    return (
      <div className="panel space-y-3 p-5">
        <SkeletonBlock className="h-6 w-48" />
        <SkeletonBlock className="h-20" />
      </div>
    );
  }

  const statusData: InstagramChannelStatusResponse = statusQuery.data ?? {
    status: 'DISCONNECTED',
    connected: false,
  };

  const isConnected = statusData.status === 'CONNECTED' && statusData.connected;
  const isReauthRequired = statusData.status === 'REAUTH_REQUIRED';
  const isDisconnected = statusData.status === 'DISCONNECTED' || !statusData.connected;

  const currentAssistantName =
    statusData.assistant_name ||
    eligibleAssistants.find((a) => a.id === statusData.assistant_id)?.name ||
    'None assigned';

  return (
    <div className="panel space-y-5 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-pink-500/20 via-purple-500/20 to-amber-500/20 text-pink-400 ring-1 ring-pink-500/30">
            <Instagram size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">Instagram Messaging / Instagram DM</h2>
              {isConnected && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 size={12} /> Connected
                </span>
              )}
              {isReauthRequired && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  <AlertTriangle size={12} /> Re-auth Required
                </span>
              )}
              {isDisconnected && !isReauthRequired && (
                <span className="inline-flex items-center gap-1 rounded-full border border-stone-600 bg-stone-800 px-2.5 py-0.5 text-xs font-semibold text-stone-400">
                  Not connected
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-stone-400">
              Connect tenant-scoped Instagram Business accounts via Instagram Login to automate direct messaging with AI assistants.
            </p>
          </div>
        </div>

        {canManage && isConnected && !isConfiguring && (
          <div className="flex flex-wrap items-center gap-2">
            <DashboardButton
              type="button"
              variant="secondary"
              onClick={() => importHistoryMutation.mutate()}
              disabled={importHistoryMutation.isPending}
              className="gap-1.5 text-xs"
            >
              <Download size={14} className={importHistoryMutation.isPending ? 'animate-bounce' : ''} />
              {importHistoryMutation.isPending ? 'Importing…' : 'Import Last 100 Conversations'}
            </DashboardButton>
            <DashboardButton
              type="button"
              variant="secondary"
              onClick={() => testConnectionMutation.mutate()}
              disabled={testConnectionMutation.isPending}
              className="gap-1.5 text-xs"
            >
              <RefreshCw size={14} className={testConnectionMutation.isPending ? 'animate-spin' : ''} />
              {testConnectionMutation.isPending ? 'Testing…' : 'Test Connection'}
            </DashboardButton>
            <DashboardButton
              type="button"
              variant="secondary"
              onClick={() => {
                setDisplayName(statusData.display_name || 'Instagram');
                setPageId(statusData.instagram_account_id || statusData.page_id || statusData.external_channel_id || '');
                setAccountUsername(statusData.account_username || '');
                setSelectedAssistantId(statusData.assistant_id || eligibleAssistants[0]?.id || '');
                setActivationPolicy(statusData.activation_policy || 'MANUAL_ONLY');
                setTriggersInput(Array.isArray(statusData.activation_triggers) ? statusData.activation_triggers.join(', ') : '');
                setLeadNotificationEnabled(statusData.lead_notification_enabled !== false);
                setLeadNotificationWhatsapp(statusData.lead_notification_whatsapp || '');
                setIsConfiguring(true);
              }}
              className="gap-1.5 text-xs"
            >
              Configure
            </DashboardButton>
            <DashboardButton
              type="button"
              variant="destructive"
              onClick={() => setDisconnectDialogOpen(true)}
              className="gap-1.5 text-xs"
            >
              <Unlink size={14} /> Disconnect
            </DashboardButton>
          </div>
        )}

      </div>

      {localFeedback && (
        <DashboardFormMessage
          tone={localFeedback.type}
        >
          {localFeedback.message}
        </DashboardFormMessage>
      )}

      {/* History Import Summary Banner */}
      {importSummary && (
        <div className="rounded-xl border border-gold/30 bg-gold/10 p-4 text-xs text-gold space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm text-gold flex items-center gap-1.5">
              <Download size={15} /> Instagram History Import Summary ({importSummary.status})
            </span>
            <button
              type="button"
              onClick={() => setImportSummary(null)}
              className="text-stone-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-white pt-1">
            <div className="rounded-lg bg-surface/80 p-2.5">
              <p className="text-stone-400 text-[11px]">Discovered</p>
              <p className="font-semibold text-base">{importSummary.conversations_discovered}</p>
            </div>
            <div className="rounded-lg bg-surface/80 p-2.5">
              <p className="text-stone-400 text-[11px]">Conversations Imported</p>
              <p className="font-semibold text-base text-emerald-400">{importSummary.conversations_imported}</p>
            </div>
            <div className="rounded-lg bg-surface/80 p-2.5">
              <p className="text-stone-400 text-[11px]">Messages Imported</p>
              <p className="font-semibold text-base text-sky-400">{importSummary.messages_imported}</p>
            </div>
            <div className="rounded-lg bg-surface/80 p-2.5">
              <p className="text-stone-400 text-[11px]">Duplicates Skipped</p>
              <p className="font-semibold text-base text-stone-300">{importSummary.duplicates_skipped}</p>
            </div>
          </div>
        </div>
      )}


      {/* Re-auth alert */}
      {isReauthRequired && !isConfiguring && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="flex-1 space-y-1">
            <p className="font-semibold text-amber-300">Access Token Expired or Revoked</p>
            <p className="text-amber-200/80">
              Meta reported an authentication error (OAuth token expired or revoked). Update your Instagram Access Token to resume automated AI responses.
            </p>
          </div>
          {canManage && (
            <DashboardButton
              type="button"
              variant="primary"
              onClick={() => {
                setDisplayName(statusData.display_name || 'Instagram');
                setPageId(statusData.instagram_account_id || statusData.page_id || statusData.external_channel_id || '');
                setAccountUsername(statusData.account_username || '');
                setSelectedAssistantId(statusData.assistant_id || eligibleAssistants[0]?.id || '');
                setActivationPolicy(statusData.activation_policy || 'MANUAL_ONLY');
                setTriggersInput(Array.isArray(statusData.activation_triggers) ? statusData.activation_triggers.join(', ') : '');
                setIsConfiguring(true);
              }}
              className="shrink-0 text-xs"
            >
              Reconnect
            </DashboardButton>
          )}
        </div>
      )}

      {/* Connected State Overview */}
      {isConnected && !isConfiguring && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 rounded-xl border border-line bg-elevated/30 p-4">
          <div>
            <span className="text-xs font-medium text-stone-400">Instagram Account</span>
            <p className="mt-0.5 font-semibold text-sm text-white">
              {statusData.account_username ? `@${statusData.account_username.replace(/^@/, '')}` : statusData.account_name || statusData.display_name || 'Instagram'}
            </p>
            {(statusData.instagram_account_id || statusData.page_id) && (
              <p className="text-[11px] font-mono text-stone-400">ID: {statusData.instagram_account_id || statusData.page_id}</p>
            )}
          </div>
          <div>
            <span className="text-xs font-medium text-stone-400">Assigned AI Assistant</span>
            <p className="mt-0.5 font-semibold text-sm text-white flex items-center gap-1.5">
              <Bot size={14} className="text-signal" />
              {currentAssistantName}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-stone-400">AI Activation Policy</span>
            <p className="mt-0.5 font-semibold text-sm text-stone-200">
              {statusData.activation_policy === 'ALL_MESSAGES' ? 'All Messages'
                : statusData.activation_policy === 'BUSINESS_INTENT_ONLY' ? 'Business Intent Only'
                : statusData.activation_policy === 'TRIGGER_ONLY' ? `Triggers (${statusData.activation_triggers?.length || 0})`
                : 'Manual Only (Silent)'}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-stone-400">Connection Health</span>
            <p className="mt-0.5 font-semibold text-sm text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck size={14} />
              Healthy
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-stone-400">Token Status</span>
            <p className="mt-0.5 font-semibold text-sm text-stone-300 flex items-center gap-1.5" title="Access tokens are stored securely server-side and never returned in UI responses">
              <Key size={14} className="text-stone-400" />
              Configured (Protected)
            </p>
          </div>
          <div className="sm:col-span-2 lg:col-span-5 pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-stone-400 flex items-center gap-1.5">
              <Bell size={13} className="text-gold" />
              Internal Lead WhatsApp: {statusData.lead_notification_whatsapp ? <span className="font-mono text-emerald-400">{statusData.lead_notification_whatsapp}</span> : <span className="text-stone-400">Not configured</span>}
            </span>
            <span className="text-stone-400">
              Mode: <span className="text-stone-300">Text-only (Visual AI restricted)</span>
            </span>
          </div>
        </div>
      )}


      {/* Disconnected or Configuration Form */}
      {(isDisconnected || isConfiguring) && (
        <div className="space-y-4 rounded-xl border border-line bg-elevated/30 p-5">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white">
              {isConnected ? 'Update Instagram Channel Configuration' : 'Connect Instagram Channel'}
            </h3>
            <p className="text-xs text-stone-400">
              Provide your Meta Instagram Professional Account credentials via Instagram Login. Access tokens are protected and never displayed after saving.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              configureMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <DashboardField
                label="Display Name"
                helper="Friendly name displayed on your Channels dashboard."
              >
                <DashboardInput
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. SamChe Instagram"
                  disabled={!canManage || configureMutation.isPending}
                  required
                />
              </DashboardField>

              <DashboardField
                label="Assigned AI Assistant"
                helper="The assistant that handles customer direct messages on Instagram."
              >
                <DashboardSelect
                  value={selectedAssistantId}
                  onChange={(e) => setSelectedAssistantId(e.target.value)}
                  disabled={!canManage || configureMutation.isPending || eligibleAssistants.length === 0}
                >
                  {eligibleAssistants.length === 0 ? (
                    <option value="">No active assistants available</option>
                  ) : (
                    eligibleAssistants.map((assistant) => (
                      <option key={assistant.id} value={assistant.id}>
                        {assistant.name}
                      </option>
                    ))
                  )}
                </DashboardSelect>
              </DashboardField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <DashboardField
                label="Instagram Account ID"
                helper="Instagram Professional Account ID from Meta Developer Console (e.g. 17841400000000000)."
              >
                <DashboardInput
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  placeholder="e.g. 17841400000000000"
                  disabled={!canManage || configureMutation.isPending}
                />
              </DashboardField>

              <DashboardField
                label="Account Username (Optional)"
                helper="Instagram handle for reference (e.g. samchecompany)."
              >
                <DashboardInput
                  value={accountUsername}
                  onChange={(e) => setAccountUsername(e.target.value)}
                  placeholder="e.g. samchecompany"
                  disabled={!canManage || configureMutation.isPending}
                />
              </DashboardField>
            </div>

            <DashboardField
              label="AI Activation Policy"
              helper="Controls when the AI assistant automatically replies to incoming Instagram Direct Messages. New channels default to Manual Only."
            >
              <DashboardSelect
                value={activationPolicy}
                onChange={(e) => setActivationPolicy(e.target.value as any)}
                disabled={!canManage || configureMutation.isPending}
              >
                <option value="MANUAL_ONLY">Manual Only (AI stays silent - Recommended for initial setup)</option>
                <option value="BUSINESS_INTENT_ONLY">Business Intent Only (AI responds only to commercial inquiries)</option>
                <option value="TRIGGER_ONLY">Trigger Words / Rules Only (AI responds only when trigger keywords match)</option>
                <option value="ALL_MESSAGES">All Messages (AI responds to all customer messages)</option>
              </DashboardSelect>
            </DashboardField>

            {(activationPolicy === 'TRIGGER_ONLY' || activationPolicy === 'BUSINESS_INTENT_ONLY') && (
              <DashboardField
                label="Trigger Words / Phrases"
                helper={
                  activationPolicy === 'TRIGGER_ONLY'
                    ? 'AI only activates when customer message contains one of these keywords (comma or newline separated).'
                    : 'Optional strong business intent keywords (comma or newline separated).'
                }
              >
                <textarea
                  value={triggersInput}
                  onChange={(e) => setTriggersInput(e.target.value)}
                  placeholder="e.g. dubai, şirket, company, vize, visa, fiyat, randevu, bilgi"
                  rows={3}
                  disabled={!canManage || configureMutation.isPending}
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs text-ink placeholder-stone-500 transition focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
                />
              </DashboardField>
            )}

            <DashboardField
              label="Internal High-Intent WhatsApp Notification Destination"
              helper="When high-intent customers request an appointment or consultation, a silent internal WhatsApp alert is sent to this number. E.g. +971527288586"
            >
              <DashboardInput
                type="text"
                value={leadNotificationWhatsapp}
                onChange={(e) => setLeadNotificationWhatsapp(e.target.value)}
                placeholder="+971527288586"
                disabled={!canManage || configureMutation.isPending}
              />
            </DashboardField>

            <DashboardField
              label="Instagram Access Token"

              helper={
                isConnected
                  ? 'Leave blank to preserve existing token, or paste a new token to update/re-authenticate. For security, stored tokens are never displayed.'
                  : 'Instagram Access Token generated via Meta Developer Console (API setup with Instagram login) with instagram_business_basic and instagram_business_manage_messages permissions.'
              }
            >
              <DashboardInput
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={isConnected ? '••••••••••••••••••••••••••••••••' : 'EAAB... or IGA...'}
                disabled={!canManage || configureMutation.isPending}
                autoComplete="new-password"
              />
            </DashboardField>

            {canManage && (
              <div className="flex items-center gap-3 pt-2">
                <DashboardButton
                  type="submit"
                  variant="primary"
                  disabled={configureMutation.isPending || (!isConnected && !pageId && !accessToken)}
                  className="gap-2"
                >
                  {configureMutation.isPending ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Instagram size={15} />
                      {isConnected ? 'Save Changes' : 'Connect Instagram'}
                    </>
                  )}
                </DashboardButton>
                {isConfiguring && (
                  <DashboardButton
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setIsConfiguring(false);
                      setAccessToken('');
                    }}
                    disabled={configureMutation.isPending}
                  >
                    Cancel
                  </DashboardButton>
                )}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Disconnect confirmation dialog */}
      <ConfirmationDialog
        open={disconnectDialogOpen}
        title="Disconnect Instagram Channel"
        description="Are you sure you want to disconnect this Instagram channel? The AI assistant will stop replying to direct messages on Instagram."
        confirmLabel="Disconnect Channel"
        confirmVariant="destructive"
        isPending={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
        onCancel={() => setDisconnectDialogOpen(false)}
      />
    </div>
  );
}

