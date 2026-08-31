import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import pool from '../config/db.js';
import { authenticateToken, requireTenantAccess, requireTenantAdmin } from '../middleware/auth.js';
import { isValidUUID } from '../middleware/validators.js';
import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';
import {
  KnowledgeSourceIngestionError,
  KnowledgeSourceServiceError,
  createManualKnowledgeSource,
  createUploadedKnowledgeSource,
  enqueueKnowledgeIndexJob,
} from '../services/knowledge-source-service.js';
import {
  KnowledgeCandidateError,
  approveConversationKnowledgeCandidate,
  createImageKnowledgeCandidates,
  createConversationKnowledgeCandidate,
  rejectConversationKnowledgeCandidate,
} from '../services/knowledge-candidate-service.js';
import {
  KnowledgeConfigurationError,
  activateAssistantConfigurationVersion,
  activateBusinessProfileVersion,
  approveAssistantConfigurationVersion,
  approveBusinessProfileVersion,
  rollbackAssistantConfigurationVersion,
  updateAssistantConfigurationReview,
} from '../services/knowledge-configuration-service.js';
import { KnowledgeGapError } from '../services/knowledge-gap-service.js';
import { createSuggestedCandidateFromKnowledgeGap } from '../services/knowledge-gap-candidate-service.js';
import { createKnowledgeGenerationProvider, KnowledgeGenerationError } from '../services/knowledge-generation-provider.js';
import {
  analyzeBusinessProfileSourceScope,
  generateBusinessProfileVersion,
  KnowledgeProfileLifecycleError,
  rejectBusinessProfileVersion,
  updateBusinessProfileReview,
} from '../services/knowledge-profile-lifecycle.js';
import {
  generateAssistantConfigurationVersion,
  generateAssistantRecommendation,
  KnowledgeAssistantLifecycleError,
  rejectAssistantConfigurationVersion,
  reviewAssistantRecommendation,
} from '../services/knowledge-assistant-lifecycle.js';
import { getKnowledgeOverview, KnowledgeOverviewError } from '../services/knowledge-overview-service.js';
import { createOpenAIEmbedder } from '../services/knowledge-intelligence-service.js';
import { KnowledgeRetrievalPreviewError, previewKnowledgeRetrieval } from '../services/knowledge-retrieval-preview.js';
import { normalizeBusinessIdentity } from '../services/business-identity-service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

function tenant(req, res) {
  if (!isValidUUID(req.params.tenantId)) {
    res.status(400).json({ error: 'Invalid tenant ID' });
    return null;
  }
  return req.verified_tenant_id;
}

function sourceId(req, res) {
  if (!isValidUUID(req.params.sourceId)) {
    res.status(400).json({ error: 'Invalid knowledge source ID' });
    return null;
  }
  return req.params.sourceId;
}

function safeError(res, error) {
  const code = error?.code;
  if (error instanceof KnowledgeSourceIngestionError || error instanceof KnowledgeSourceServiceError || error instanceof KnowledgeCandidateError || error instanceof KnowledgeConfigurationError || error instanceof KnowledgeGapError || error instanceof KnowledgeGenerationError || error instanceof KnowledgeProfileLifecycleError || error instanceof KnowledgeAssistantLifecycleError || error instanceof KnowledgeOverviewError || error instanceof KnowledgeRetrievalPreviewError) {
    const status = code === 'IDENTITY_RESOLUTION_REQUIRED' ? 409 : /NOT_FOUND|INVALID|EMPTY|UNSUPPORTED|MISMATCH|REQUIRED/.test(code) ? 400 : 503;
    return res.status(status).json({ error: error.message, code, ...(error.details ? { details: error.details } : {}) });
  }
  console.error('Knowledge source operation failed:', code ?? error?.name ?? 'Error');
  return res.status(500).json({ error: 'Knowledge source operation failed' });
}

async function verifyAssistant(tenantId, assistantId) {
  if (!isValidUUID(assistantId)) throw new KnowledgeSourceServiceError('KNOWLEDGE_ASSISTANT_ASSIGNMENT_INVALID', 'Assistant ID is invalid');
  const result = await pool.query('SELECT id FROM ai_assistants WHERE id = $1 AND tenant_id = $2', [assistantId, tenantId]);
  if (!result.rowCount) throw new KnowledgeSourceServiceError('KNOWLEDGE_ASSISTANT_NOT_FOUND', 'Assigned Assistant was not found');
}

