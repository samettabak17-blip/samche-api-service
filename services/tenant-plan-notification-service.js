/**
 * A compact persistent owner notification is deliberately a side effect: the
 * upgrade request remains the source of truth even if notification delivery is
 * temporarily unavailable.
 */
export async function notifyPlatformOwnersOfPlanUpgrade({ database, requestId }) {
  const result = await database.query(
    `INSERT INTO tenant_plan_upgrade_notifications (request_id, recipient_user_id)
     SELECT $1, id FROM users WHERE system_role = 'OWNER' AND status = 'ACTIVE'
     ON CONFLICT (request_id, recipient_user_id) DO NOTHING
     RETURNING id`,
    [requestId],
  );
  return { notified: result.rowCount };
}

export async function listPlanUpgradeNotificationsForOwner({ database, ownerUserId }) {
  const result = await database.query(
    `SELECT notification.id, notification.request_id, notification.status, notification.created_at,
            'Plan upgrade request' AS title,
            tenant.name AS tenant_name, request.current_plan_code, request.requested_plan_code,
            requester.email AS requested_by_email
       FROM tenant_plan_upgrade_notifications notification
       JOIN tenant_plan_upgrade_requests request ON request.id = notification.request_id
       JOIN tenants tenant ON tenant.id = request.tenant_id
       JOIN users requester ON requester.id = request.requested_by_user_id
      WHERE notification.recipient_user_id = $1
      ORDER BY (notification.status = 'PENDING') DESC, notification.created_at DESC
      LIMIT 50`,
    [ownerUserId],
  );
  return result.rows;
}

export async function markPlanUpgradeNotificationRead({ database, notificationId, ownerUserId }) {
  const result = await database.query(
    `UPDATE tenant_plan_upgrade_notifications
        SET status = 'READ'
      WHERE id = $1 AND recipient_user_id = $2 AND status = 'PENDING'
      RETURNING id, request_id, status`,
    [notificationId, ownerUserId],
  );
  return result.rows[0] ?? null;
}
