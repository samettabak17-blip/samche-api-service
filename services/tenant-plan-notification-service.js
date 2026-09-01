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