const router = express.Router();
router.use(authenticateToken);

router.get('/:tenantId/knowledge-intelligence/overview', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    return res.json({ overview: await getKnowledgeOverview({ database: pool, tenantId }) });
  } catch (error) {
    return safeError(res, error);
  }
});

router.get('/:tenantId/knowledge-intelligence/business-identities', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res); if (!tenantId) return;
  try {
    const result = await pool.query(`SELECT id, display_name, normalized_identity, status, created_at, updated_at
      FROM business_identities WHERE tenant_id = $1 AND status <> 'ARCHIVED' ORDER BY display_name`, [tenantId]);
    return res.json({ business_identities: result.rows });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/business-identities', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); if (!tenantId) return;
  const displayName = String(req.body?.display_name ?? '').trim();
  const normalizedIdentity = normalizeBusinessIdentity(displayName);
  if (!displayName || displayName.length > 255 || !normalizedIdentity) return res.status(400).json({ error: 'Business Identity display name is invalid', code: 'KNOWLEDGE_BUSINESS_IDENTITY_INVALID' });
  try {
    const result = await pool.query(`INSERT INTO business_identities (tenant_id, display_name, normalized_identity)
      VALUES ($1,$2,$3) ON CONFLICT (tenant_id, normalized_identity) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = CURRENT_TIMESTAMP
      RETURNING id, display_name, normalized_identity, status, created_at, updated_at`, [tenantId, displayName, normalizedIdentity]);
    return res.status(201).json({ business_identity: result.rows[0] });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/retrieval-preview', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId)) return res.status(400).json({ error: 'Invalid Assistant ID' });
  try {
    if (!process.env.OPENAI_API_KEY) throw new KnowledgeRetrievalPreviewError('KNOWLEDGE_PREVIEW_EMBEDDING_UNAVAILABLE', 'Retrieval preview embedding is unavailable');
    const embed = createOpenAIEmbedder(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
    const preview = await previewKnowledgeRetrieval({ database: pool, embed, tenantId, assistantId, query: req.body?.query, limit: req.body?.limit });
    return res.json({ preview });
  } catch (error) {
    return safeError(res, error);
  }
});

router.get('/:tenantId/knowledge-intelligence/sources', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  const statuses = ['UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DISABLED', 'ARCHIVED'];
  const requestedStatus = String(req.query.status ?? '').toUpperCase();
  if (requestedStatus && !statuses.includes(requestedStatus)) return res.status(400).json({ error: 'Invalid source status' });

  try {
    const result = await pool.query(
      `SELECT id, title, source_type, original_filename, mime_type, size_bytes,
              processing_status, indexing_status, processing_error_code, enabled,
              extraction_hash, extraction_method,
              (SELECT extraction_version FROM knowledge_source_extraction_segments segment WHERE segment.tenant_id = knowledge_base_documents.tenant_id AND segment.source_id = knowledge_base_documents.id AND segment.is_current = TRUE ORDER BY segment.created_at DESC LIMIT 1) AS extraction_version,
              (SELECT COUNT(*)::integer FROM knowledge_source_extraction_segments segment WHERE segment.tenant_id = knowledge_base_documents.tenant_id AND segment.source_id = knowledge_base_documents.id AND segment.is_current = TRUE) AS image_segment_count,
              COALESCE((SELECT json_object_agg(role, role_count) FROM (SELECT segment.role, COUNT(*)::integer AS role_count FROM knowledge_source_extraction_segments segment WHERE segment.tenant_id = knowledge_base_documents.tenant_id AND segment.source_id = knowledge_base_documents.id AND segment.is_current = TRUE GROUP BY segment.role) image_roles), '{}'::json) AS image_role_summary,
              created_at, updated_at, processed_at, indexed_at
         FROM knowledge_base_documents
        WHERE tenant_id = $1
          AND ($2::varchar IS NULL OR processing_status = $2)
        ORDER BY updated_at DESC
        LIMIT 100`,
      [tenantId, requestedStatus || null]
    );
    return res.json({ sources: result.rows });
  } catch (error) {
    return safeError(res, error);
  }
});

