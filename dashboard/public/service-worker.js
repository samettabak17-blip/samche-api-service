const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const DASHBOARD_ROUTE = '(?:overview|settings|team|guide-experience|knowledge(?:-base)?(?:/[a-z-]+)?|conversations(?:/[a-z_-]+(?:/' + UUID + ')?)?|leads(?:/' + UUID + ')?|pipeline(?:/' + UUID + ')?|assistants(?:/' + UUID + ')?|channels(?:/' + UUID + ')?)';

function isAllowedDashboardPath(value) {
  return typeof value === 'string'
    && value.length <= 512
    && new RegExp('^/app/' + UUID + '/' + DASHBOARD_ROUTE + '$', 'i').test(value);
}

function safeDeepLink(value) {
  return isAllowedDashboardPath(value) ? value : '/';
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

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
    const rawLink = payload.deepLink || payload.url || payload.data?.deepLink || payload.data?.url;
    const deepLink = safeDeepLink(payload.deepLink) !== '/' ? safeDeepLink(payload.deepLink) : safeDeepLink(rawLink);
    const options = {
      body,
      icon: '/samche-logo.png',
      badge: '/samche-logo.png',
      data: {
        deepLink,
        url: deepLink,
        tenantId: payload.tenantId || payload.data?.tenantId || null,
        conversationId: payload.conversationId || payload.data?.conversationId || null,
        type,
        eventId: payload.eventId || payload.data?.eventId || null,
      },
      tag: String(payload.eventId || 'samche-live-support'),
    };
    try {
      await self.registration.showNotification(title, options);
    } catch {
      try {
        await self.registration.showNotification(title, { body, data: { deepLink } });
      } catch {
        await self.registration.showNotification('SamChe', { body });
      }
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawDeepLink = event.notification.data?.deepLink || event.notification.data?.url;
  const deepLink = safeDeepLink(rawDeepLink);
  const targetUrl = new URL(deepLink, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).pathname === deepLink && 'focus' in client) {
        return client.focus();
      }
    }
    for (const client of windows) {
      if ('navigate' in client && 'focus' in client) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }
    if (clients.openWindow) {
      return clients.openWindow(targetUrl);
    }
  })());
});
