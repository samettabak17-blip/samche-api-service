import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Unlink, Bot, Instagram, ShieldCheck, Key } from 'lucide-react';
import { DashboardButton, DashboardField, DashboardInput, DashboardSelect, DashboardFormMessage } from '../../components/ui/dashboard-control';
import { ConfirmationDialog } from '../../components/ui/confirmation-dialog';
import { SkeletonBlock } from '../../components/ui/async-state';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import type { Assistant, InstagramChannelStatusResponse } from '../../types/api';

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
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(
    eligibleAssistants[0]?.id ?? ''
  );
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

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
      return tenantApi.configureInstagram(tenantId, {
        display_name: displayName.trim() || 'Instagram',
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
          message: `Connection healthy! Meta Graph verified account: ${data.account_name || data.page_id || 'Active'}`,
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
              Connect tenant-scoped Instagram Business accounts and Meta Direct Messaging to automate customer conversations with AI assistants.
            </p>
          </div>
        </div>

        {canManage && isConnected && !isConfiguring && (
          <div className="flex items-center gap-2">
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
                setPageId(statusData.page_id || statusData.external_channel_id || '');
                setAccountUsername(statusData.account_username || '');
                setSelectedAssistantId(statusData.assistant_id || eligibleAssistants[0]?.id || '');
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

      {/* Re-auth alert */}
      {isReauthRequired && !isConfiguring && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="flex-1 space-y-1">
            <p className="font-semibold text-amber-300">Access Token Expired or Revoked</p>
            <p className="text-amber-200/80">
              Meta reported an authentication error (OAuth token expired). Update your Instagram Page Access Token to resume automated AI responses.
            </p>
          </div>
          {canManage && (
            <DashboardButton
              type="button"
              variant="primary"
              onClick={() => {
                setDisplayName(statusData.display_name || 'Instagram');
                setPageId(statusData.page_id || statusData.external_channel_id || '');
                setAccountUsername(statusData.account_username || '');
                setSelectedAssistantId(statusData.assistant_id || eligibleAssistants[0]?.id || '');
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-line bg-elevated/30 p-4">
          <div>
            <span className="text-xs font-medium text-stone-400">Instagram Account</span>
            <p className="mt-0.5 font-semibold text-sm text-white">
              {statusData.account_username ? `@${statusData.account_username.replace(/^@/, '')}` : statusData.account_name || statusData.display_name || 'Instagram'}
            </p>
            {statusData.page_id && (
              <p className="text-[11px] font-mono text-stone-400">ID: {statusData.page_id}</p>
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
            <span className="text-xs font-medium text-stone-400">Connection Health</span>
            <p className="mt-0.5 font-semibold text-sm text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck size={14} />
              Healthy
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-stone-400">Token Status</span>
            <p className="mt-0.5 font-semibold text-sm text-stone-300 flex items-center gap-1.5">
              <Key size={14} className="text-stone-400" />
              Configured (Encrypted)
            </p>
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
              Provide your Meta Instagram Business Account credentials. Access tokens are encrypted and never exposed.
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
                label="Instagram Account / Page ID"
                helper="Meta Page ID or Instagram Business Account ID."
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
              label="Meta Page Access Token"
              helper={
                isConnected
                  ? 'Leave blank to preserve existing token, or paste a new token to update/re-authenticate.'
                  : 'Meta Graph API Page Access Token with instagram_manage_messages and pages_messaging permissions.'
              }
            >
              <DashboardInput
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={isConnected ? '••••••••••••••••••••••••••••••••' : 'EAAB...'}
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