router.get('/:tenantId/knowledge-intelligence/sources/:sourceId', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res);
  const id = sourceId(req, res);
  if (!tenantId || !id) return;

  try {
    const result = await pool.query(
      `SELECT d.id, d.title, d.source_type, d.original_filename, d.mime_type, d.size_bytes,
              d.processing_status, d.indexing_status, d.processing_error_code, d.enabled,
              d.extraction_hash, d.extraction_method,
              (SELECT extraction_version FROM knowledge_source_extraction_segments segment WHERE segment.tenant_id = d.tenant_id AND segment.source_id = d.id AND segment.is_current = TRUE ORDER BY segment.created_at DESC LIMIT 1) AS extraction_version,
              (SELECT COUNT(*)::integer FROM knowledge_source_extraction_segments segment WHERE segment.tenant_id = d.tenant_id AND segment.source_id = d.id AND segment.is_current = TRUE) AS image_segment_count,
              COALESCE((SELECT json_object_agg(role, role_count) FROM (SELECT segment.role, COUNT(*)::integer AS role_count FROM knowledge_source_extraction_segments segment WHERE segment.tenant_id = d.tenant_id AND segment.source_id = d.id AND segment.is_current = TRUE GROUP BY segment.role) image_roles), '{}'::json) AS image_role_summary,
              d.created_at, d.updated_at, d.processed_at, d.indexed_at,
              COALESCE(json_agg(a.assistant_id) FILTER (WHERE a.assistant_id IS NOT NULL), '[]'::json) AS assistant_ids
         FROM knowledge_base_documents d
         LEFT JOIN knowledge_source_assistants a
           ON a.tenant_id = d.tenant_id AND a.source_id = d.id
        WHERE d.id = $1 AND d.tenant_id = $2
        GROUP BY d.id`,
      [id, tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Knowledge source not found' });
    return res.json({ source: result.rows[0] });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/sources/upload', requireTenantAccess, requireTenantAdmin, (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Knowledge upload is invalid', code: error.code });
    return next();
  });
}, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const assistantIds = req.body.assistant_ids ? JSON.parse(req.body.assistant_ids) : [];
    const source = await createUploadedKnowledgeSource({
      database: pool,
      storage: createConversationResourceStorage(),
      tenantId,
      uploadedBy: req.user.user_id,
      title: req.body.title,
      file: req.file,
      assistantIds,
    });
    return res.status(202).json({ source });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/sources/manual', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const source = await createManualKnowledgeSource({
      database: pool,
      tenantId,
      uploadedBy: req.user.user_id,
      title: req.body?.title,
      content: req.body?.content,
      assistantIds: req.body?.assistant_ids ?? [],
    });
    return res.status(202).json({ source });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/sources/:sourceId/assignments', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  const id = sourceId(req, res);
  const assistantId = req.body?.assistant_id;
  if (!tenantId || !id) return;

  try {
    await verifyAssistant(tenantId, assistantId);
    const source = await pool.query('SELECT id FROM knowledge_base_documents WHERE id = $1 AND tenant_id = $2 AND enabled = TRUE', [id, tenantId]);
    if (!source.rowCount) return res.status(404).json({ error: 'Knowledge source not found' });
    await pool.query(
      `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, source_id, assistant_id) DO NOTHING`,
      [tenantId, id, assistantId]
    );
    return res.status(204).end();
  } catch (error) {
    return safeError(res, error);
  }
});

