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
import { discoverAndIndexTenantSite } from '../services/tenant-site-discovery-service.js';
import { listTenantSitePages, getTenantSiteDiscoveryState } from '../services/tenant-site-index-service.js';
import multer from 'multer';
import {
  WebChatAssetError,
  storeWebChatAsset,
  deleteWebChatAsset,
  getPublicWebChatAsset,
} from '../services/web-chat-asset-service.js';
import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';
import {
  getTenantInstagramStatus,
  configureTenantInstagramChannel,
  disconnectTenantInstagramChannel,
  testTenantInstagramConnection,
  TenantInstagramProvisioningError,
} from '../services/tenant-instagram-provisioning-service.js';
import {
  getWhatsAppEmbeddedSignupConfig,
  exchangeAndOnboardWhatsApp,
  getWhatsAppChannelStatus,
  disconnectWhatsAppChannel,
  WhatsAppEmbeddedSignupError,
} from '../services/whatsapp-embedded-signup-service.js';

const webChatLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 2 * 1024 * 1024 },
});




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

const whatsAppEmbeddedSignupErrorResponse = (req, res, error) => {
  if (!(error instanceof WhatsAppEmbeddedSignupError)) return false;
  const statuses = {
    TENANT_ID_REQUIRED: 400,
    AUTHENTICATION_REQUIRED: 401,
    AUTHORIZATION_CODE_REQUIRED: 400,
    WABA_ID_REQUIRED: 400,
    ASSISTANT_ID_REQUIRED: 400,
    OAUTH_STATE_INVALID: 400,
    TENANT_NOT_ENTITLED: 403,
    WHATSAPP_ASSISTANT_INELIGIBLE: 400,
    META_APP_NOT_CONFIGURED: 503,
    META_CODE_EXCHANGE_FAILED: 400,
    META_WABA_VERIFICATION_FAILED: 400,
    WHATSAPP_PHONE_NUMBER_NOT_FOUND: 400,
    WHATSAPP_PHONE_ID_INVALID: 400,
    WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT: 409,
    DATABASE_UNAVAILABLE: 500,
  };
  const body = {
    error: error.code,
    message: error.message,
    ...(error.details || {}),
  };
  res.status(statuses[error.code] ?? 400).json(body);
  return true;
};

const channelBody = async (req, res) => {
  const { channel_type, display_name, external_channel_id = null, assistant_id = null, status = 'active' } = req.body;
  if (!['WEB_CHAT','WHATSAPP','INSTAGRAM'].includes(channel_type) || typeof display_name !== 'string' || !display_name.trim() || !['active','inactive'].includes(status)) {
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
    } else if (channelType === 'INSTAGRAM') {
      const result = await configureTenantInstagramChannel({
        database: req.app?.locals?.database || pool,
        tenantId: req.verified_tenant_id,
        displayName,
        externalChannelId,
        assistantId,
        status,
      });
      channel = {
        id: result.channel_id,
        tenant_id: req.verified_tenant_id,
        assistant_id: result.assistant_id,
        channel_type: 'INSTAGRAM',
        display_name: result.display_name,
        external_channel_id: result.external_channel_id,
        status,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
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

router.post('/:tenantId/channels/web-chat/discover-site', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.CONFIGURE })) {
    return res.status(403).json({ error: 'Web Chat configure access required' });
  }

  const { website_url: websiteUrl = null, max_pages: maxPages = 50 } = req.body ?? {};
  let targetUrl = websiteUrl;

  if (!targetUrl) {
    const integration = await getWebChatIntegrationForTenant({ database: req.app?.locals?.database || pool, tenantId: req.verified_tenant_id });
    targetUrl = integration?.behavior?.website_url || null;
  }

  if (!targetUrl || typeof targetUrl !== 'string' || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'A valid website_url (http/https) is required for discovery.' });
  }

  try {
    const discoveryResult = await discoverAndIndexTenantSite({
      database: req.app?.locals?.database || pool,
      tenantId: req.verified_tenant_id,
      rootUrl: targetUrl,
      options: { maxPages: Number(maxPages) || 50 },
    });
    return res.status(200).json(discoveryResult);
  } catch (error) {
    console.error('Site discovery error:', error);
    return res.status(500).json({ error: 'Site discovery failed', message: error?.message });
  }
});

