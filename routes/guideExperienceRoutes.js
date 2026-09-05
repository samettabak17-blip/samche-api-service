import express from 'express';
import multer from 'multer';
import pool from '../config/db.js';
import { authenticateToken, requireTenantAccess, requireTenantAdmin } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';
import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';
import { GuideExperienceAssetError, storeGuideExperienceAsset } from '../services/guide-experience-asset-service.js';
import { GuideExperienceError, createGuideExperienceDraft, inspectGuideExperiencePublication, listGuideExperienceVersions, publishGuideExperience, resolvePublishedGuideExperience, rollbackGuideExperience, updateGuideExperienceDraft } from '../services/guide-experience-service.js';
import { GuideRecommendationError, generateGuideExperienceRecommendation } from '../services/guide-experience-recommendation-service.js';
import { GuideThemeError, deriveAccessibleGuideTheme } from '../services/guide-theme-service.js';
import { resolveCname } from 'node:dns/promises';
import { GuideDomainError, activateGuideDomain, archiveGuideDomain, configuredGuideDomainIngressTarget, configuredManagedGuideDomainSuffix, createGuideDomain, ensureManagedGuideDomainForAssistant, listGuideDomains, managedGuideHostnameFromSlug, verifyGuideDomainDns } from '../services/guide-domain-service.js';
import { archiveGuideDomainIngress, provisionGuideDomainIngress, resolveGuideDomainIngressStatus, verifyGuideDomainIngress } from '../services/guide-domain-ingress-service.js';
import { issueGuidePreviewToken } from '../services/guide-preview-service.js';

const router = express.Router();
router.use(authenticateToken);
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 5 * 1024 * 1024 } });

function validScope(req, res) {
  if (!isValidUUID(req.params.tenantId) || !isValidUUID(req.params.assistantId)) {
    res.status(400).json({ error: 'Guide experience scope is invalid.' });
    return null;
  }
  return { tenantId: req.verified_tenant_id, assistantId: req.params.assistantId };
}

async function verifyAssistant({ tenantId, assistantId }) {
  const result = await pool.query(`SELECT id FROM ai_assistants WHERE id=$1 AND tenant_id=$2 AND status='active'`, [assistantId, tenantId]);
  if (!result.rowCount) throw new GuideExperienceError('GUIDE_EXPERIENCE_SCOPE_MISMATCH');
}

async function verifyGuideChannel({ tenantId, assistantId, channelId }) {
  if (!isValidUUID(channelId)) throw new GuideDomainError('GUIDE_DOMAIN_CHANNEL_INVALID');
  const result = await pool.query(
    `SELECT tc.id FROM tenant_channels tc
      JOIN channel_integrations ci ON ci.channel_id=tc.id AND ci.tenant_id=tc.tenant_id
        AND ci.assistant_id=tc.assistant_id AND ci.integration_type='SAMCHEGUIDE' AND ci.enabled=TRUE
      WHERE tc.id=$1 AND tc.tenant_id=$2 AND tc.assistant_id=$3 AND tc.channel_type='SAMCHEGUIDE' AND tc.status='active'`,
    [channelId, tenantId, assistantId],
  );
  if (!result.rowCount) throw new GuideDomainError('GUIDE_DOMAIN_SCOPE_MISMATCH');
}

function sendError(res, error) {
  if (error?.code === '23505') return res.status(409).json({ error: 'This hostname is already bound to a Guide.', code: 'GUIDE_DOMAIN_HOSTNAME_EXISTS' });
  if (error instanceof GuideDomainError) {
    const status = /INVALID|NOT_FOUND|MISMATCH|CHANNEL/.test(error.code) ? 400 : (/INGRESS|VERIFICATION/.test(error.code) ? 503 : 409);
    return res.status(status).json({ error: error.message, code: error.code });
  }
  if (error instanceof GuideExperienceAssetError) return res.status(/UNSUPPORTED|MISMATCH|INVALID|REQUIRED|KIND/.test(error.code) ? 400 : (/SIZE/.test(error.code) ? 413 : 503)).json({ error: error.message, code: error.code });
  if (error instanceof GuideExperienceError) return res.status(/NOT_FOUND|MISMATCH|INVALID/.test(error.code) ? 400 : 409).json({ error: error.message, code: error.code });
  if (error instanceof GuideRecommendationError) return res.status(409).json({ error: 'Active tenant intelligence is required before generating a Guide recommendation.', code: error.code });
  if (error instanceof GuideThemeError) return res.status(400).json({ error: 'Guide theme candidates are invalid.', code: error.code });
  console.error('Guide experience operation failed:', error?.code ?? error?.name ?? 'UNKNOWN');
  return res.status(503).json({ error: 'Guide experience is temporarily unavailable.' });
}