router.delete('/:tenantId/knowledge-intelligence/sources/:sourceId/assignments/:assistantId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  const id = sourceId(req, res);
  if (!tenantId || !id || !isValidUUID(req.params.assistantId)) return res.status(400).json({ error: 'Invalid Assistant ID' });

  try {
    await pool.query(
      'DELETE FROM knowledge_source_assistants WHERE tenant_id = $1 AND source_id = $2 AND assistant_id = $3',
      [tenantId, id, req.params.assistantId]
    );
    return res.status(204).end();
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/sources/:sourceId/archive', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  const id = sourceId(req, res);
  if (!tenantId || !id) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const source = await client.query(
      `UPDATE knowledge_base_documents
          SET enabled = FALSE,
              status = 'inactive',
              processing_status = 'ARCHIVED',
              indexing_status = 'ARCHIVED',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
        RETURNING id`,
      [id, tenantId]
    );
    if (!source.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Knowledge source not found' });
    }
    await client.query(
      `UPDATE knowledge_chunks
          SET is_active = FALSE, index_status = 'DISABLED', updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND source_id = $2 AND is_active = TRUE`,
      [tenantId, id]
    );
    await client.query(
      `UPDATE knowledge_processing_jobs
          SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND source_id = $2 AND status IN ('PENDING', 'PROCESSING')`,
      [tenantId, id]
    );
    await client.query('COMMIT');
    return res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    return safeError(res, error);
  } finally {
    client.release();
  }
});

router.post('/:tenantId/knowledge-intelligence/sources/:sourceId/reindex', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  const id = sourceId(req, res);
  if (!tenantId || !id) return;
  try {
    const source = await pool.query(
      `SELECT id, content_hash
         FROM knowledge_base_documents
        WHERE id = $1 AND tenant_id = $2 AND enabled = TRUE AND status = 'active'`,
      [id, tenantId]
    );
    if (!source.rowCount) return res.status(404).json({ error: 'Knowledge source not found' });
    await pool.query(
      `UPDATE knowledge_base_documents
          SET processing_status = 'UPLOADED',
              indexing_status = 'PENDING',
              processing_error_code = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    const job = await enqueueKnowledgeIndexJob({ database: pool, tenantId, sourceId: id, contentHash: source.rows[0].content_hash, metadata: { reindex: true }, force: true });
    return res.status(202).json({ job });
  } catch (error) {
    return safeError(res, error);
  }
});


router.get('/:tenantId/knowledge-intelligence/candidates', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `SELECT id, assistant_id, candidate_type, proposed_title, proposed_content, confidence,
              candidate_fingerprint,
              status, pii_redaction_status, evidence_summary, approved_source_id, created_at, reviewed_at
         FROM knowledge_candidates
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [tenantId]
    );
    return res.json({ candidates: result.rows });
  } catch (error) {
    return safeError(res, error);
  }
});

router.get('/:tenantId/knowledge-intelligence/candidates/:candidateId/evidence', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.candidateId)) return res.status(400).json({ error: 'Invalid knowledge candidate ID' });
  try {
    const result = await pool.query(
      `SELECT 'CONVERSATION' AS evidence_type, conversation_id, message_id, NULL::uuid AS source_id,
              NULL::uuid AS segment_id, channel_type, sender_type, NULL::varchar AS evidence_kind,
              NULL::numeric AS role_confidence, NULL::text AS normalized_text, NULL::varchar AS source_title,
              NULL::varchar AS extraction_version, NULL::char(64) AS extraction_hash,
              NULL::integer AS segment_order, NULL::jsonb AS source_locator, occurred_at
         FROM knowledge_candidate_evidence
        WHERE tenant_id = $1 AND candidate_id = $2
      UNION ALL
       SELECT 'IMAGE' AS evidence_type, NULL::uuid AS conversation_id, NULL::uuid AS message_id,
              image.source_id, image.segment_id, 'IMAGE' AS channel_type, image.role AS sender_type, image.evidence_kind,
              image.role_confidence, image.normalized_text, source.title AS source_title,
              image.extraction_version, image.extraction_hash, image.segment_order, image.source_locator, image.created_at AS occurred_at
         FROM knowledge_candidate_image_evidence image
         LEFT JOIN knowledge_base_documents source
           ON source.id = image.source_id AND source.tenant_id = image.tenant_id
        WHERE image.tenant_id = $1 AND image.candidate_id = $2
        ORDER BY occurred_at ASC`,
      [tenantId, req.params.candidateId]
    );
    return res.json({ evidence: result.rows });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/sources/:sourceId/candidates/generate', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  const id = sourceId(req, res);
  if (!tenantId || !id) return;
  try {
    const candidates = await createImageKnowledgeCandidates({
      database: pool,
      tenantId,
      sourceId: id,
      assistantId: req.body?.assistant_id ?? null,
      extractionHash: req.body?.extraction_hash,
      candidateType: req.body?.candidate_type ?? 'POLICY',
    });
    const reused = candidates.length > 0 && candidates.every((candidate) => candidate.reused === true);
    return res.status(reused ? 200 : 201).json({ candidates, reused });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/candidates', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const candidate = await createConversationKnowledgeCandidate({
      database: pool,
      tenantId,
      assistantId: req.body?.assistant_id ?? null,
      candidateType: req.body?.candidate_type,
      title: req.body?.title,
      content: req.body?.content,
      confidence: req.body?.confidence ?? null,
      evidence: req.body?.evidence,
    });
    return res.status(201).json({ candidate });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/candidates/:candidateId/approve', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.candidateId)) return res.status(400).json({ error: 'Invalid knowledge candidate ID' });
  try {
    const source = await approveConversationKnowledgeCandidate({
      database: pool,
      tenantId,
      candidateId: req.params.candidateId,
      reviewedBy: req.user.user_id,
    });
    return res.status(202).json({ source });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/candidates/:candidateId/reject', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.candidateId)) return res.status(400).json({ error: 'Invalid knowledge candidate ID' });
  try {
    await rejectConversationKnowledgeCandidate({
      database: pool,
      tenantId,
      candidateId: req.params.candidateId,
      reviewedBy: req.user.user_id,
    });
    return res.status(204).end();
  } catch (error) {
    return safeError(res, error);
  }
});