router.get('/:tenantId/channels/web-chat/site-pages', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;
  if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.VIEW })) {
    return res.status(403).json({ error: 'Web Chat view access required' });
  }

  try {
    const pages = await listTenantSitePages({
      database: req.app?.locals?.database || pool,
      tenantId: req.verified_tenant_id,
      pageType: req.query.page_type || null,
      limit: Number(req.query.limit) || 100,
    });
    const hostname = req.query.hostname ? String(req.query.hostname).toLowerCase() : (pages[0]?.hostname || null);
    const discoveryState = hostname
      ? await getTenantSiteDiscoveryState({ database: req.app?.locals?.database || pool, tenantId: req.verified_tenant_id, hostname })
      : null;

    return res.json({
      discovery_state: discoveryState,
      total_pages: pages.length,
      pages,
    });
  } catch (error) {
    console.error('List site pages error:', error);
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
    glow_intensity: glowIntensity = 80,
    glow_spread: glowSpread = 70,
    pulse_animation: pulseAnimation = 'normal',
    pulse_mode: pulseMode = null,
    animation_speed: animationSpeed = 'normal',
    pulse_speed: pulseSpeed = null,
    launcher_style: launcherStyle = 'pill',
    launcher_theme_mode: launcherThemeMode = 'follow_theme',
    launcher_background: launcherBackground = null,
    launcher_bg: launcherBg = null,
    launcher_foreground: launcherForeground = null,
    launcher_text: launcherText = null,
    launcher_border_color: launcherBorderColor = null,
    launcher_border: launcherBorder = null,
    launcher_glow_color: launcherGlowColor = null,
    launcher_glow: launcherGlow = null,
    launcher_logo_background: launcherLogoBackground = null,
    launcher_logo_bg: launcherLogoBg = null,
    launcher_logo_border_color: launcherLogoBorderColor = null,
    launcher_logo_border: launcherLogoBorder = null,
  } = req.body ?? {};

  try {
    let result;
    const effectiveLauncherBg = launcherBackground ?? launcherBg ?? null;
    const effectiveLauncherText = launcherForeground ?? launcherText ?? null;
    const effectiveLauncherBorder = launcherBorderColor ?? launcherBorder ?? null;
    const effectiveLauncherGlow = launcherGlowColor ?? launcherGlow ?? null;
    const effectiveLauncherLogoBg = launcherLogoBackground ?? launcherLogoBg ?? null;
    const effectiveLauncherLogoBorder = launcherLogoBorderColor ?? launcherLogoBorder ?? null;
    const effectivePulse = pulseMode || pulseAnimation;
    const effectiveSpeed = pulseSpeed || animationSpeed;

    if (Array.isArray(candidates) && candidates.length > 0) {
      result = analyzeLogoPalette({
        candidates,
        baseColor: primaryColor || baseColor,
        mode,
        glowIntensity,
        glowSpread,
        pulseAnimation: effectivePulse,
        pulseMode: effectivePulse,
        animationSpeed: effectiveSpeed,
        pulseSpeed: effectiveSpeed,
        launcherStyle,
        launcherThemeMode,
        launcherBackground: effectiveLauncherBg,
        launcherBg: effectiveLauncherBg,
        launcherForeground: effectiveLauncherText,
        launcherText: effectiveLauncherText,
        launcherBorderColor: effectiveLauncherBorder,
        launcherBorder: effectiveLauncherBorder,
        launcherGlowColor: effectiveLauncherGlow,
        launcherGlow: effectiveLauncherGlow,
        launcherLogoBackground: effectiveLauncherLogoBg,
        launcherLogoBg: effectiveLauncherLogoBg,
        launcherLogoBorderColor: effectiveLauncherLogoBorder,
        launcherLogoBorder: effectiveLauncherLogoBorder,
      });
    } else {
      result = deriveWebChatThemeTokens({
        primaryColor: primaryColor || baseColor || '#2563EB',
        accentColor,
        mode,
        glowIntensity,
        glowSpread,
        pulseAnimation: effectivePulse,
        pulseMode: effectivePulse,
        animationSpeed: effectiveSpeed,
        pulseSpeed: effectiveSpeed,
        launcherStyle,
        launcherThemeMode,
        launcherBackground: effectiveLauncherBg,
        launcherBg: effectiveLauncherBg,
        launcherForeground: effectiveLauncherText,
        launcherText: effectiveLauncherText,
        launcherBorderColor: effectiveLauncherBorder,
        launcherBorder: effectiveLauncherBorder,
        launcherGlowColor: effectiveLauncherGlow,
        launcherGlow: effectiveLauncherGlow,
        launcherLogoBackground: effectiveLauncherLogoBg,
        launcherLogoBg: effectiveLauncherLogoBg,
        launcherLogoBorderColor: effectiveLauncherLogoBorder,
        launcherLogoBorder: effectiveLauncherLogoBorder,
      });
    }
    return res.json(result);
  } catch (error) {
    console.error('Theme preview generation error:', error);
    return res.status(400).json({ error: 'Failed to generate theme preview' });
  }
});
router.get(
  '/:tenantId/channels/web-chat/logo',
  requireTenantAccess,
  async (req, res) => {
    if (!tenant(req, res)) return;
    try {
      const database = req.app?.locals?.database || pool;
      let storage = null;
      try {
        storage = req.app?.locals?.storage || createConversationResourceStorage();
      } catch (e) {
        storage = null;
      }
      const current = await getWebChatIntegrationForTenant({ database, tenantId: req.verified_tenant_id });
      const assetId = current?.appearance?.logo_asset_id;
      if (!assetId || !storage) return res.sendStatus(404);

      const assetRes = await database.query(
        `SELECT id, tenant_id, asset_kind, storage_key, mime_type, size_bytes
           FROM tenant_web_chat_assets
          WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
        [assetId, req.verified_tenant_id]
      );
      if (assetRes.rowCount === 0) return res.sendStatus(404);
      const asset = assetRes.rows[0];
      const stream = await storage.get({ key: asset.storage_key });
      res.set({
        'Content-Type': asset.mime_type,
        'Content-Length': String(asset.size_bytes),
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      });
      stream.on('error', () => {
        if (!res.headersSent) res.sendStatus(404);
        else res.end();
      });
      return stream.pipe(res);
    } catch (error) {
      console.error('Tenant logo read error:', error);
      return res.sendStatus(404);
    }
  }
);

router.post(
  '/:tenantId/channels/web-chat/logo',
  requireTenantAccess,
  requireTenantAdmin,
  (req, res, next) => {
    webChatLogoUpload.single('file')(req, res, (error) => {
      if (error) {
        return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          error: 'Web Chat branding asset is invalid: ' + error.message,
          code: error.code || 'ASSET_UPLOAD_FAILED',
        });
      }
      return next();
    });
  },
  async (req, res) => {
    if (!tenant(req, res)) return;
    if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.CONFIGURE })) {
      return res.status(403).json({ error: 'Web Chat configure access required' });
    }

    try {
      const database = req.app?.locals?.database || pool;
      let storage = null;
      try {
        storage = req.app?.locals?.storage || createConversationResourceStorage();
      } catch (e) {
        storage = null;
      }

      const asset = await storeWebChatAsset({
        database,
        storage,
        tenantId: req.verified_tenant_id,
        actorUserId: req.user?.id || null,
        file: req.file,
      });

      const current = await getWebChatIntegrationForTenant({ database, tenantId: req.verified_tenant_id });
      let updatedIntegration = null;
      if (current) {
        const nextAppearance = {
          ...(current.appearance || {}),
          logo_url: asset.public_url,
          logo_asset_id: asset.id,
        };
        updatedIntegration = await ensureWebChatIntegration({
          database,
          tenantId: req.verified_tenant_id,
          appearance: nextAppearance,
        });
      }

      return res.status(200).json({
        asset,
        integration: updatedIntegration,
        appearance: updatedIntegration?.appearance || {
          logo_url: asset.public_url,
          logo_asset_id: asset.id,
        },
        theme: asset.theme,
        palette: asset.palette,
      });
    } catch (error) {
      if (error instanceof WebChatAssetError) {
        const isClientError = /UNSUPPORTED|MISMATCH|INVALID|REQUIRED|SVG/.test(error.code);
        return res.status(isClientError ? 400 : (error.code.includes('SIZE') ? 413 : 503)).json({
          error: error.message,
          code: error.code,
        });
      }
      console.error('Web chat logo upload error:', error);
      return res.status(500).json({ error: error.message || 'Server error' });
    }
  }
);

router.delete(
  '/:tenantId/channels/web-chat/logo',
  requireTenantAccess,
  requireTenantAdmin,
  async (req, res) => {
    if (!tenant(req, res)) return;
    if (!canPerformWebChatAction({ systemRole: req.user?.system_role, tenantRole: req.verified_tenant_role, action: WEBCHAT_PERMISSIONS.CONFIGURE })) {
      return res.status(403).json({ error: 'Web Chat configure access required' });
    }

    try {
      const database = req.app?.locals?.database || pool;
      let storage = null;
      try {
        storage = req.app?.locals?.storage || createConversationResourceStorage();
      } catch (e) {
        storage = null;
      }

      const current = await getWebChatIntegrationForTenant({ database, tenantId: req.verified_tenant_id });
      const assetId = current?.appearance?.logo_asset_id || req.body?.asset_id || null;

      if (assetId) {
        await deleteWebChatAsset({
          database,
          storage,
          tenantId: req.verified_tenant_id,
          assetId,
        }).catch(() => {});
      }

      let updatedIntegration = null;
      if (current) {
        const nextAppearance = {
          ...(current.appearance || {}),
          logo_url: null,
          logo_asset_id: null,
        };
        updatedIntegration = await ensureWebChatIntegration({
          database,
          tenantId: req.verified_tenant_id,
          appearance: nextAppearance,
        });
      }

      return res.status(200).json({
        ok: true,
        integration: updatedIntegration,
        appearance: updatedIntegration?.appearance || {
          logo_url: null,
          logo_asset_id: null,
        },
      });
    } catch (error) {
      console.error('Web chat logo delete error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  }
);



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
router.get('/:tenantId/channels/whatsapp/config', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;
  try {
    const database = req.app?.locals?.database || pool;
    const config = await getWhatsAppEmbeddedSignupConfig({
      database,
      tenantId: req.verified_tenant_id,
      userId: req.user?.id || req.user?.user_id,
    });
    return res.json(config);
  } catch (error) {
    if (whatsAppEmbeddedSignupErrorResponse(req, res, error)) return;
    console.error('Fetch WhatsApp config error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:tenantId/channels/whatsapp/status', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;
  try {
    const database = req.app?.locals?.database || pool;
    const status = await getWhatsAppChannelStatus({
      database,
      tenantId: req.verified_tenant_id,
    });
    return res.json(status);
  } catch (error) {
    if (whatsAppEmbeddedSignupErrorResponse(req, res, error)) return;
    console.error('Fetch WhatsApp status error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:tenantId/channels/whatsapp/embedded-signup', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  const {
    code,
    waba_id: wabaId,
    phone_number_id: phoneNumberId = null,
    assistant_id: assistantId,
    state_token: oauthState,
  } = req.body ?? {};

  try {
    const database = req.app?.locals?.database || pool;
    const httpClient = req.app?.locals?.httpClient || axios;
    const result = await exchangeAndOnboardWhatsApp({
      database,
      tenantId: req.verified_tenant_id,
      userId: req.user?.id || req.user?.user_id,
      code,
      wabaId,
      phoneNumberId,
      assistantId,
      oauthState,
      httpClient,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (whatsAppEmbeddedSignupErrorResponse(req, res, error)) return;
    console.error('WhatsApp embedded signup error:', error);
    return res.status(500).json({ error: 'Server error', message: error?.message });
  }
});

router.post('/:tenantId/channels/whatsapp/disconnect', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  const { channel_id: channelId = null } = req.body ?? {};
  try {
    const database = req.app?.locals?.database || pool;
    const result = await disconnectWhatsAppChannel({
      database,
      tenantId: req.verified_tenant_id,
      channelId,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (whatsAppEmbeddedSignupErrorResponse(req, res, error)) return;
    console.error('WhatsApp disconnect error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});


router.get('/:tenantId/channels/instagram/status', requireTenantAccess, async (req, res) => {
  if (!tenant(req, res)) return;
  try {
    const database = req.app?.locals?.database || pool;
    const status = await getTenantInstagramStatus({
      database,
      tenantId: req.verified_tenant_id,
    });
    return res.json(status);
  } catch (error) {
    console.error('Fetch Instagram status error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:tenantId/channels/instagram/config', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  const {
    display_name = 'Instagram',
    external_channel_id,
    assistant_id = null,
    instagram_account_id,
    page_id,
    instagram_business_account_id,
    account_username,
    account_name,
    access_token,
    auth_mode = 'INSTAGRAM_LOGIN',
    status = 'active',
  } = req.body ?? {};

  try {
    const database = req.app?.locals?.database || pool;
    const configured = await configureTenantInstagramChannel({
      database,
      tenantId: req.verified_tenant_id,
      displayName: display_name,
      externalChannelId: external_channel_id,
      assistantId: assistant_id,
      instagramAccountId: instagram_account_id,
      pageId: page_id,
      instagramBusinessAccountId: instagram_business_account_id,
      accountUsername: account_username,
      accountName: account_name,
      accessToken: access_token,
      authMode: auth_mode,
      status,
    });
    return res.status(200).json(configured);
  } catch (error) {
    if (error?.name === 'TenantInstagramProvisioningError') {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    console.error('Configure Instagram error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:tenantId/channels/instagram/disconnect', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  try {
    const database = req.app?.locals?.database || pool;
    const result = await disconnectTenantInstagramChannel({
      database,
      tenantId: req.verified_tenant_id,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Disconnect Instagram error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:tenantId/channels/instagram/test-connection', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  if (!tenant(req, res)) return;
  try {
    const database = req.app?.locals?.database || pool;
    const result = await testTenantInstagramConnection({
      database,
      tenantId: req.verified_tenant_id,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Test Instagram connection error:', error);
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
