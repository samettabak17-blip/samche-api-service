import express from 'express';
import multer from 'multer';
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
  createConversationKnowledgeCandidate,
  rejectConversationKnowledgeCandidate,
} from '../services/knowledge-candidate-service.js';

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
  if (error instanceof KnowledgeSourceIngestionError || error instanceof KnowledgeSourceServiceError) {
    const status = /NOT_FOUND|INVALID|EMPTY|UNSUPPORTED|MISMATCH|REQUIRED/.test(code) ? 400 : 503;
    return res.status(status).json({ error: error.message, code });
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
    const job = await enqueueKnowledgeIndexJob({ database: pool, tenantId, sourceId: id, contentHash: source.rows[0].content_hash, metadata: { reindex: true } });
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
              status, pii_redaction_status, evidence_summary, created_at, reviewed_at
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
      `SELECT conversation_id, message_id, channel_type, sender_type, occurred_at
         FROM knowledge_candidate_evidence
        WHERE tenant_id = $1 AND candidate_id = $2
        ORDER BY occurred_at ASC`,
      [tenantId, req.params.candidateId]
    );
    return res.json({ evidence: result.rows });
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

export default router;
