import { afterEach, expect, test, vi } from 'vitest';
import { registerDashboardServiceWorker } from './lib/pwa';

afterEach(() => vi.restoreAllMocks());

test('registers the Dashboard service worker without forcing an update takeover', async () => {
  const register = vi.fn().mockResolvedValue({ update: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  await registerDashboardServiceWorker();
  expect(register).toHaveBeenCalledWith('/service-worker.js', { scope: '/' });
});
