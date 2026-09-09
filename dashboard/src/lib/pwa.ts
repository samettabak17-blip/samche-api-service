export async function registerDashboardServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  if (registration?.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  registration?.addEventListener?.('updatefound', () => {
    const installing = registration.installing;
    if (installing) {
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          installing.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    }
  });
  await registration?.update?.().catch?.(() => {});
  return registration;
}
