import express from 'express';
import pool from '../config/db.js';
import { authenticateToken, requireTenantAccess, requireTenantAdmin } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';
import { GuideExperienceError, createGuideExperienceDraft, listGuideExperienceVersions, publishGuideExperience, updateGuideExperienceDraft } from '../services/guide-experience-service.js';

const router = express.Router();
router.use(authenticateToken);

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

function sendError(res, error) {
  if (error instanceof GuideExperienceError) return res.status(/NOT_FOUND|MISMATCH|INVALID/.test(error.code) ? 400 : 409).json({ error: error.message, code: error.code });
  console.error('Guide experience operation failed:', error?.code ?? error?.name ?? 'UNKNOWN');
  return res.status(503).json({ error: 'Guide experience is temporarily unavailable.' });
}

router.get('/:tenantId/guide-experiences/assistants/:assistantId', requireTenantAccess, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try { await verifyAssistant(scope); return res.json({ versions: await listGuideExperienceVersions({ database: pool, ...scope }) }); }
  catch (error) { return sendError(res, error); }
});

router.post('/:tenantId/guide-experiences/assistants/:assistantId/drafts', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const scope = validScope(req, res); if (!scope) return;
  try { await verifyAssistant(scope); const version = await createGuideExperienceDraft({ database: pool, ...scope, actorUserId: req.user.user_id, experience: req.body?.experience }); return res.status(201).json({ version }); }
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
    await client.query('COMMIT'); return res.json({ version, cache_key: `guide-experience:${scope.tenantId}:${scope.assistantId}:${version.version}` });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return sendError(res, error); }
  finally { client.release(); }
});

export default router;
