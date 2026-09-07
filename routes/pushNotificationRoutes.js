import express from 'express';
import pool from '../config/db.js';
import { authenticateToken, requireTenantAccess } from '../middleware/auth.js';
import {
  getPushNotificationPreference,
  registerPushSubscription,
  unsubscribePushSubscription,
  updatePushNotificationPreference,
  PushNotificationError,
} from '../services/push-notification-service.js';

const router = express.Router();
router.use(authenticateToken);

function configuredCapability() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = String(process.env.VAPID_SUBJECT ?? '').trim();
  const configured = Boolean(publicKey && privateKey && subject);
  return { configured, publicKey: configured ? publicKey : null };
}

router.get('/:tenantId/push-notifications/capability', requireTenantAccess, (_req, res) => res.json(configuredCapability()));

router.get('/:tenantId/push-notifications/preference', requireTenantAccess, async (req, res) => {
  try { return res.json(await getPushNotificationPreference({ database: pool, tenantId: req.verified_tenant_id, userId: req.user.user_id })); }
  catch { return res.status(503).json({ error: 'Notification preferences are unavailable' }); }
});

router.patch('/:tenantId/push-notifications/preference', requireTenantAccess, async (req, res) => {
  try { return res.json(await updatePushNotificationPreference({ database: pool, tenantId: req.verified_tenant_id, userId: req.user.user_id, pushEnabled: req.body?.push_enabled })); }
  catch (error) { return res.status(error instanceof PushNotificationError ? 400 : 503).json({ error: 'Notification preference is invalid' }); }
});

router.put('/:tenantId/push-notifications/subscription', requireTenantAccess, async (req, res) => {
  try { return res.json({ subscription: await registerPushSubscription({ database: pool, tenantId: req.verified_tenant_id, userId: req.user.user_id, subscription: req.body?.subscription }) }); }
  catch (error) { return res.status(error instanceof PushNotificationError ? 400 : 503).json({ error: 'Push subscription is unavailable' }); }
});

router.delete('/:tenantId/push-notifications/subscription', requireTenantAccess, async (req, res) => {
  try { return res.json({ unsubscribed: await unsubscribePushSubscription({ database: pool, tenantId: req.verified_tenant_id, userId: req.user.user_id, endpoint: req.body?.endpoint }) }); }
  catch (error) { return res.status(error instanceof PushNotificationError ? 400 : 503).json({ error: 'Push subscription is unavailable' }); }
});

export default router;
