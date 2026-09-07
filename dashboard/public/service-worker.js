const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const DASHBOARD_ROUTE = '(?:overview|settings|team|guide-experience|knowledge(?:-base)?(?:/[a-z-]+)?|conversations/[a-z_-]+(?:/' + UUID + ')?|leads(?:/' + UUID + ')?|pipeline(?:/' + UUID + ')?|assistants(?:/' + UUID + ')?|channels(?:/' + UUID + ')?)';

function isAllowedDashboardPath(value) {
  return typeof value === 'string'
    && value.length <= 512
    && new RegExp('^/app/' + UUID + '/' + DASHBOARD_ROUTE + '$', 'i').test(value);
}

function safeDeepLink(value) {
  return isAllowedDashboardPath(value) ? value : '/';
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  const payload = event.data?.json?.() ?? {};
  const type = typeof payload.type === 'string' ? payload.type.slice(0, 64) : 'NOTIFICATION';
  const deepLink = safeDeepLink(payload.deepLink);
  event.waitUntil(self.registration.showNotification('SamChe', {
    body: type.replaceAll('_', ' '),
    icon: '/samche-logo.png',
    badge: '/samche-logo.png',
    data: { deepLink },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deepLink = safeDeepLink(event.notification.data?.deepLink);
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const match = windows.find((client) => new URL(client.url).pathname === deepLink);
    return match ? match.focus() : clients.openWindow(deepLink);
  }));
});
