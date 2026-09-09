import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/dashboard-api', () => ({
  pushNotificationApi: {
    getCapability: vi.fn(),
    getPreference: vi.fn(),
    updatePreference: vi.fn(),
    registerSubscription: vi.fn(),
    unsubscribe: vi.fn(),
    getSubscriptionStatus: vi.fn().mockResolvedValue({ registered: false, enabled: false, failureCode: null }),
  },
}));

import { pushNotificationApi } from '../dashboard/dashboard-api';
import { PushNotificationControl } from './push-notification-control';

afterEach(cleanup);

function setSupportedBrowser() {
  Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'default', requestPermission: vi.fn() } });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} });
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) } });
}

describe('PushNotificationControl', () => {
  it('explains that push is unavailable without asking for permission', async () => {
    setSupportedBrowser();
    vi.mocked(pushNotificationApi.getCapability).mockResolvedValue({ configured: false, publicKey: null });
    vi.mocked(pushNotificationApi.getPreference).mockResolvedValue({ push_enabled: true, categories: {} });
    render(<PushNotificationControl tenantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);
    expect(await screen.findByText('Push unavailable/not configured')).toBeVisible();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('requests notification permission only after the explicit enable action', async () => {
    setSupportedBrowser();
    vi.mocked(pushNotificationApi.getCapability).mockResolvedValue({ configured: true, publicKey: 'AQ' });
    vi.mocked(pushNotificationApi.getPreference).mockResolvedValue({ push_enabled: false, categories: {} });
    render(<PushNotificationControl tenantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable phone notifications' }));
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('offers device opt-in when server preferences are allowed but this browser has no subscription', async () => {
    setSupportedBrowser();
    vi.mocked(pushNotificationApi.getCapability).mockResolvedValue({ configured: true, publicKey: 'AQ' });
    vi.mocked(pushNotificationApi.getPreference).mockResolvedValue({ push_enabled: true, categories: {} });
    render(<PushNotificationControl tenantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);
    expect(await screen.findByRole('button', { name: 'Enable phone notifications' })).toBeVisible();
  });

  it('offers reconnect when permission is granted but subscription is stale or missing on server', async () => {
    setSupportedBrowser();
    Object.defineProperty(window.Notification, 'permission', { configurable: true, value: 'granted' });
    vi.mocked(pushNotificationApi.getCapability).mockResolvedValue({ configured: true, publicKey: 'AQ' });
    vi.mocked(pushNotificationApi.getPreference).mockResolvedValue({ push_enabled: true, categories: {} });
    vi.mocked(pushNotificationApi.getSubscriptionStatus).mockResolvedValue({ registered: false, enabled: false, failureCode: 'EXPIRED', lastDeliveredAt: null, hasActiveSubscription: false, activeSubscriptionCount: 0 });
    render(<PushNotificationControl tenantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);
    expect(await screen.findByRole('button', { name: 'Reconnect notifications' })).toBeVisible();
    expect(await screen.findByText('Re-enable notifications')).toBeVisible();
  });

  it('displays Enabled only when permission, local subscription, and server registration are all valid', async () => {
    setSupportedBrowser();
    Object.defineProperty(window.Notification, 'permission', { configurable: true, value: 'granted' });
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({
          endpoint: 'https://push.example.test/sub-1',
          options: { applicationServerKey: new Uint8Array([1]).buffer },
          toJSON: () => ({ endpoint: 'https://push.example.test/sub-1' }),
        }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) } });
    vi.mocked(pushNotificationApi.getCapability).mockResolvedValue({ configured: true, publicKey: 'AQ' });
    vi.mocked(pushNotificationApi.getPreference).mockResolvedValue({ push_enabled: true, categories: {} });
    vi.mocked(pushNotificationApi.getSubscriptionStatus).mockResolvedValue({ registered: true, enabled: true, failureCode: null, lastDeliveredAt: null, hasActiveSubscription: true, activeSubscriptionCount: 1 });
    render(<PushNotificationControl tenantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);
    expect(await screen.findByText('Enabled')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Disable phone notifications' })).toBeVisible();
  });
});