router.get('/:tenantId/guide-experiences/assistants/:assistantId', requireTenantAccess, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try { await verifyAssistant(scope); return res.json({ versions: await listGuideExperienceVersions({ database: pool, ...scope }) }); }
  catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/assets', requireTenantAccess, requireTenantAdmin, (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Guide branding asset is invalid.', code: error.code });
    return next();
  });
}, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try {
    await verifyAssistant(scope);
    const asset = await storeGuideExperienceAsset({ database: pool, storage: createConversationResourceStorage(), ...scope, actorUserId: req.user.user_id, file: req.file, kind: req.body?.kind });
    return res.status(201).json({ asset: { ...asset, public_url: `/guide/assets/${asset.id}` } });
  } catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/drafts', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try { await verifyAssistant(scope); const version = await createGuideExperienceDraft({ database: pool, ...scope, actorUserId: req.user.user_id, experience: req.body?.experience }); return res.status(201).json({ version }); }
  catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/recommendations/draft', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try {
    await verifyAssistant(scope);
    const published = await resolvePublishedGuideExperience({ database: pool, ...scope });
    const recommendation = await generateGuideExperienceRecommendation({ database: pool, ...scope, currentExperience: published.experience });
    const version = await createGuideExperienceDraft({ database: pool, ...scope, actorUserId: req.user.user_id, experience: recommendation.experience });
    return res.status(201).json({ version, recommendation: recommendation.recommendation });
  } catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/theme-recommendation', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try { await verifyAssistant(scope); return res.json({ theme: deriveAccessibleGuideTheme({ candidates: req.body?.candidates }) }); }
  catch (error) { return sendError(res, error); }
});

router.put('/:tenantId/guide-experiences/assistants/:assistantId/drafts/:versionId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Guide experience version is invalid.' });
  try { await verifyAssistant(scope); const version = await updateGuideExperienceDraft({ database: pool, ...scope, versionId: req.params.versionId, actorUserId: req.user.user_id, experience: req.body?.experience }); return res.json({ version }); }
  catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/drafts/:versionId/publish', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Guide experience version is invalid.' });
  const client = await pool.connect();
  try {
    await verifyAssistant(scope); await client.query('BEGIN');
    const version = await publishGuideExperience({ client, ...scope, versionId: req.params.versionId, actorUserId: req.user.user_id });
    const channelResult = await client.query(
      `SELECT channel_id FROM channel_integrations WHERE tenant_id=$1 AND assistant_id=$2 AND integration_type='SAMCHEGUIDE' AND enabled=TRUE LIMIT 1`,
      [scope.tenantId, scope.assistantId],
    );
    if (channelResult.rowCount) {
      await ensureManagedGuideDomainForAssistant({ database: client, tenantId: scope.tenantId, assistantId: scope.assistantId, channelId: channelResult.rows[0].channel_id });
    }
    await client.query('COMMIT'); return res.json({ version, cache_key: `guide-experience:${scope.tenantId}:${scope.assistantId}:${version.version}` });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return sendError(res, error); }
  finally { client.release(); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/drafts/:versionId/preview', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Guide experience version is invalid.' });
  try {
    await verifyAssistant(scope);
    const draft = await pool.query(`SELECT id, status FROM guide_experience_versions WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3`, [req.params.versionId, scope.tenantId, scope.assistantId]);
    if (!draft.rowCount || draft.rows[0].status !== 'DRAFT') return res.status(409).json({ error: 'Only a private draft can be previewed.', code: 'GUIDE_PREVIEW_DRAFT_REQUIRED' });
    const domains = await listGuideDomains({ database: pool, ...scope });
    let activeDomain = domains.find((domain) => domain.status === 'ACTIVE');
    if (!activeDomain) {
      const channelResult = await pool.query(
        `SELECT channel_id FROM channel_integrations WHERE tenant_id=$1 AND assistant_id=$2 AND integration_type='SAMCHEGUIDE' AND enabled=TRUE LIMIT 1`,
        [scope.tenantId, scope.assistantId],
      );
      if (channelResult.rowCount) {
        activeDomain = await ensureManagedGuideDomainForAssistant({ database: pool, tenantId: scope.tenantId, assistantId: scope.assistantId, channelId: channelResult.rows[0].channel_id });
      }
    }
    if (!activeDomain) return res.status(409).json({ error: 'An active Guide domain is required for private preview.', code: 'GUIDE_PREVIEW_DOMAIN_REQUIRED' });
    const token = issueGuidePreviewToken({ tenantId: scope.tenantId, assistantId: scope.assistantId, versionId: req.params.versionId, actorUserId: req.user.user_id });
    return res.json({ preview_path: `/?preview=${encodeURIComponent(token)}`, hostname: activeDomain.hostname, expires_in_seconds: 600 });
  } catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/versions/:versionId/rollback', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Guide experience version is invalid.' });
  if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Confirm rollback before publishing a previous Guide experience.', code: 'GUIDE_EXPERIENCE_ROLLBACK_CONFIRMATION_REQUIRED' });
  const client = await pool.connect();
  try {
    await verifyAssistant(scope); await client.query('BEGIN');
    const version = await rollbackGuideExperience({ client, ...scope, versionId: req.params.versionId, actorUserId: req.user.user_id });
    await client.query('COMMIT'); return res.json({ version, cache_key: `guide-experience:${scope.tenantId}:${scope.assistantId}:${version.version}` });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return sendError(res, error); }
  finally { client.release(); }
});