router.get('/:tenantId/knowledge-intelligence/gaps', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res); if (!tenantId) return;
  const status = String(req.query.status ?? '').toUpperCase();
  const assistantId = req.query.assistant_id;
  if (status && !['DRAFT', 'NEEDS_REVIEW', 'RESOLVED', 'DISMISSED'].includes(status)) return res.status(400).json({ error: 'Invalid knowledge gap status' });
  if (assistantId && !isValidUUID(assistantId)) return res.status(400).json({ error: 'Invalid Assistant ID' });
  try {
    const result = await pool.query(`SELECT id, assistant_id, normalized_question, occurrence_count, status, suggested_candidate_id, signal_type, last_detected_at, created_at
      FROM knowledge_gaps WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2) AND ($3::uuid IS NULL OR assistant_id = $3)
      ORDER BY occurrence_count DESC, last_detected_at DESC LIMIT 100`, [tenantId, status || null, assistantId || null]);
    return res.json({ gaps: result.rows });
  } catch (error) { return safeError(res, error); }
});

router.get('/:tenantId/knowledge-intelligence/gaps/:gapId/signals', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res); if (!tenantId || !isValidUUID(req.params.gapId)) return res.status(400).json({ error: 'Invalid knowledge gap ID' });
  try {
    const result = await pool.query(`SELECT s.conversation_id, s.message_id, s.channel_type, s.signal_type, s.created_at
      FROM knowledge_gap_signals s JOIN knowledge_gaps g ON g.tenant_id = s.tenant_id AND g.normalized_question = lower(regexp_replace(s.redacted_question, '\\s+', ' ', 'g'))
      WHERE s.tenant_id = $1 AND g.id = $2 ORDER BY s.created_at ASC`, [tenantId, req.params.gapId]);
    return res.json({ signals: result.rows });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/gaps/:gapId/candidate', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); if (!tenantId || !isValidUUID(req.params.gapId)) return res.status(400).json({ error: 'Invalid knowledge gap ID' });
  try {
    const candidate = await createSuggestedCandidateFromKnowledgeGap({ database: pool, tenantId, gapId: req.params.gapId, title: req.body?.title, content: req.body?.content, createdBy: req.user.user_id });
    return res.status(201).json({ candidate });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/gaps/:gapId/:action(resolve|dismiss|reopen)', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); if (!tenantId || !isValidUUID(req.params.gapId)) return res.status(400).json({ error: 'Invalid knowledge gap ID' });
  const status = req.params.action === 'resolve' ? 'RESOLVED' : req.params.action === 'dismiss' ? 'DISMISSED' : 'NEEDS_REVIEW';
  try {
    const result = await pool.query(`UPDATE knowledge_gaps SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING id, status, suggested_candidate_id`, [req.params.gapId, tenantId, status]);
    if (!result.rowCount) return res.status(404).json({ error: 'Knowledge gap not found' });
    return res.json({ gap: result.rows[0] });
  } catch (error) { return safeError(res, error); }
});

