import { useEffect, useMemo, useState } from 'react';
import { DashboardButton, DashboardFormMessage } from '../../components/ui/dashboard-control';
import { pushNotificationApi, type PushNotificationCapability, type PushNotificationPreference } from '../dashboard/dashboard-api';

type State = 'loading' | 'unsupported' | 'unavailable' | 'denied' | 'ready' | 'enabled' | 'error';

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
        if (!nextCapability.configured || !nextCapability.publicKey) setState('unavailable');
        else if (Notification.permission === 'denied') setState('denied');
        else {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          if (!active) return;
          setDeviceSubscribed(Boolean(subscription));
          setState(nextPreference.push_enabled && subscription ? 'enabled' : 'ready');
        }
      })
      .catch(() => { if (active) { setState('error'); setMessage('Notification settings could not be loaded.'); } });
    return () => { active = false; };
  }, [tenantId]);

  const label = useMemo(() => {
    if (state === 'unsupported') return 'Unsupported browser/device';
    if (state === 'unavailable') return 'Push unavailable/not configured';
    if (state === 'denied') return 'Permission denied';
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
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(capability!.publicKey!) });
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

  const canEnable = state === 'ready' && configured && !deviceSubscribed;
  const canDisable = state === 'enabled' && configured && deviceSubscribed;
  return <section className="panel max-w-xl p-6" aria-label="Phone notifications">
    <h2 className="font-semibold text-ink">Phone notifications</h2>
    <p className="mt-1 text-sm text-stone-500">Receive attention-worthy updates on this device.</p>
    <p className="mt-4 text-sm font-medium text-ink" role="status">{state === 'loading' ? 'Checking notification availability…' : label}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      {canEnable && <DashboardButton type="button" variant="primary" onClick={() => { void enable(); }}>Enable phone notifications</DashboardButton>}
      {canDisable && <DashboardButton type="button" variant="secondary" onClick={() => { void disable(); }}>Disable phone notifications</DashboardButton>}
    </div>
    {message && <DashboardFormMessage tone="error">{message}</DashboardFormMessage>}
  </section>;
}
