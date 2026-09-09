export function readWebPushConfiguration(environment = process.env) {
  const publicKey = String(environment.VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = String(environment.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = String(environment.VAPID_SUBJECT ?? '').trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export async function createWebPushDeliveryAdapter({ configuration = readWebPushConfiguration() } = {}) {
  if (!configuration) return null;
  const module = await import('web-push');
  const webpush = module.default ?? module;
  webpush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);
  return {
    async deliver({ subscription, notification }) {
      try {
        const payload = JSON.stringify({
          type: notification.type,
          title: notification.title || 'SamChe Canlı Destek',
          body: notification.body || (notification.type === 'HUMAN_HANDOFF_REQUESTED' ? 'Yeni canlı destek talebi aktarıldı.' : notification.type?.replaceAll('_', ' ')),
          deepLink: notification.deepLink,
          eventId: notification.eventId,
        });
        console.info('PUSH_PAYLOAD_DIAGNOSTIC SERVICE_WORKER_PAYLOAD_CREATED=1 has_title=1 has_deeplink=1');
        await webpush.sendNotification(subscription, payload, { TTL: 300, urgency: 'high' });
        return { status: 'DELIVERED' };
      } catch (error) {
        const statusCode = Number(error?.statusCode ?? 0) || null;
        return { statusCode, retryable: !statusCode || statusCode >= 500 || statusCode === 429 };
      }
    },
  };
}
