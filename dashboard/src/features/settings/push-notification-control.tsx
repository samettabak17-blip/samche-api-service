import { useEffect, useMemo, useState } from 'react';
import { DashboardButton, DashboardFormMessage } from '../../components/ui/dashboard-control';
import { registerDashboardServiceWorker } from '../../lib/pwa';
import {
  pushNotificationApi,
  type PushNotificationCapability,
  type PushNotificationPreference,
  type PushSubscriptionStatus,
} from '../dashboard/dashboard-api';

type State = 'loading' | 'unsupported' | 'unavailable' | 'denied' | 'ready' | 'stale' | 'enabled' | 'error';

function browserSupportsPush() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

function applicationServerKey(value: string) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function applicationServerKeysMatch(appServerKey: ArrayBuffer | null, base64UrlPublicKey: string): boolean {
  if (!appServerKey || !base64UrlPublicKey) return false;
  try {
    const currentBytes = new Uint8Array(appServerKey);
    const expectedBytes = applicationServerKey(base64UrlPublicKey);
    if (currentBytes.length !== expectedBytes.length) return false;
    for (let i = 0; i < currentBytes.length; i++) {
      if (currentBytes[i] !== expectedBytes[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function PushNotificationControl({ tenantId }: { tenantId: string }) {
  const [capability, setCapability] = useState<PushNotificationCapability | null>(null);
  const [preference, setPreference] = useState<PushNotificationPreference | null>(null);
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const configured = Boolean(capability?.configured && capability.publicKey);

  useEffect(() => {
    let active = true;
    if (!browserSupportsPush()) { setState('unsupported'); return () => { active = false; }; }
    void Promise.all([pushNotificationApi.getCapability(tenantId), pushNotificationApi.getPreference(tenantId)])
      .then(async ([nextCapability, nextPreference]) => {
        if (!active) return;
        setCapability(nextCapability); setPreference(nextPreference);
        if (!nextCapability.configured || !nextCapability.publicKey) {
          setState('unavailable');
          return;
        }
        if (Notification.permission === 'denied') {
          setState('denied');
          return;
        }

        try {
          const registration = await (navigator.serviceWorker.ready || navigator.serviceWorker.getRegistration());
          const subscription = await registration?.pushManager?.getSubscription();
          if (!active) return;

          let serverStatus: PushSubscriptionStatus | null = null;
          let keysAligned = false;

          if (subscription && nextCapability.publicKey) {
            keysAligned = subscription.options?.applicationServerKey
              ? applicationServerKeysMatch(subscription.options.applicationServerKey, nextCapability.publicKey)
              : true;

            if (typeof pushNotificationApi.getSubscriptionStatus === 'function') {
              try {
                serverStatus = await pushNotificationApi.getSubscriptionStatus(tenantId, subscription.endpoint);
              } catch {}
            }
          }

          if (!active) return;

          const isPermissionGranted = Notification.permission === 'granted';
          const hasValidServerSub = Boolean(serverStatus?.registered && serverStatus?.enabled && !serverStatus?.failureCode);
          const isFullyUsable = Boolean(isPermissionGranted && subscription && keysAligned && hasValidServerSub && nextPreference.push_enabled);

          setDeviceSubscribed(isFullyUsable);

          if (isFullyUsable) {
            setState('enabled');
          } else if (isPermissionGranted) {
            setState('stale');
          } else {
            setState('ready');
          }
        } catch {
          if (active) setState('ready');
        }
      })
      .catch(() => { if (active) { setState('error'); setMessage('Notification settings could not be loaded.'); } });
    return () => { active = false; };
  }, [tenantId]);

  const label = useMemo(() => {
    if (state === 'unsupported') return 'Unsupported browser/device';
    if (state === 'unavailable') return 'Push unavailable/not configured';
    if (state === 'denied') return 'Permission denied';
    if (state === 'stale') return 'Re-enable notifications';
    if (state === 'enabled') return 'Enabled';
    if (state === 'error') return 'Notifications unavailable';
    return preference?.push_enabled ? 'Notifications available' : 'Notifications disabled';
  }, [preference?.push_enabled, state]);

  async function enable() {
    if (!configured || !browserSupportsPush()) return;
    setMessage('');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'ready'); return; }
    try {
      await registerDashboardServiceWorker();
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        try { await subscription.unsubscribe(); } catch {}
        subscription = null;
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(capability!.publicKey!),
      });
      await pushNotificationApi.registerSubscription(tenantId, subscription.toJSON());
      const nextPreference = await pushNotificationApi.updatePreference(tenantId, true);
      setPreference(nextPreference); setDeviceSubscribed(true); setState('enabled');
    } catch {
      setState('error'); setMessage('Phone notifications could not be enabled.');
    }
  }

  async function disable() {
    if (!browserSupportsPush()) return;
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await pushNotificationApi.unsubscribe(tenantId, subscription.endpoint);
        await subscription.unsubscribe();
      }
      const nextPreference = await pushNotificationApi.updatePreference(tenantId, false);
      setPreference(nextPreference); setDeviceSubscribed(false); setState('ready');
    } catch {
      setState('error'); setMessage('Phone notifications could not be disabled.');
    }
  }

  const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone)));

  const canEnable = state === 'ready' && configured;
  const canReconnect = state === 'stale' && configured;
  const canDisable = state === 'enabled' && configured && deviceSubscribed;
  return <section className="panel max-w-xl p-4 sm:p-6" aria-label="Phone notifications">
    <h2 className="font-semibold text-ink">Phone notifications</h2>
    <p className="mt-1 text-sm text-stone-500">Receive attention-worthy updates on this device.</p>
    {isIos && !isStandalone && (
      <p className="mt-2 text-xs text-amber-400">
        On iPhone/iPad, push notifications require adding this web app to your Home Screen first.
      </p>
    )}
    <p className="mt-4 text-sm font-medium text-ink break-words" role="status">{state === 'loading' ? 'Checking notification availability…' : label}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      {canEnable && <DashboardButton type="button" variant="primary" className="max-w-full whitespace-normal text-center h-auto min-h-10 py-2.5 px-4" onClick={() => { void enable(); }}>Enable phone notifications</DashboardButton>}
      {canReconnect && <DashboardButton type="button" variant="primary" className="max-w-full whitespace-normal text-center h-auto min-h-10 py-2.5 px-4" onClick={() => { void enable(); }}>Reconnect notifications</DashboardButton>}
      {canDisable && <DashboardButton type="button" variant="secondary" className="max-w-full whitespace-normal text-center h-auto min-h-10 py-2.5 px-4" onClick={() => { void disable(); }}>Disable phone notifications</DashboardButton>}
    </div>
    {message && <DashboardFormMessage tone="error">{message}</DashboardFormMessage>}
  </section>;
}
