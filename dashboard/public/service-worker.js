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
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      try {
        payload = { body: event.data ? event.data.text() : '' };
      } catch {
        payload = {};
      }
    }
    const type = typeof payload.type === 'string' ? payload.type.slice(0, 64) : 'NOTIFICATION';
    const title = payload.title || 'SamChe Canlı Destek';
    const body = payload.body || (type === 'HUMAN_HANDOFF_REQUESTED' ? 'Yeni canlı destek talebi aktarıldı.' : type.replaceAll('_', ' '));
    const deepLink = safeDeepLink(payload.deepLink);
    const options = {
      body,
      icon: '/samche-logo.png',
      badge: '/samche-logo.png',
      data: { deepLink },
      tag: payload.eventId || 'samche-live-support',
      renotify: true,
      requireInteraction: true,
    };
    try {
      await self.registration.showNotification(title, options);
    } catch {
      await self.registration.showNotification('SamChe', { body });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deepLink = safeDeepLink(event.notification.data?.deepLink);
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const match = windows.find((client) => new URL(client.url).pathname === deepLink);
    return match ? match.focus() : clients.openWindow(deepLink);
  }));
});
