import express from 'express';
import pool, { query } from '../config/db.js';
import { authenticateToken, requireOwner, requireTenantAccess, requireTenantAdmin } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';
import { ensureGuideChannelsForTenant } from '../services/guide-domain-service.js';
import {
  configureWhatsAppChannel,
  reconcileWhatsAppChannelIntegrity,
  transferWhatsAppChannelOwnership,
  WhatsAppChannelOwnershipError,
} from '../services/whatsapp-channel-ownership-service.js';
import {
  ensureWebChatIntegration,
  getWebChatIntegrationForTenant,
  TenantWebChatProvisioningError,
} from '../services/tenant-web-chat-provisioning-service.js';
import {
  analyzeLogoPalette,
  deriveWebChatThemeTokens,
} from '../services/web-chat-theme-service.js';
import {
  canPerformWebChatAction,
  WEBCHAT_PERMISSIONS,
} from '../services/web-chat-permissions.js';




const router = express.Router();
router.use(authenticateToken);

const page = (req, res) => {
  const limit = Number(req.query.limit ?? 25);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    res.status(400).json({ error: 'limit must be 1-100 and offset must be non-negative' });
    return null;
  }
  return { limit, offset };
};
const tenant = (req, res) => {
  if (!isValidUUID(req.params.tenantId)) { res.status(400).json({ error: 'Invalid tenant ID' }); return null; }
  return req.verified_tenant_id;
};
const channelOwnershipErrorResponse = (req, res, error) => {
  if (!(error instanceof WhatsAppChannelOwnershipError)) return false;
  const statuses = {
    PLATFORM_OWNER_REQUIRED: 403,
    WHATSAPP_CHANNEL_NOT_FOUND: 404,
    WHATSAPP_CHANNEL_OWNER_NOT_FOUND: 404,
    WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT: 409,
    WHATSAPP_CHANNEL_OWNERSHIP_AMBIGUOUS: 409,
    WHATSAPP_CHANNEL_OWNER_CHANGED: 409,
    WHATSAPP_TARGET_CHANNEL_AMBIGUOUS: 409,
  };
  const body = {
    error: error.code,
    message: error.message,
  };
  if (error.code === 'WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT') {
    body.conflict = {
      ownership: 'OTHER_TENANT',
      external_channel_id: error.details.externalChannelId,
      transfer_required: true,
    };
    if (req.user?.system_role === 'OWNER') {
      body.conflict.source_channel_id = error.details.sourceChannelId;
      body.conflict.source_tenant_id = error.details.sourceTenantId;
      body.conflict.platform_transfer_available = true;
    }
  }
  res.status(statuses[error.code] ?? 400).json(body);
  return true;
};
const webChatProvisioningErrorResponse = (req, res, error) => {
  if (!(error instanceof TenantWebChatProvisioningError)) return false;
  const statuses = {
    WEB_CHAT_PROVISIONING_TENANT_NOT_FOUND: 404,
    WEB_CHAT_PROVISIONING_ASSISTANT_NOT_FOUND: 404,
    WEB_CHAT_PROVISIONING_CHANNEL_NOT_FOUND: 404,
    WEB_CHAT_PROVISIONING_TENANT_INACTIVE: 400,
    WEB_CHAT_PROVISIONING_ASSISTANT_INACTIVE: 400,
    WEB_CHAT_PROVISIONING_CHANNEL_TYPE_MISMATCH: 400,
    WEB_CHAT_PROVISIONING_TENANT_INVALID: 400,
    WEB_CHAT_PROVISIONING_ASSISTANT_INVALID: 400,
    WEB_CHAT_PROVISIONING_CHANNEL_INVALID: 400,
    WEB_CHAT_PROVISIONING_WIDGET_KEY_INVALID: 400,
    WEB_CHAT_INTEGRATION_KEY_CONFLICT: 409,
    WEB_CHAT_PROVISIONING_DATABASE_INVALID: 500,
  };
  res.status(statuses[error.code] ?? 400).json({
    error: error.code,
    message: error.message,
  });
  return true;
};