router.get('/:tenantId/knowledge-intelligence/profiles', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `SELECT version.id, version.profile_id, version.schema_version, version.profile_data, version.evidence, version.source_scope,
              version.identity_resolution_status, version.status, profile.business_identity_id, identity.display_name AS business_identity_name,
              version.generated_by, version.reviewed_by, version.reviewed_at, version.activated_by,
              version.activated_at, version.superseded_by_version_id, version.created_at,
              profile.approved_version_id, profile.active_version_id
         FROM business_profile_versions version
         JOIN business_profiles profile ON profile.id = version.profile_id AND profile.tenant_id = version.tenant_id
         LEFT JOIN business_identities identity ON identity.id = profile.business_identity_id AND identity.tenant_id = profile.tenant_id
        WHERE version.tenant_id = $1
        ORDER BY version.created_at DESC
        LIMIT 100`,
      [tenantId]
    );
    return res.json({ profiles: result.rows });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/profiles/analyze', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const analysis = await analyzeBusinessProfileSourceScope({
      database: pool,
      provider: createKnowledgeGenerationProvider(),
      tenantId,
      businessIdentityId: req.body?.business_identity_id,
      sourceIds: req.body?.source_ids,
    });
    return res.json({ analysis: { status: analysis.status, business_identity: analysis.business_identity, source_ids: analysis.source_ids, identities: analysis.identities, evidence: analysis.evidence } });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/profiles/generate', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const result = await generateBusinessProfileVersion({
      database: pool,
      provider: createKnowledgeGenerationProvider(),
      tenantId,
      requestedBy: req.user.user_id,
      businessIdentityId: req.body?.business_identity_id,
      sourceIds: req.body?.source_ids,
    });
    return res.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    return safeError(res, error);
  }
});

router.put('/:tenantId/knowledge-intelligence/profiles/:versionId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Business Profile version ID' });
  try {
    const profile = await updateBusinessProfileReview({ database: pool, tenantId, versionId: req.params.versionId, profileData: req.body?.profile_data });
    return res.json({ profile });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/profiles/:versionId/reject', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Business Profile version ID' });
  try {
    const profile = await rejectBusinessProfileVersion({ database: pool, tenantId, versionId: req.params.versionId, reviewedBy: req.user.user_id });
    return res.json({ profile });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/profiles/:versionId/approve', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Business Profile version ID' });
  try {
    const profile = await approveBusinessProfileVersion({
      database: pool, tenantId, versionId: req.params.versionId, approvedBy: req.user.user_id,
    });
    return res.json({ profile });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/profiles/:versionId/activate', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Business Profile version ID' });
  try {
    const profile = await activateBusinessProfileVersion({
      database: pool, tenantId, versionId: req.params.versionId, activatedBy: req.user.user_id,
    });
    return res.json({ profile });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/profiles/:versionId/rollback', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Business Profile version ID' });
  try {
    const profile = await activateBusinessProfileVersion({ database: pool, tenantId, versionId: req.params.versionId, activatedBy: req.user.user_id });
    return res.json({ profile });
  } catch (error) { return safeError(res, error); }
});

