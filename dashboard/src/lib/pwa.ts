export async function registerDashboardServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  await registration.update();
  return registration;
}
