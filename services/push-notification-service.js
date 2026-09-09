const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(['KNOWLEDGE_JOB_COMPLETED', 'KNOWLEDGE_JOB_FAILED', 'REVIEW_REQUIRED', 'CONFIGURATION_READY', 'HUMAN_HANDOFF_REQUESTED']);
const MAX_DELIVERY_ATTEMPTS = 3;

export class PushNotificationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function id(value, code) {
  if (!UUID.test(String(value ?? ''))) throw new PushNotificationError(code);
  return String(value);
}

function subscriptionInput(value) {
  const endpoint = typeof value?.endpoint === 'string' ? value.endpoint.trim() : '';
  const p256dh = typeof value?.keys?.p256dh === 'string' ? value.keys.p256dh.trim() : '';
  const auth = typeof value?.keys?.auth === 'string' ? value.keys.auth.trim() : '';
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2048 || !p256dh || !auth) throw new PushNotificationError('PUSH_SUBSCRIPTION_INVALID');
  return { endpoint, p256dh: p256dh.slice(0, 512), auth: auth.slice(0, 512) };
}

export function validateInternalDashboardDeepLink(value, tenantId) {
  const link = typeof value === 'string' ? value.trim() : '';
  const tenant = id(tenantId, 'PUSH_TENANT_INVALID');
  const escapedTenant = tenant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const route = `(?:overview|settings|team|guide-experience|knowledge(?:-base)?(?:/[a-z-]+)?|conversations/[a-z_-]+(?:/${uuid})?|leads(?:/${uuid})?|pipeline(?:/${uuid})?|assistants(?:/${uuid})?|channels(?:/${uuid})?)`;
  if (!new RegExp(`^/app/${escapedTenant}/${route}$`, 'i').test(link)) throw new PushNotificationError('PUSH_DEEP_LINK_INVALID');
  return link.slice(0, 512);
}

function recipientIds(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.length) throw new PushNotificationError('PUSH_RECIPIENTS_INVALID');
  const recipients = [...new Set(value.map((item) => id(item, 'PUSH_RECIPIENT_INVALID')))];
  return recipients;
}

export async function registerPushSubscription({ database, tenantId, userId, subscription }) {
  const tenant = id(tenantId, 'PUSH_TENANT_INVALID');
  const user = id(userId, 'PUSH_USER_INVALID');
  const value = subscriptionInput(subscription);
  const result = await database.query(
    `INSERT INTO push_notification_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, enabled, updated_at)
     SELECT $1, $2, $3, $4, $5, TRUE, CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2)
     ON CONFLICT (tenant_id, user_id, endpoint)
     DO UPDATE SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, enabled=TRUE, updated_at=CURRENT_TIMESTAMP
     RETURNING id, tenant_id, user_id, endpoint, enabled, updated_at`,
    [tenant, user, value.endpoint, value.p256dh, value.auth],
  );
  if (!result.rowCount) throw new PushNotificationError('PUSH_SUBSCRIPTION_UNAUTHORIZED');
  return result.rows[0];
}

export async function unsubscribePushSubscription({ database, tenantId, userId, endpoint }) {
  const result = await database.query(
    `UPDATE push_notification_subscriptions SET enabled=FALSE, updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND user_id = $2 AND endpoint = $3 AND enabled=TRUE
      RETURNING id`,
    [id(tenantId, 'PUSH_TENANT_INVALID'), id(userId, 'PUSH_USER_INVALID'), subscriptionInput({ endpoint, keys: { p256dh: 'x', auth: 'x' } }).endpoint],
  );
  return result.rowCount > 0;
}

