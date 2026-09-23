import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Unlink, ExternalLink, MessageSquare, Bot } from 'lucide-react';
import { DashboardButton, DashboardField, DashboardSelect, DashboardFormMessage } from '../../components/ui/dashboard-control';
import { ConfirmationDialog } from '../../components/ui/confirmation-dialog';
import { SkeletonBlock } from '../../components/ui/async-state';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import type { Assistant, WhatsAppChannelStatusResponse, WhatsAppConfigResponse } from '../../types/api';

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string; accessToken?: string }; status?: string }) => void,
        options: Record<string, unknown>
      ) => void;
    };
  }
}

export function loadFacebookSdk(appId: string, version: string): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) {
      resolve();
      return;
    }
    const existing = document.getElementById('facebook-jssdk');
    if (existing) {
      window.fbAsyncInit = () => {
        window.FB?.init({
          appId,
          autoLogAppEvents: true,
          xfbml: true,
          version,
        });
        resolve();
      };
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version,
      });
      resolve();
    };
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
}

export interface WhatsAppEmbeddedSignupProps {
  tenantId: string;
export function WhatsAppEmbeddedSignup({
  tenantId,
  canManage,
  assistants,
}: WhatsAppEmbeddedSignupProps) {
  const queryClient = useQueryClient();
  const eligibleAssistants = assistants.filter(
    (a) => String(a.status ?? 'active').toLowerCase() === 'active'
  );

  const [selectedAssistantId, setSelectedAssistantId] = useState<string>(
    eligibleAssistants[0]?.id ?? ''
  );
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [connectingState, setConnectingState] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const metaMessageDataRef = useRef<{ waba_id?: string; phone_number_id?: string } | null>(null);

  const statusQuery = useQuery({
    queryKey: tenantKeys.whatsappStatus(tenantId),
    queryFn: () => tenantApi.getWhatsAppStatus(tenantId),
    staleTime: 30000,
  });

  const configQuery = useQuery({
    queryKey: tenantKeys.whatsappConfig(tenantId),
    queryFn: () => tenantApi.getWhatsAppConfig(tenantId),
    staleTime: 60000,
  });

  useEffect(() => {
    if (eligibleAssistants.length > 0 && !selectedAssistantId) {
      setSelectedAssistantId(eligibleAssistants[0].id);
    }
  }, [eligibleAssistants, selectedAssistantId]);

  useEffect(() => {
    if (statusQuery.data?.assistant?.id) {
      setSelectedAssistantId(statusQuery.data.assistant.id);
    }
  }, [statusQuery.data]);

  // Listen for Meta message events (WA_EMBEDDED_SIGNUP)
  useEffect(() => {
    function handleMetaMessage(event: MessageEvent) {
      if (!event.origin.endsWith('facebook.com') && !event.origin.endsWith('meta.com')) {
        return;
      }
      try {
        const raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (raw?.type === 'WA_EMBEDDED_SIGNUP') {
          if (raw.event === 'FINISH' || raw.data?.waba_id) {
            metaMessageDataRef.current = {
              waba_id: raw.data?.waba_id,
              phone_number_id: raw.data?.phone_number_id,
            };
          } else if (raw.event === 'CANCEL') {
            setConnectingState(null);
            setLocalError('Meta WhatsApp signup was cancelled.');
          } else if (raw.event === 'ERROR') {
            setConnectingState(null);
            setLocalError(raw.data?.error_message || 'Meta WhatsApp signup encountered an error.');
          }
        }
      } catch {
        // Non-JSON message event, ignore
      }
    }
    window.addEventListener('message', handleMetaMessage);
    return () => window.removeEventListener('message', handleMetaMessage);
  const connectMutation = useMutation({
    mutationFn: async (payload: {
      code: string;
      waba_id: string;
      phone_number_id?: string | null;
      assistant_id: string;
      state_token: string;
    }) => {
      return tenantApi.connectWhatsAppEmbeddedSignup(tenantId, payload);
    },
    onSuccess: async () => {
      setConnectingState(null);
      setLocalError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantKeys.whatsappStatus(tenantId) }),
        queryClient.invalidateQueries({ queryKey: tenantKeys.channels(tenantId) }),
      ]);
    },
    onError: (err: any) => {
      setConnectingState(null);
      setLocalError(err?.message || 'Failed to complete WhatsApp connection. Please try again.');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      return tenantApi.disconnectWhatsApp(tenantId);
    },
    onSuccess: async () => {
      setDisconnectDialogOpen(false);
      setLocalError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantKeys.whatsappStatus(tenantId) }),
        queryClient.invalidateQueries({ queryKey: tenantKeys.channels(tenantId) }),
      ]);
    },
    onError: (err: any) => {
      setLocalError(err?.message || 'Failed to disconnect WhatsApp channel.');
    },
  });

  async function handleStartEmbeddedSignup() {
    setLocalError(null);
    if (!selectedAssistantId) {
      setLocalError('Please select an active AI Assistant to handle WhatsApp conversations.');
      return;
    }

    const config = configQuery.data;
    if (!config?.configured || !config?.app_id || !config?.config_id || !config?.state_token) {
      setLocalError('Meta WhatsApp Embedded Signup is not fully configured on the server.');
      return;
    }

    setConnectingState('INITIALIZING_SDK');
    try {
      await loadFacebookSdk(config.app_id, config.graph_api_version || 'v23.0');
    } catch {
      setConnectingState(null);
      setLocalError('Failed to load Meta Facebook SDK. Please check your network connection.');
      return;
    }

    setConnectingState('AWAITING_META_POPUP');
    metaMessageDataRef.current = null;

    if (!window.FB) {
      setConnectingState(null);
      setLocalError('Facebook SDK could not be initialized.');
      return;
    }

    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          const code = response.authResponse.code;
          const wabaId = metaMessageDataRef.current?.waba_id;
          const phoneNumberId = metaMessageDataRef.current?.phone_number_id;

          if (!wabaId) {
            setConnectingState(null);
            setLocalError('WhatsApp Business Account was not selected or authorized in the Meta popup.');
            return;
          }

          setConnectingState('EXCHANGING_CREDENTIALS');
          connectMutation.mutate({
            code,
            waba_id: wabaId,
            phone_number_id: phoneNumberId || null,
            assistant_id: selectedAssistantId,
            state_token: config.state_token!,
          });
        } else {
          setConnectingState(null);
          if (response.status !== 'connected') {
            setLocalError('Meta authorization was not completed.');
          }
        }
      },
      {
        config_id: config.config_id,
        response_type: 'code',
  if (statusQuery.isLoading || configQuery.isLoading) {
    return (
      <div className="panel p-6 space-y-4">
        <div className="flex items-center gap-3">
          <SkeletonBlock className="h-10 w-10 rounded-xl" />
          <div className="space-y-2 flex-1">
            <SkeletonBlock className="h-5 w-48" />
            <SkeletonBlock className="h-4 w-72" />
          </div>
        </div>
      </div>
    );
  }

  const status = statusQuery.data;
  const config = configQuery.data;
  const isConnected = status?.status === 'CONNECTED';
  const isActionRequired = status?.status === 'ACTION_REQUIRED';
  const isNotEntitled = config?.entitled === false || status?.entitled === false;
  const isConnecting = connectingState !== null || connectMutation.isPending;

  return (
    <div className="panel overflow-hidden border border-line bg-card/60 p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <MessageSquare size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold text-white">WhatsApp Business AI</h2>
              {isConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                  <CheckCircle2 size={12} /> Connected
                </span>
              )}
              {isActionRequired && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/60 border border-amber-500/30 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  <AlertTriangle size={12} /> Action required
                </span>
              )}
              {!isConnected && !isActionRequired && (
                <span className="inline-flex items-center gap-1 rounded-full bg-stone-900 border border-stone-700 px-2.5 py-0.5 text-xs font-semibold text-stone-400">
                  Not connected
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-stone-400">
              Connect your customer-owned WhatsApp Business Account to allow your AI Assistant to handle inbound customer chats directly.
            </p>
          </div>
        </div>

        {isConnected && canManage && (
          <div className="flex items-center gap-2">
            <DashboardButton
              type="button"
              variant="secondary"
              onClick={handleStartEmbeddedSignup}
              disabled={isConnecting}
              className="text-xs"
            >
              <RefreshCw size={14} className={isConnecting ? 'animate-spin' : ''} />
              Reconnect
            </DashboardButton>
            <DashboardButton
              type="button"
              variant="destructive"
              onClick={() => setDisconnectDialogOpen(true)}
              disabled={disconnectMutation.isPending}
              className="text-xs"
            >
              <Unlink size={14} />
              Disconnect
            </DashboardButton>
          </div>
        )}
      </div>

      {localError && (
        <DashboardFormMessage tone="error">{localError}</DashboardFormMessage>
      )}

      {isNotEntitled && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
            <AlertTriangle size={16} />
            WhatsApp AI requires a Growth or higher subscription
          </div>
          <p className="text-xs text-amber-200/80">
            Your current subscription does not include WhatsApp AI channel integration. Upgrade your plan or request an entitlement override from your platform administrator.
          </p>
        </div>
      )}

      {isConnected && status?.connection && (
        <div className="grid gap-4 rounded-xl border border-line bg-elevated/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-xs font-medium text-stone-400">Verified Name</span>
            <p className="mt-0.5 font-semibold text-sm text-white">
              {status.connection.verified_name || status.channel?.display_name || 'WhatsApp Business'}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-stone-400">Phone Number</span>
            <p className="mt-0.5 font-mono text-sm text-white">
              {status.connection.display_phone_number || status.connection.phone_number_id || 'Configured'}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-stone-400">WABA Account ID</span>
            <p className="mt-0.5 font-mono text-xs text-stone-300 truncate" title={status.connection.waba_id || ''}>
              {status.connection.waba_id || 'Platform'}
            </p>
          </div>
          <div>
      {!isConnected && (
        <div className="space-y-4 rounded-xl border border-line bg-elevated/30 p-5">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white">Connect Official WhatsApp</h3>
            <p className="text-xs text-stone-400">
              Sign up or connect an existing WhatsApp Business Account through Meta's secure embedded onboarding. No developer steps or token sharing required.
            </p>
          </div>

          <div className="max-w-md">
            <DashboardField
              label="Assigned AI Assistant"
              helper="The active assistant that will formulate intelligent responses for incoming customer messages."
            >
              <DashboardSelect
                value={selectedAssistantId}
                onChange={(e) => setSelectedAssistantId(e.target.value)}
                disabled={!canManage || isConnecting || eligibleAssistants.length === 0}
              >
                {eligibleAssistants.length === 0 ? (
                  <option value="">No active assistants found</option>
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

          {canManage && (
            <div className="pt-2">
              <DashboardButton
                type="button"
                variant="primary"
                onClick={handleStartEmbeddedSignup}
                disabled={isConnecting || isNotEntitled || eligibleAssistants.length === 0}
                className="gap-2.5"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {connectingState === 'INITIALIZING_SDK' && 'Initializing Meta SDK…'}
                    {connectingState === 'AWAITING_META_POPUP' && 'Complete Meta popup…'}
                    {connectingState === 'EXCHANGING_CREDENTIALS' && 'Connecting channel…'}
                    {!connectingState && 'Connecting…'}
                  </>
                ) : (
                  <>
                    <MessageSquare size={16} />
                    Connect WhatsApp
                  </>
                )}
              </DashboardButton>
            </div>
          )}
        </div>
      )}

      <ConfirmationDialog
        open={disconnectDialogOpen}
        title="Disconnect WhatsApp Channel"
        description="Are you sure you want to disconnect this WhatsApp channel? The AI assistant will stop replying to incoming WhatsApp messages until reconnected."
        confirmLabel="Disconnect Channel"
        confirmVariant="destructive"
        isPending={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
        onCancel={() => setDisconnectDialogOpen(false)}
      />
    </div>
  );
}

            <span className="text-xs font-medium text-stone-400">Assigned AI Assistant</span>
            <p className="mt-0.5 font-semibold text-sm text-white flex items-center gap-1.5">
              <Bot size={14} className="text-signal" />
              {status.assistant?.name || 'Assigned'}
            </p>
          </div>
        </div>
      )}

        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      }
    );
  }

  }, []);

  canManage: boolean;
  assistants: Assistant[];
}
