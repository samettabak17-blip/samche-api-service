let latestDeliveryAttempt = null;

export function getLatestWebPushDeliveryAttempt() {
  return latestDeliveryAttempt;
}

export function createWebPushPayload({ type, title, body, deepLink, eventId, tenantId, conversationId }) {
  const link = deepLink || '/';
  const notifType = typeof type === 'string' ? type.slice(0, 64) : 'NOTIFICATION';
  const notifTitle = title || 'SamChe Canlı Destek';
  const notifBody = body || (notifType === 'HUMAN_HANDOFF_REQUESTED' ? 'Yeni canlı destek talebi aktarıldı.' : notifType.replaceAll('_', ' '));
  return {
    type: notifType,
    title: notifTitle,
    body: notifBody,
    deepLink: link,
    url: link,
    eventId: eventId || null,
    tenantId: tenantId || null,
    conversationId: conversationId || null,
    data: {
      deepLink: link,
      url: link,
      tenantId: tenantId || null,
      conversationId: conversationId || null,
      type: notifType,
      eventId: eventId || null,
    },
  };
}

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
      let endpointHost = 'unknown';
      try {
        endpointHost = new URL(subscription?.endpoint ?? '').host;
      } catch {}

      try {
        const payload = JSON.stringify(createWebPushPayload({
          type: notification.type,
          title: notification.title,
          body: notification.body,
          deepLink: notification.deepLink,
          eventId: notification.eventId,
          tenantId: notification.tenantId,
          conversationId: notification.conversationId,
        }));
        console.info('PUSH_PAYLOAD_DIAGNOSTIC SERVICE_WORKER_PAYLOAD_CREATED=1 has_title=1 has_deeplink=1');
        await webpush.sendNotification(subscription, payload, { TTL: 300, urgency: 'high' });
        latestDeliveryAttempt = {
          attempted: true,
          endpointHost,
          statusCode: 201,
          status: 'ACCEPTED_BY_PUSH_SERVICE',
          providerAccepted: true,
          classification: 'ACCEPTED_BY_PUSH_SERVICE',
          failureClass: null,
          errorBody: null,
          timestamp: new Date().toISOString(),
        };
        console.info(
          'PUSH_PROVIDER_DELIVERY_ACCEPTED'
          + ' host=' + endpointHost
          + ' status=201'
          + ' classification=ACCEPTED_BY_PUSH_SERVICE'
        );
        return { status: 'ACCEPTED_BY_PUSH_SERVICE', statusCode: 201, providerAccepted: true, classification: 'ACCEPTED_BY_PUSH_SERVICE' };
      } catch (error) {
        const statusCode = Number(error?.statusCode ?? 0) || null;
        const errorClass = error?.name || (error instanceof Error ? error.constructor.name : 'UnknownError');
        const errorBody = typeof error?.body === 'string' ? error.body.trim().slice(0, 256) : null;
        const errorMessage = error?.message ? String(error.message).slice(0, 256) : null;
        let classification = 'OTHER_PROVIDER_ERROR';
        if (statusCode === 404) classification = 'SUBSCRIPTION_NOT_FOUND';
        else if (statusCode === 410) classification = 'SUBSCRIPTION_EXPIRED';
        else if (statusCode === 401 || statusCode === 403) classification = 'AUTHORIZATION_OR_VAPID_ERROR';
        else if (errorClass === 'PayloadEncodingError' || errorClass === 'SyntaxError') classification = 'PAYLOAD_ENCRYPTION_ERROR';
        else if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET' || errorClass === 'TimeoutError') classification = 'NETWORK_TIMEOUT';
        else if (statusCode && statusCode >= 500) classification = 'PROVIDER_SERVER_ERROR';

        latestDeliveryAttempt = {
          attempted: true,
          endpointHost,
          statusCode,
          status: 'FAILED',
          providerAccepted: false,
          classification,
          failureClass: errorClass,
          errorBody: errorBody || errorMessage,
          timestamp: new Date().toISOString(),
        };
        console.error(
          'PUSH_PROVIDER_DELIVERY_FAILURE'
          + ' host=' + endpointHost
          + ' status=' + (statusCode ?? 'NONE')
          + ' classification=' + classification
          + ' error_class=' + errorClass
          + ' error_body=' + (errorBody || errorMessage || 'NONE')
        );
        return {
          statusCode,
          status: 'FAILED',
          classification,
          errorClass,
          errorBody,
          errorMessage,
          retryable: !statusCode || statusCode >= 500 || statusCode === 429,
        };
      }
    },
  };
}