router.get('/:tenantId/guide-experiences/assistants/:assistantId/domains', requireTenantAccess, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try { await verifyAssistant(scope); return res.json({ domains: await listGuideDomains({ database: pool, ...scope }), managed_domain_suffix: configuredManagedGuideDomainSuffix() }); }
  catch (error) { return sendError(res, error); }
});

router.get('/:tenantId/guide-experiences/assistants/:assistantId/publication-diagnostics', requireTenantAccess, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try { await verifyAssistant(scope); return res.json(await inspectGuideExperiencePublication({ database: pool, ...scope })); }
  catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/domains', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  const client = await pool.connect();
  let provisioned = null;
  try {
    await verifyAssistant(scope);
    await verifyGuideChannel({ ...scope, channelId: req.body?.channel_id });
    const domainMode = req.body?.domain_mode === 'MANAGED' ? 'MANAGED' : 'CUSTOM';
    const hostname = domainMode === 'MANAGED' ? managedGuideHostnameFromSlug(req.body?.slug) : req.body?.hostname;
    // Managed hosts ride the shared wildcard ingress; only customer-owned
    // domains require an individual Render registration and DNS challenge.
    provisioned = domainMode === 'CUSTOM' ? await provisionGuideDomainIngress({ hostname }) : { state: 'WILDCARD', hostname };
    await client.query('BEGIN');
    const domain = await createGuideDomain({ client, ...scope, channelId: req.body.channel_id, hostname, domainMode, actorUserId: req.user.user_id, ingressTarget: configuredGuideDomainIngressTarget() });
    await client.query('COMMIT');
    return res.status(201).json({ domain, dns: { type: domain.verification_record_type, host: domain.hostname, target: domain.verification_target } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (provisioned?.state === 'REGISTERED') await archiveGuideDomainIngress({ hostname: provisioned.hostname }).catch(() => {});
    return sendError(res, error);
  }
  finally { client.release(); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/domains/:domainId/verify', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope || !isValidUUID(req.params.domainId)) return res.status(400).json({ error: 'Guide domain is invalid.' });
  const client = await pool.connect();
  try {
    await verifyAssistant(scope); await client.query('BEGIN');
    const domain = await verifyGuideDomainDns({ client, ...scope, domainId: req.params.domainId, actorUserId: req.user.user_id, resolveCname });
    if (domain.status === 'FAILED') {
      await client.query('COMMIT');
      return res.status(422).json({ error: 'Guide domain DNS verification failed.', code: 'GUIDE_DOMAIN_VERIFICATION_FAILED', domain });
    }
    await verifyGuideDomainIngress({ hostname: domain.hostname });
    const ingress = await resolveGuideDomainIngressStatus({ hostname: domain.hostname });
    const resolved = ingress.verified
      ? await activateGuideDomain({ client, ...scope, domainId: req.params.domainId, actorUserId: req.user.user_id })
      : domain;
    await client.query('COMMIT');
    if (resolved.status === 'VERIFIED') return res.status(202).json({ domain: resolved, verification: 'PENDING_INGRESS' });
    return res.json({ domain: resolved });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return sendError(res, error); }
  finally { client.release(); }
});

router.delete('/:tenantId/guide-experiences/assistants/:assistantId/domains/:domainId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope || !isValidUUID(req.params.domainId)) return res.status(400).json({ error: 'Guide domain is invalid.' });
  const client = await pool.connect();
  try {
    await verifyAssistant(scope); await client.query('BEGIN');
    const selected = await client.query(`SELECT hostname FROM guide_domains WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 FOR UPDATE`, [req.params.domainId, scope.tenantId, scope.assistantId]);
    if (!selected.rowCount) throw new GuideDomainError('GUIDE_DOMAIN_NOT_FOUND');
    await archiveGuideDomainIngress({ hostname: selected.rows[0].hostname });
    const domain = await archiveGuideDomain({ client, ...scope, domainId: req.params.domainId, actorUserId: req.user.user_id });
    await client.query('COMMIT'); return res.json({ domain });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return sendError(res, error); }
  finally { client.release(); }
});

export default router;