export async function createPushNotificationIntent({ database, tenantId, eventId, eventType, deepLink, recipientUserIds = null }) {
  const tenant = id(tenantId, 'PUSH_TENANT_INVALID');
  const recipients = recipientIds(recipientUserIds);
  if (!EVENT_TYPES.has(eventType)) throw new PushNotificationError('PUSH_EVENT_TYPE_INVALID');
  if (!/^[A-Za-z0-9_.:-]{1,255}$/.test(String(eventId ?? ''))) throw new PushNotificationError('PUSH_EVENT_ID_INVALID');
  const result = await database.query(
    `INSERT INTO push_notification_intents (tenant_id, event_id, event_type, deep_link)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, event_id) DO UPDATE SET event_id=EXCLUDED.event_id
     RETURNING id, tenant_id, event_id, event_type, deep_link, status`,
    [tenant, String(eventId), eventType, validateInternalDashboardDeepLink(deepLink, tenant)],
  );
  const intent = result.rows[0];
  console.info('PUSH_EVENT_CREATED = tenant=' + String(tenant).slice(0, 8) + ' event_id=' + (intent?.event_id ?? eventId) + ' event_type=' + (intent?.event_type ?? eventType));
  const outbox = await database.query(
    `INSERT INTO push_notification_outbox (tenant_id, intent_id, recipient_user_id, subscription_id, event_type, deep_link)
     SELECT intent.tenant_id, intent.id, subscription.user_id, subscription.id, intent.event_type, intent.deep_link
       FROM push_notification_intents intent
       JOIN push_notification_subscriptions subscription ON subscription.tenant_id=intent.tenant_id AND subscription.enabled=TRUE
       LEFT JOIN push_notification_preferences preference ON preference.tenant_id=subscription.tenant_id AND preference.user_id=subscription.user_id
      WHERE intent.id=$1 AND COALESCE(preference.push_enabled, TRUE)=TRUE
        ${recipients ? 'AND subscription.user_id = ANY($2::uuid[])' : ''}
     ON CONFLICT (tenant_id, intent_id, subscription_id) DO NOTHING`,
    recipients ? [intent.id, recipients] : [intent.id],
  );
  if (!outbox.rowCount) {
    const existing = await database.query(
      `SELECT count(*)::integer AS count FROM push_notification_outbox WHERE tenant_id=$1 AND intent_id=$2`,
      [tenant, intent.id],
    );
    if (Number(existing.rows[0]?.count ?? 0) === 0) {
      await database.query(
        `UPDATE push_notification_intents SET status='NO_RECIPIENT' WHERE tenant_id=$1 AND id=$2 AND status='PENDING'`,
        [tenant, intent.id],
      );
    }
  }
  return intent;
}

export async function enqueueHumanHandoffPushNotification({
  database,
  tenantId,
  conversationId,
  handoffOutboxId,
  recipients,
}) {
  const tenant = id(tenantId, 'PUSH_TENANT_INVALID');
  const conversation = id(conversationId, 'PUSH_CONVERSATION_INVALID');
  const recipientUserIds = recipientIds(Array.isArray(recipients) ? recipients.map((recipient) => recipient?.id) : recipients);
  const eventId = `human-handoff:${String(handoffOutboxId ?? '').trim()}`;
  if (!/^human-handoff:[A-Za-z0-9_.:-]{1,240}$/.test(eventId)) throw new PushNotificationError('PUSH_HANDOFF_EVENT_INVALID');
  return createPushNotificationIntent({
    database,
    tenantId: tenant,
    eventId,
    eventType: 'HUMAN_HANDOFF_REQUESTED',
    deepLink: `/app/${tenant}/conversations/whatsapp/${conversation}`,
    recipientUserIds,
  });
}

export async function getPushNotificationPreference({ database, tenantId, userId }) {
  const result = await database.query(
    `SELECT push_enabled, categories FROM push_notification_preferences WHERE tenant_id=$1 AND user_id=$2`,
    [id(tenantId, 'PUSH_TENANT_INVALID'), id(userId, 'PUSH_USER_INVALID')],
  );
  return result.rows[0] ?? { push_enabled: true, categories: {} };
}

export async function updatePushNotificationPreference({ database, tenantId, userId, pushEnabled }) {
  if (typeof pushEnabled !== 'boolean') throw new PushNotificationError('PUSH_PREFERENCE_INVALID');
  const result = await database.query(
    `INSERT INTO push_notification_preferences (tenant_id,user_id,push_enabled,updated_at)
     SELECT $1,$2,$3,CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id=$1 AND user_id=$2)
     ON CONFLICT (tenant_id,user_id) DO UPDATE SET push_enabled=EXCLUDED.push_enabled,updated_at=CURRENT_TIMESTAMP
     RETURNING push_enabled,categories`,
    [id(tenantId, 'PUSH_TENANT_INVALID'), id(userId, 'PUSH_USER_INVALID'), pushEnabled],
  );
  if (!result.rowCount) throw new PushNotificationError('PUSH_PREFERENCE_UNAUTHORIZED');
  return result.rows[0];
}