const channelBody = async (req, res) => {
  const { channel_type, display_name, external_channel_id = null, assistant_id = null, status = 'active' } = req.body;
  if (!['WEB_CHAT','WHATSAPP'].includes(channel_type) || typeof display_name !== 'string' || !display_name.trim() || !['active','inactive'].includes(status)) {
    res.status(400).json({ error: 'Invalid channel body' }); return null;
  }
  if (channel_type === 'WHATSAPP' && status === 'active' && !assistant_id) {
    res.status(400).json({
      error: 'WHATSAPP_ASSISTANT_REQUIRED',
      message: 'An active assistant is required for an active WhatsApp channel',
    });
    return null;
  }
  if (assistant_id && !isValidUUID(assistant_id)) { res.status(400).json({ error: 'Invalid assistant ID' }); return null; }
  if (assistant_id) {
    const a = await (req.app?.locals?.database?.query?.bind(req.app.locals.database) || req.app?.locals?.query || pool?.query?.bind(pool) || query)(
      "SELECT id FROM ai_assistants WHERE id=$1 AND tenant_id=$2 AND lower(status)='active'",
      [assistant_id, req.verified_tenant_id]
    );
    if (!a.rowCount) { res.status(400).json({ error: 'Assistant must be active and belong to this tenant' }); return null; }
  }
  return [channel_type, display_name.trim(), external_channel_id || null, assistant_id, status];
};
router.get('/:tenantId/team', requireTenantAccess, async (req,res)=> {
  if(!tenant(req,res)) return;
  const r=await query('SELECT u.id,u.email,u.system_role,tu.tenant_role,tu.created_at FROM tenant_users tu JOIN users u ON u.id=tu.user_id WHERE tu.tenant_id=$1 ORDER BY tu.created_at',[req.verified_tenant_id]);
  res.json(r.rows);
});
router.get('/:tenantId/channels', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;

  try {
    const db = req.app?.locals?.database || { query };
    await ensureGuideChannelsForTenant({ database: db, tenantId: req.verified_tenant_id }).catch(() => {});
    await reconcileWhatsAppChannelIntegrity({ database: req.app?.locals?.database || pool, tenantId: req.verified_tenant_id }).catch(() => {});
    const result = await (req.app?.locals?.database?.query?.bind(req.app.locals.database) || req.app?.locals?.query || query)(
      'SELECT id,tenant_id,assistant_id,channel_type,display_name,external_channel_id,status,created_at,updated_at FROM tenant_channels WHERE tenant_id=$1 ORDER BY created_at DESC',
      [req.verified_tenant_id]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Fetch tenant channels error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});
router.post('/:tenantId/channels', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  const body = await channelBody(req, res);
  if (!body) return;
  try {
    const [channelType, displayName, externalChannelId, assistantId, status] = body;
    let channel;
    if (channelType === 'WHATSAPP') {
      channel = await configureWhatsAppChannel({
        database: req.app?.locals?.database || pool,
        tenantId: req.verified_tenant_id,
        displayName,
        externalChannelId,
        assistantId,
        status,
      });
    } else if (channelType === 'WEB_CHAT') {
      const result = await ensureWebChatIntegration({
        database: req.app?.locals?.database || pool,
        tenantId: req.verified_tenant_id,
        assistantId,
        displayName,
      });
      channel = result.channel;
    } else {
      channel = (await (req.app?.locals?.query || query)(
        'INSERT INTO tenant_channels(channel_type,display_name,external_channel_id,assistant_id,status,tenant_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [...body, req.verified_tenant_id]
      )).rows[0];
    }
    return res.status(201).json(channel);
  } catch (error) {
    if (channelOwnershipErrorResponse(req, res, error)) return;
    if (webChatProvisioningErrorResponse(req, res, error)) return;
    return res.status(error?.code === '23505' ? 409 : 500).json({
      error: error?.code === '23505' ? 'CHANNEL_ALREADY_EXISTS' : 'Server error',
    });
  }
});
router.get('/:tenantId/channels/web-chat', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;
  if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.VIEW })) {
    return res.status(403).json({ error: 'Web Chat view access required' });
  }

  try {
    const integration = await getWebChatIntegrationForTenant({
      database: req.app?.locals?.database || pool,
      tenantId: req.verified_tenant_id,
    });
    if (!integration) {
      return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: 'Tenant does not exist' });
    }
    return res.json(integration);
  } catch (error) {
    if (webChatProvisioningErrorResponse(req, res, error)) return;
    console.error('Fetch web chat channel error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});
router.post('/:tenantId/channels/web-chat', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.CONFIGURE })) {
    return res.status(403).json({ error: 'Web Chat configure access required' });
  }

  const {
    assistant_id: assistantId = null,
    widget_key: widgetKey = null,
    display_name: displayName = null,
    status = null,
    appearance = null,
    behavior = null,
  } = req.body ?? {};
  try {
    const integration = await ensureWebChatIntegration({
      database: req.app?.locals?.database || pool,
      tenantId: req.verified_tenant_id,
      assistantId,
      widgetKey,
      displayName,
      status,
      appearance,
      behavior,
    });
    return res.status(200).json(integration);
  } catch (error) {
    if (webChatProvisioningErrorResponse(req, res, error)) return;
    console.error('Provision web chat channel error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:tenantId/channels/web-chat', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.CONFIGURE })) {
    return res.status(403).json({ error: 'Web Chat configure access required' });
  }

  const {
    assistant_id: assistantId = null,
    widget_key: widgetKey = null,
    display_name: displayName = null,
    status = null,
    appearance = null,
    behavior = null,
  } = req.body ?? {};
  try {
    const integration = await ensureWebChatIntegration({
      database: req.app?.locals?.database || pool,
      tenantId: req.verified_tenant_id,
      assistantId,
      widgetKey,
      displayName,
      status,
      appearance,
      behavior,
    });
    return res.status(200).json(integration);
  } catch (error) {
    if (webChatProvisioningErrorResponse(req, res, error)) return;
    console.error('Update web chat channel error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:tenantId/channels/web-chat/theme-preview', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;
  if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.VIEW })) {
    return res.status(403).json({ error: 'Web Chat preview access required' });
  }

  const {
    primary_color: primaryColor = null,
    accent_color: accentColor = null,
    base_color: baseColor = null,
    candidates = [],
    mode = 'dark',
  } = req.body ?? {};

  try {
    let result;
    if (Array.isArray(candidates) && candidates.length > 0) {
      result = analyzeLogoPalette({ candidates, baseColor: primaryColor || baseColor, mode });
    } else {
      result = deriveWebChatThemeTokens({
        primaryColor: primaryColor || baseColor || '#2563EB',
        accentColor,
        mode,
      });
    }
    return res.json(result);
  } catch (error) {
    console.error('Theme preview generation error:', error);
    return res.status(400).json({ error: 'Failed to generate theme preview' });
  }
});