router.get('/:tenantId/knowledge-intelligence/assistants/:assistantId/recommendations', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId)) return res.status(400).json({ error: 'Invalid Assistant ID' });
  try {
    const result = await pool.query(`SELECT id, recommendation_data, evidence, status, reviewed_by, reviewed_at, generation_run_id, created_at
      FROM assistant_knowledge_recommendations WHERE tenant_id = $1 AND assistant_id = $2 ORDER BY created_at DESC LIMIT 100`, [tenantId, assistantId]);
    return res.json({ recommendations: result.rows });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/recommendations/generate', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId)) return res.status(400).json({ error: 'Invalid Assistant ID' });
  try {
    const result = await generateAssistantRecommendation({ database: pool, provider: createKnowledgeGenerationProvider(), tenantId, assistantId, businessProfileVersionId: req.body?.business_profile_version_id, requestedBy: req.user.user_id });
    return res.status(result.reused ? 200 : 201).json(result);
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/recommendations/:recommendationId/:decision(approve|reject)', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId) || !isValidUUID(req.params.recommendationId)) return res.status(400).json({ error: 'Invalid recommendation ID' });
  try {
    const recommendation = await reviewAssistantRecommendation({ database: pool, tenantId, assistantId, recommendationId: req.params.recommendationId, reviewedBy: req.user.user_id, decision: req.params.decision === 'approve' ? 'APPROVED' : 'REJECTED' });
    return res.json({ recommendation });
  } catch (error) { return safeError(res, error); }
});

router.get('/:tenantId/knowledge-intelligence/assistants/:assistantId/configurations', requireTenantAccess, async (req, res) => {
  const tenantId = tenant(req, res);
  const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId)) return res.status(400).json({ error: 'Invalid Assistant ID' });
  try {
    await verifyAssistant(tenantId, assistantId);
    const result = await pool.query(
      `SELECT id, schema_version, configuration_data, source_profile_version_id, source_recommendation_id,
              generated_by, status, approved_by, approved_at, activated_by, activated_at,
              supersedes_version_id, created_at, updated_at
         FROM assistant_configuration_versions
        WHERE tenant_id = $1 AND assistant_id = $2
        ORDER BY created_at DESC
        LIMIT 100`,
      [tenantId, assistantId]
    );
    return res.json({ configurations: result.rows });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/configurations/generate', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId) || !isValidUUID(req.body?.recommendation_id)) return res.status(400).json({ error: 'Invalid configuration generation request' });
  try {
    const result = await generateAssistantConfigurationVersion({ database: pool, provider: createKnowledgeGenerationProvider(), tenantId, assistantId, recommendationId: req.body.recommendation_id, requestedBy: req.user.user_id });
    return res.status(result.reused ? 200 : 201).json(result);
  } catch (error) { return safeError(res, error); }
});

router.put('/:tenantId/knowledge-intelligence/assistants/:assistantId/configurations/:versionId', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId) || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Assistant configuration ID' });
  try {
    const configuration = await updateAssistantConfigurationReview({ database: pool, tenantId, assistantId, versionId: req.params.versionId, configurationData: req.body?.configuration_data });
    return res.json({ configuration });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/configurations/:versionId/reject', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId) || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Assistant configuration ID' });
  try {
    const configuration = await rejectAssistantConfigurationVersion({ database: pool, tenantId, assistantId, versionId: req.params.versionId, reviewedBy: req.user.user_id });
    return res.json({ configuration });
  } catch (error) { return safeError(res, error); }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/configurations/:versionId/approve', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId) || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Assistant configuration ID' });
  try {
    const configuration = await approveAssistantConfigurationVersion({
      database: pool, tenantId, assistantId, versionId: req.params.versionId, approvedBy: req.user.user_id,
    });
    return res.json({ configuration });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/configurations/:versionId/activate', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res);
  const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId) || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Assistant configuration ID' });
  try {
    const configuration = await activateAssistantConfigurationVersion({
      database: pool, tenantId, assistantId, versionId: req.params.versionId, activatedBy: req.user.user_id,
    });
    return res.json({ configuration });
  } catch (error) {
    return safeError(res, error);
  }
});

router.post('/:tenantId/knowledge-intelligence/assistants/:assistantId/configurations/:versionId/rollback', requireTenantAccess, requireTenantAdmin, async (req, res) => {
  const tenantId = tenant(req, res); const assistantId = req.params.assistantId;
  if (!tenantId || !isValidUUID(assistantId) || !isValidUUID(req.params.versionId)) return res.status(400).json({ error: 'Invalid Assistant configuration ID' });
  try {
    const configuration = await rollbackAssistantConfigurationVersion({ database: pool, tenantId, assistantId, versionId: req.params.versionId, activatedBy: req.user.user_id });
    return res.json({ configuration });
  } catch (error) { return safeError(res, error); }
});

export default router;