export async function processPushNotificationOutbox({ database, deliver, tenantId = null }) {
  const tenantScope = tenantId === null ? null : id(tenantId, 'PUSH_TENANT_INVALID');
  const client = await database.connect();
  const result = { delivered: 0, retried: 0, expired: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `SELECT outbox.id, outbox.tenant_id, outbox.recipient_user_id, outbox.event_type, outbox.deep_link, outbox.attempts,
              subscription.id AS subscription_id, subscription.endpoint, subscription.p256dh, subscription.auth
         FROM push_notification_outbox outbox
         JOIN push_notification_subscriptions subscription ON subscription.id=outbox.subscription_id AND subscription.tenant_id=outbox.tenant_id AND subscription.enabled=TRUE
        WHERE ${tenantScope ? 'outbox.tenant_id=$1 AND ' : ''}(outbox.status IN ('PENDING','RETRY')
           OR (outbox.status='PROCESSING' AND outbox.processing_started_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
        ORDER BY outbox.created_at ASC LIMIT 1 FOR UPDATE OF outbox SKIP LOCKED`,
      tenantScope ? [tenantScope] : [],
    );
    const row = claimed.rows[0];
    if (!row) { await client.query('COMMIT'); return result; }
    await client.query(`UPDATE push_notification_outbox SET status='PROCESSING', attempts=attempts+1, processing_started_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2`, [row.id, row.tenant_id]);
    console.info('PUSH_SEND_ATTEMPTED = tenant=' + String(row.tenant_id).slice(0, 8) + ' outbox_id=' + String(row.id).slice(0, 8));
    let outcome;
    try {
      outcome = await deliver({ subscription: { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, notification: { type: row.event_type, deepLink: row.deep_link, eventId: row.id } });
    } catch {
      outcome = { retryable: true };
    }
    console.info('PUSH_PROVIDER_RESULT = tenant=' + String(row.tenant_id).slice(0, 8) + ' status=' + (outcome?.status ?? 'FAILED') + ' code=' + (outcome?.statusCode ?? 'NONE'));
    if (outcome?.statusCode === 404 || outcome?.statusCode === 410) {
      await client.query(`UPDATE push_notification_subscriptions SET enabled = FALSE, failure_code='EXPIRED', updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2`, [row.subscription_id, row.tenant_id]);
      await client.query(`UPDATE push_notification_outbox SET status = 'FAILED', processing_started_at=NULL, failure_code='EXPIRED' WHERE id=$1 AND tenant_id=$2`, [row.id, row.tenant_id]);
      result.expired++;
    } else if (outcome?.status === 'DELIVERED') {
      await client.query(`UPDATE push_notification_outbox SET status='DELIVERED', processing_started_at=NULL, delivered_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2`, [row.id, row.tenant_id]);
      await client.query(`UPDATE push_notification_subscriptions SET last_delivered_at=CURRENT_TIMESTAMP, failure_code=NULL WHERE id=$1 AND tenant_id=$2`, [row.subscription_id, row.tenant_id]);
      result.delivered++;
    } else if (outcome?.retryable && Number(row.attempts) + 1 < MAX_DELIVERY_ATTEMPTS) {
      await client.query(`UPDATE push_notification_outbox SET status='RETRY', processing_started_at=NULL, failure_code='TRANSIENT' WHERE id=$1 AND tenant_id=$2`, [row.id, row.tenant_id]); result.retried++;
    } else if (outcome?.retryable) {
      await client.query(`UPDATE push_notification_outbox SET status='FAILED', processing_started_at=NULL, failure_code='RETRY_EXHAUSTED' WHERE id=$1 AND tenant_id=$2`, [row.id, row.tenant_id]); result.failed++;
    } else { await client.query(`UPDATE push_notification_outbox SET status='FAILED', processing_started_at=NULL, failure_code='DELIVERY_FAILED' WHERE id=$1 AND tenant_id=$2`, [row.id, row.tenant_id]); result.failed++; }
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
