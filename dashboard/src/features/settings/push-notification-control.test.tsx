import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/dashboard-api', () => ({
  pushNotificationApi: {
    getCapability: vi.fn(),
    getPreference: vi.fn(),
    updatePreference: vi.fn(),
    registerSubscription: vi.fn(),
    unsubscribe: vi.fn(),
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
});
