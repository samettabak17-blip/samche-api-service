export async function resolvePublicWebChatIntegration({ database, widgetKey }) {
  if (!database?.query || typeof widgetKey !== 'string' || !widgetKey.trim()) return null;
  let result;
  try {
    result = await database.query(
      `SELECT ci.tenant_id, ci.channel_id, ci.assistant_id,
              ci.config,
              tc.channel_type, tc.status AS channel_status, tc.display_name AS channel_name,
              a.status AS assistant_status, a.name AS assistant_name
         FROM channel_integrations ci
         JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
         JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
        WHERE ci.integration_key = $1
          AND ci.integration_type = 'WEB_CHAT'
          AND ci.enabled = TRUE
        LIMIT 2`,
      [widgetKey]
    );
  } catch (err) {
    if (err?.code === '42703' || String(err?.message || '').includes('config')) {
      result = await database.query(
        `SELECT ci.tenant_id, ci.channel_id, ci.assistant_id,
                tc.channel_type, tc.status AS channel_status, tc.display_name AS channel_name,
                a.status AS assistant_status, a.name AS assistant_name
           FROM channel_integrations ci
           JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
           JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
          WHERE ci.integration_key = $1
            AND ci.integration_type = 'WEB_CHAT'
            AND ci.enabled = TRUE
          LIMIT 2`,
        [widgetKey]
      );
    } else {
      throw err;
    }
  }
  if (!result || result.rowCount !== 1) return null;
  const integration = result.rows[0];
  if (integration.channel_type !== 'WEB_CHAT' || integration.channel_status !== 'active' || integration.assistant_status !== 'active') return null;
  return integration;
}

export {
  TenantWebChatProvisioningError,
  ensureWebChatIntegration,
  getWebChatIntegrationForTenant,
  ensureTenantWebChatPersona,
  DEFAULT_WEB_CHAT_APPEARANCE,
  DEFAULT_WEB_CHAT_BEHAVIOR,
  normalizeWebChatAppearance,
  normalizeWebChatBehavior,
  generateWebChatEmbedSnippet,
} from './tenant-web-chat-provisioning-service.js';