// Cross-tenant channel transfer requires canonical platform-level administrative authority.
// A tenant-level owner or admin (system_role === 'CUSTOMER') must NEVER be able to transfer
// a physical channel owned by another tenant. Privilege escalation via request body is rejected.
router.post('/:tenantId/channels/transfer-whatsapp', requireOwner, requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;
  const {
    external_channel_id: externalChannelId,
    expected_source_channel_id: expectedSourceChannelId,
    target_assistant_id: targetAssistantId,
    display_name: displayName,
    confirmation,
  } = req.body ?? {};
  if (!isValidUUID(expectedSourceChannelId) || !isValidUUID(targetAssistantId)) {
    return res.status(400).json({ error: 'Valid source channel and target assistant IDs are required' });
  }
  try {
    const result = await transferWhatsAppChannelOwnership({
      database: req.app?.locals?.database || pool,
      actorSystemRole: req.user.system_role,
      actorUserId: req.user.user_id,
      targetTenantId: req.verified_tenant_id,
      targetAssistantId,
      externalChannelId,
      expectedSourceChannelId,
      displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : 'WhatsApp',
      confirmation,
    });
    return res.status(200).json({
      channel: result.channel,
      transfer: {
        source_channel_id: result.sourceChannelId,
        source_tenant_id: result.sourceTenantId,
        audit_event_id: result.auditEventId,
        external_channel_id: result.externalChannelId,
      },
    });
  } catch (error) {
    if (channelOwnershipErrorResponse(req, res, error)) return;
    console.error('WhatsApp channel transfer failed code=' + String(error?.code ?? 'UNKNOWN').slice(0, 32));
    return res.status(500).json({ error: 'Server error' });
  }
});
router.get('/:tenantId/channels/:channelId', requireTenantAccess, async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.channelId))return res.status(400).json({error:'Invalid channel ID'});await reconcileWhatsAppChannelIntegrity({ database: req.app?.locals?.database || pool, tenantId: req.verified_tenant_id }).catch(() => {});const r=await (req.app?.locals?.database?.query?.bind(req.app.locals.database) || req.app?.locals?.query || query)('SELECT * FROM tenant_channels WHERE id=$1 AND tenant_id=$2',[req.params.channelId,req.verified_tenant_id]);if(!r.rowCount)return res.status(404).json({error:'Channel not found'});res.json(r.rows[0]);});
router.put('/:tenantId/channels/:channelId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res) || !isValidUUID(req.params.channelId)) return res.status(400).json({ error: 'Invalid channel ID' });
  const existing = await (req.app?.locals?.database?.query?.bind(req.app.locals.database) || req.app?.locals?.query || pool?.query?.bind(pool) || query)('SELECT channel_type FROM tenant_channels WHERE id=$1 AND tenant_id=$2', [req.params.channelId, req.verified_tenant_id]);
  if (existing.rowCount && existing.rows[0].channel_type === 'SAMCHEGUIDE') {
    return res.status(409).json({ error: 'AI Guide channel is managed by the Guide lifecycle and cannot be modified here' });
  }
  const body = await channelBody(req, res);
  if (!body) return;
  try {
    const [channelType, displayName, externalChannelId, assistantId, status] = body;
    if (channelType === 'WHATSAPP') {
      const channel = await configureWhatsAppChannel({
        database: req.app?.locals?.database || pool,
        tenantId: req.verified_tenant_id,
        channelId: req.params.channelId,
        displayName,
        externalChannelId,
        assistantId,
        status,
      });
      return res.json(channel);
    }
    const result = await query(
      'UPDATE tenant_channels SET channel_type=$1,display_name=$2,external_channel_id=$3,assistant_id=$4,status=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [...body, req.params.channelId, req.verified_tenant_id]
    );
    return result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ error: 'Channel not found' });
  } catch (error) {
    if (channelOwnershipErrorResponse(req, res, error)) return;
    return res.status(error?.code === '23505' ? 409 : 500).json({
      error: error?.code === '23505' ? 'CHANNEL_ALREADY_EXISTS' : 'Server error',
    });
  }
});
router.delete('/:tenantId/channels/:channelId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res) || !isValidUUID(req.params.channelId)) {
    return res.status(400).json({ error: 'Invalid channel ID' });
  }

  const channelId = req.params.channelId;
  const tenantId = req.verified_tenant_id;
  const existing = await query('SELECT channel_type FROM tenant_channels WHERE id = $1 AND tenant_id = $2', [channelId, tenantId]);
  if (existing.rowCount && existing.rows[0].channel_type === 'SAMCHEGUIDE') {
    return res.status(409).json({ error: 'AI Guide channel is managed by the Guide lifecycle and cannot be deleted' });
  }
  const conflict = { error: 'Channel cannot be deleted while conversations are linked to it' };

  try {
    const linkedConversation = await query(
      'SELECT 1 FROM conversations WHERE channel_id = $1 AND tenant_id = $2 LIMIT 1',
      [channelId, tenantId]
    );
    if (linkedConversation.rowCount > 0) {
      return res.status(409).json(conflict);
    }

    await query('DELETE FROM channel_integrations WHERE channel_id = $1 AND tenant_id = $2', [channelId, tenantId]).catch(() => {});
    const result = await query(
      'DELETE FROM tenant_channels WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [channelId, tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Channel not found' });
    return res.json({ message: 'Channel deleted successfully' });
  } catch (error) {
    if (error?.code === '23503') return res.status(409).json(conflict);
    console.error('Delete tenant channel error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});
router.get('/:tenantId/conversations', requireTenantAccess, async(req,res)=>{if(!tenant(req,res))return;const p=page(req,res);if(!p)return;const r=await query('SELECT * FROM conversations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',[req.verified_tenant_id,p.limit,p.offset]);res.json(r.rows);});
router.get('/:tenantId/conversations/:conversationId', requireTenantAccess, async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.conversationId))return res.status(400).json({error:'Invalid conversation ID'});const r=await query('SELECT * FROM conversations WHERE id=$1 AND tenant_id=$2',[req.params.conversationId,req.verified_tenant_id]);if(!r.rowCount)return res.status(404).json({error:'Conversation not found'});res.json(r.rows[0]);});
router.get('/:tenantId/conversations/:conversationId/messages', requireTenantAccess, async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.conversationId))return res.status(400).json({error:'Invalid conversation ID'});const p=page(req,res);if(!p)return;const r=await query('SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id WHERE m.conversation_id=$1 AND m.tenant_id=$2 ORDER BY m.created_at ASC LIMIT $3 OFFSET $4',[req.params.conversationId,req.verified_tenant_id,p.limit,p.offset]);res.json(r.rows);});
const kbBody=async(req,res)=>{const{title,content,assistant_id=null,status='active'}=req.body;if(typeof title!=='string'||!title.trim()||typeof content!=='string'||!content.trim()||!['active','inactive'].includes(status)){res.status(400).json({error:'Invalid knowledge document body'});return null;}if(assistant_id&&(!isValidUUID(assistant_id)||(await query('SELECT id FROM ai_assistants WHERE id=$1 AND tenant_id=$2',[assistant_id,req.verified_tenant_id])).rowCount===0)){res.status(400).json({error:'Assistant must belong to this tenant'});return null;}return[title.trim(),content.trim(),assistant_id,status];};
router.get('/:tenantId/knowledge-base',requireTenantAccess,async(req,res)=>{if(!tenant(req,res))return;const r=await query('SELECT * FROM knowledge_base_documents WHERE tenant_id=$1 ORDER BY created_at DESC',[req.verified_tenant_id]);res.json(r.rows);});
router.post('/:tenantId/knowledge-base',requireTenantAccess,requireTenantAdmin,async(req,res)=>{if(!tenant(req,res))return;const b=await kbBody(req,res);if(!b)return;const r=await query('INSERT INTO knowledge_base_documents(title,content,assistant_id,status,tenant_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[...b,req.verified_tenant_id]);res.status(201).json(r.rows[0]);});
for (const method of ['get','put','delete']) router[method]('/:tenantId/knowledge-base/:documentId',requireTenantAccess,...(method==='get'?[]:[requireTenantAdmin]),async(req,res)=>{if(!tenant(req,res)||!isValidUUID(req.params.documentId))return res.status(400).json({error:'Invalid document ID'});if(method==='get'){const r=await query('SELECT * FROM knowledge_base_documents WHERE id=$1 AND tenant_id=$2',[req.params.documentId,req.verified_tenant_id]);return r.rowCount?res.json(r.rows[0]):res.status(404).json({error:'Knowledge document not found'});}if(method==='delete'){const r=await query('DELETE FROM knowledge_base_documents WHERE id=$1 AND tenant_id=$2 RETURNING id',[req.params.documentId,req.verified_tenant_id]);return r.rowCount?res.json({message:'Knowledge document deleted successfully'}):res.status(404).json({error:'Knowledge document not found'});}const b=await kbBody(req,res);if(!b)return;const r=await query('UPDATE knowledge_base_documents SET title=$1,content=$2,assistant_id=$3,status=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$5 AND tenant_id=$6 RETURNING *',[...b,req.params.documentId,req.verified_tenant_id]);return r.rowCount?res.json(r.rows[0]):res.status(404).json({error:'Knowledge document not found'});});
export default router;
