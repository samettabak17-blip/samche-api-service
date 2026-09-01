import crypto from 'node:crypto';
import { redactConversationCandidate } from './knowledge-intelligence-service.js';
import { KnowledgeSourceServiceError, createManualKnowledgeSource } from './knowledge-source-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_TYPES = new Set(['FAQ', 'POLICY', 'PROCEDURE', 'PRODUCT', 'SERVICE', 'PRICING', 'OBJECTION_HANDLING', 'TERMINOLOGY', 'KNOWLEDGE_GAP']);
const CHANNEL_TYPES = new Set(['WHATSAPP', 'WEB_CHAT', 'AI_GUIDE']);
const SENDER_TYPES = new Set(['CUSTOMER', 'ASSISTANT', 'AGENT', 'SYSTEM']);

export class KnowledgeCandidateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireUuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeCandidateError(code, 'Knowledge candidate identifier is invalid');
  return String(value);
}

function text(value, maxLength, code) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, maxLength);
  if (!normalized) throw new KnowledgeCandidateError(code, 'Knowledge candidate content is required');
  return normalized;
}

async function db(database, sql, params = []) {
  if (!database?.query) throw new KnowledgeCandidateError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  return database.query(sql, params);
}

async function candidateTransaction(database, work) {
  if (!database || typeof database.connect !== 'function') {
    throw new KnowledgeCandidateError('KNOWLEDGE_DATABASE_TRANSACTION_UNAVAILABLE', 'Knowledge transaction is unavailable');
  }
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

function imageCandidateFingerprint({ tenantId, assistantId, sourceId, extractionHash, segmentOrder }) {
  return crypto.createHash('sha256')
    .update([tenantId, assistantId ?? '', sourceId, extractionHash, segmentOrder].join(':'))
    .digest('hex');
}

function provenanceCandidateFingerprint(baseFingerprint) {
  return crypto.createHash('sha256').update(`${baseFingerprint}:PROVENANCE_V2`).digest('hex');
}

export async function createImageKnowledgeCandidates({
  database,
  tenantId,
  assistantId = null,
  sourceId,
  extractionHash,
  semanticClassifier = null,
  redact = redactConversationCandidate,
  candidateType = 'POLICY',
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  if (assistantId) requireUuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID');
  requireUuid(sourceId, 'KNOWLEDGE_SOURCE_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(String(extractionHash ?? ''))) throw new KnowledgeCandidateError('KNOWLEDGE_IMAGE_EXTRACTION_HASH_INVALID', 'Image extraction hash is invalid');
  const normalizedType = String(candidateType).toUpperCase();
  if (!CANDIDATE_TYPES.has(normalizedType)) throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_TYPE_INVALID', 'Knowledge candidate type is invalid');
  if (typeof semanticClassifier?.classify !== 'function') throw new KnowledgeCandidateError('KNOWLEDGE_IMAGE_SEMANTIC_CLASSIFIER_REQUIRED', 'Image semantic classification is required');

  return candidateTransaction(database, async (client) => {
    const segmentsResult = await client.query(
      `SELECT segment.id, segment.source_id, segment.extraction_version, segment.extraction_hash,
              segment.segment_order, segment.role, segment.role_confidence,
              segment.normalized_text, segment.source_locator
         FROM knowledge_source_extraction_segments segment
         JOIN knowledge_base_documents source
           ON source.id = segment.source_id AND source.tenant_id = segment.tenant_id
        WHERE segment.tenant_id = $1
          AND segment.source_id = $2
          AND segment.extraction_hash = $3
          AND segment.is_current = TRUE
          AND source.enabled = TRUE
          AND source.status = 'active'
          AND source.processing_status = 'READY'
          AND source.mime_type IN ('image/jpeg', 'image/png')
          AND source.indexing_status = 'DISABLED'
          AND ($4::uuid IS NULL OR EXISTS (
                SELECT 1 FROM knowledge_source_assistants assignment
                 WHERE assignment.tenant_id = source.tenant_id
                   AND assignment.source_id = source.id
                   AND assignment.assistant_id = $4
              ))
        ORDER BY segment.segment_order ASC`,
      [tenantId, sourceId, String(extractionHash).toLowerCase(), assistantId]);
    const segments = segmentsResult.rows ?? [];
    const classifications = await semanticClassifier.classify({ segments });
    const businessSegments = classifications
      .filter((classification) => classification.category === 'DURABLE_BUSINESS_FACT')
      .map((classification) => ({ classification, segment: segments.find((segment) => segment.id === classification.segmentId) }))
      .filter(({ segment }) => segment);
    const behaviorSegments = classifications.filter((classification) => classification.category === 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION' && classification.canonicalText);
    const assignmentResult = await client.query(
      `SELECT assistant_id FROM knowledge_source_assistants WHERE tenant_id = $1 AND source_id = $2`,
      [tenantId, sourceId],
    );
    const assignedAssistantIds = (assignmentResult.rows ?? []).map((row) => row.assistant_id);
    // Replace only legacy/unapproved raw image candidates for this exact extraction.
    // Approved knowledge remains immutable and is never silently regenerated.
    await client.query(
      `DELETE FROM knowledge_candidates candidate
        USING knowledge_candidate_image_evidence evidence
       WHERE candidate.id = evidence.candidate_id
         AND candidate.tenant_id = evidence.tenant_id
         AND candidate.tenant_id = $1
         AND evidence.source_id = $2
         AND evidence.extraction_hash = $3
         AND evidence.evidence_kind = 'PRIMARY'
         AND candidate.status IN ('DRAFT', 'NEEDS_REVIEW')
         AND candidate.image_semantic_version IS DISTINCT FROM '1'`,
      [tenantId, sourceId, String(extractionHash).toLowerCase()],
    );
    const results = [];
    const behaviorRecommendations = [];

    for (const { classification, segment: business } of businessSegments) {
      const baseFingerprint = imageCandidateFingerprint({ tenantId, assistantId, sourceId, extractionHash: business.extraction_hash, segmentOrder: business.segment_order });
      const strongerProvenanceFingerprint = provenanceCandidateFingerprint(baseFingerprint);
      const existing = await client.query(
        `SELECT candidate.id, candidate.status, candidate.candidate_fingerprint,
                EXISTS (SELECT 1 FROM knowledge_candidate_image_evidence evidence
                          WHERE evidence.tenant_id = candidate.tenant_id AND evidence.candidate_id = candidate.id) AS has_provenance
           FROM knowledge_candidates candidate
          WHERE tenant_id = $1
            AND (candidate_fingerprint IN ($2, $3)
              OR (status = 'APPROVED'
                  AND proposed_title = 'Canonical image-derived business fact'
                  AND proposed_content = $4))`,
        [tenantId, baseFingerprint, strongerProvenanceFingerprint, classification.canonicalText]);
      const provenanceExisting = (existing.rows ?? []).find((row) => row.candidate_fingerprint === strongerProvenanceFingerprint);
      const baseExisting = (existing.rows ?? []).find((row) => row.candidate_fingerprint === baseFingerprint) ?? (existing.rows ?? [])[0];
      if (provenanceExisting || (baseExisting && !(baseExisting.status === 'APPROVED' && baseExisting.has_provenance === false))) {
        results.push({ ...(provenanceExisting ?? baseExisting), reused: true });
        continue;
      }

      // An evidence-less approved legacy candidate is immutable, but must not
      // prevent a provenance-complete regeneration from being reviewable.
      const fingerprint = baseExisting?.status === 'APPROVED' && baseExisting.has_provenance === false
        ? strongerProvenanceFingerprint
        : baseFingerprint;

      const proposedContent = String(redact(text(classification.canonicalText, 12000, 'KNOWLEDGE_CANDIDATE_CONTENT_INVALID')) ?? '').trim();
      if (!proposedContent) throw new KnowledgeCandidateError('KNOWLEDGE_IMAGE_REDACTION_EMPTY', 'Redacted image candidate content is empty');
      const insert = await client.query(
        `INSERT INTO knowledge_candidates (
           id, tenant_id, assistant_id, candidate_type, proposed_title, proposed_content,
           candidate_fingerprint, confidence, status, pii_redaction_status, evidence_summary, image_semantic_version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEEDS_REVIEW', $9, $10, '1')
         ON CONFLICT (tenant_id, candidate_fingerprint) WHERE candidate_fingerprint IS NOT NULL DO NOTHING
         RETURNING id, status, pii_redaction_status, candidate_fingerprint`,
        [crypto.randomUUID(), tenantId, assistantId, normalizedType, 'Canonical image-derived business fact', proposedContent,
          fingerprint, Number(classification.confidence), proposedContent === String(classification.canonicalText).trim() ? 'PASSED' : 'REDACTED',
          'Image segment provenance is retained in tenant-scoped evidence.']);
      if (!insert.rows?.[0]) {
        const reused = await client.query(
          `SELECT id, status, candidate_fingerprint FROM knowledge_candidates WHERE tenant_id = $1 AND candidate_fingerprint = $2`,
          [tenantId, fingerprint]);
        if (reused.rows?.[0]) {
          results.push({ ...reused.rows[0], reused: true });
          continue;
        }
        throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_CREATE_FAILED', 'Image candidate could not be created');
      }
      const candidate = insert.rows[0];
      const related = segments.filter((segment) => segment.id === business.id ||
        (segment.role === 'CUSTOMER' && Math.abs(Number(segment.segment_order) - Number(business.segment_order)) === 1));
      for (const segment of related) {
        const evidenceText = String(redact(text(segment.normalized_text, 12000, 'KNOWLEDGE_CANDIDATE_CONTENT_INVALID')) ?? '').trim();
        if (!evidenceText) throw new KnowledgeCandidateError('KNOWLEDGE_IMAGE_REDACTION_EMPTY', 'Redacted image evidence is empty');
        await client.query(
          `INSERT INTO knowledge_candidate_image_evidence (
             tenant_id, candidate_id, source_id, segment_id, extraction_version, extraction_hash,
             segment_order, role, role_confidence, normalized_text, evidence_kind, source_locator, semantic_category, canonical_text
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)`,
          [tenantId, candidate.id, sourceId, segment.id, segment.extraction_version, segment.extraction_hash,
            segment.segment_order, segment.role, Number(segment.role_confidence), evidenceText,
            segment.id === business.id ? 'PRIMARY' : 'SUPPORTING_CONTEXT',
            segment.source_locator === null || segment.source_locator === undefined ? null : JSON.stringify(segment.source_locator),
            segment.id === business.id ? classification.category : null,
            segment.id === business.id ? proposedContent : null]);
      }
      results.push({ ...candidate, reused: false });
    }
    for (const behavior of behaviorSegments) {
      for (const assignedAssistantId of assignedAssistantIds) {
        const guidance = String(redact(text(behavior.canonicalText, 12000, 'KNOWLEDGE_CANDIDATE_CONTENT_INVALID')) ?? '').trim();
        if (!guidance) throw new KnowledgeCandidateError('KNOWLEDGE_IMAGE_REDACTION_EMPTY', 'Redacted image behavior recommendation is empty');
        const fingerprint = imageCandidateFingerprint({ tenantId, assistantId: assignedAssistantId, sourceId, extractionHash, segmentOrder: behavior.segmentOrder });
        const recommendation = await client.query(
          `INSERT INTO assistant_knowledge_recommendations (
             id, tenant_id, assistant_id, recommendation_data, evidence, status, semantic_fingerprint, schema_version
           ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'NEEDS_REVIEW', $6, 2)
           ON CONFLICT (tenant_id, semantic_fingerprint) WHERE semantic_fingerprint IS NOT NULL DO NOTHING
           RETURNING id, status`,
          [crypto.randomUUID(), tenantId, assignedAssistantId,
            JSON.stringify({ schema_version: 2, qualification_guidance: [guidance] }),
            JSON.stringify([{ source_id: sourceId, extraction_hash: extractionHash, segment_id: behavior.segmentId, semantic_category: behavior.category }]), fingerprint],
        );
        if (recommendation.rows?.[0]) behaviorRecommendations.push({ ...recommendation.rows[0], assistant_id: assignedAssistantId, reused: false });
      }
    }
    Object.defineProperties(results, {
      candidates: { value: results, enumerable: false },
      behavior_recommendations: { value: behaviorRecommendations, enumerable: false },
      warnings: { value: behaviorSegments.length && !assignedAssistantIds.length
        ? ['Assign this source to an assistant to generate behavior recommendations.'] : [], enumerable: false },
    });
    return results;
  });
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence) || !evidence.length || evidence.length > 20) {
    throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_EVIDENCE_INVALID', 'Knowledge candidate evidence is required');
  }
  return evidence.map((item) => {
    const channelType = String(item?.channelType ?? '').toUpperCase();
    const senderType = String(item?.senderType ?? '').toUpperCase();
    if (!CHANNEL_TYPES.has(channelType) || !SENDER_TYPES.has(senderType)) {
      throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_EVIDENCE_INVALID', 'Knowledge candidate evidence is invalid');
    }
    const occurredAt = new Date(item.occurredAt);
    if (Number.isNaN(occurredAt.valueOf())) throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_EVIDENCE_INVALID', 'Knowledge candidate evidence is invalid');
    return {
      conversationId: requireUuid(item.conversationId, 'KNOWLEDGE_CANDIDATE_EVIDENCE_INVALID'),
      messageId: requireUuid(item.messageId, 'KNOWLEDGE_CANDIDATE_EVIDENCE_INVALID'),
      channelType,
      senderType,
      occurredAt: occurredAt.toISOString(),
    };
  });
}

export async function createConversationKnowledgeCandidate({
  database,
  tenantId,
  assistantId = null,
  candidateType,
  title,
  content,
  confidence = null,
  evidence,
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  if (assistantId) requireUuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID');
  const normalizedType = String(candidateType ?? '').toUpperCase();
  if (!CANDIDATE_TYPES.has(normalizedType)) throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_TYPE_INVALID', 'Knowledge candidate type is invalid');
  const proposedContent = redactConversationCandidate(text(content, 12000, 'KNOWLEDGE_CANDIDATE_CONTENT_INVALID'));
  const piiRedactionStatus = proposedContent === String(content).trim() ? 'PASSED' : 'REDACTED';
  const normalizedEvidence = normalizeEvidence(evidence);
  const candidateId = crypto.randomUUID();

  if (confidence !== null && (!Number.isFinite(Number(confidence)) || Number(confidence) < 0 || Number(confidence) > 1)) {
    throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_CONFIDENCE_INVALID', 'Knowledge candidate confidence is invalid');
  }

  const result = await db(database,
    `INSERT INTO knowledge_candidates (
       id, tenant_id, assistant_id, candidate_type, proposed_title, proposed_content,
       confidence, status, pii_redaction_status, evidence_summary
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'NEEDS_REVIEW', $8, $9)
     RETURNING id, status, pii_redaction_status`,
    [
      candidateId,
      tenantId,
      assistantId,
      normalizedType,
      text(title, 255, 'KNOWLEDGE_CANDIDATE_TITLE_INVALID'),
      proposedContent,
      confidence === null ? null : Number(confidence),
      piiRedactionStatus,
      'Evidence is retained as tenant-scoped message references only.',
    ]);

  for (const item of normalizedEvidence) {
    const verified = await db(database,
      `SELECT 1
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
        WHERE m.id = $1 AND m.conversation_id = $2 AND m.tenant_id = $3`,
      [item.messageId, item.conversationId, tenantId]);
    if (!verified.rowCount) throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_EVIDENCE_NOT_FOUND', 'Knowledge candidate evidence was not found');

    await db(database,
      `INSERT INTO knowledge_candidate_evidence (
         tenant_id, candidate_id, conversation_id, message_id, channel_type, sender_type, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, candidateId, item.conversationId, item.messageId, item.channelType, item.senderType, item.occurredAt]);
  }

  return result.rows[0];
}

export async function approveConversationKnowledgeCandidate({
  database,
  tenantId,
  candidateId,
  reviewedBy,
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(candidateId, 'KNOWLEDGE_CANDIDATE_INVALID');
  requireUuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID');

  const candidateResult = await db(database,
    `SELECT id, assistant_id, proposed_title, proposed_content, status, pii_redaction_status
       FROM knowledge_candidates
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE`,
    [candidateId, tenantId]);
  const candidate = candidateResult.rows[0];
  if (!candidate) throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_NOT_FOUND', 'Knowledge candidate was not found');
  if (!['NEEDS_REVIEW', 'DRAFT'].includes(candidate.status) || candidate.pii_redaction_status === 'REJECTED') {
    throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_NOT_APPROVABLE', 'Knowledge candidate cannot be approved');
  }

  const source = await createManualKnowledgeSource({
    database,
    tenantId,
    uploadedBy: reviewedBy,
    title: candidate.proposed_title,
    content: candidate.proposed_content,
    assistantIds: candidate.assistant_id ? [candidate.assistant_id] : [],
    sourceType: 'CONVERSATION_CANDIDATE',
  });

  // A materialized canonical fact inherits identity only through its own
  // image-evidence source chain. Tenant membership alone is never authority.
  await db(database,
    `INSERT INTO knowledge_materialized_source_provenance
       (tenant_id, materialized_source_id, candidate_id, original_source_id)
       SELECT DISTINCT $1, $3, evidence.candidate_id, evidence.source_id
         FROM knowledge_candidate_image_evidence evidence
        WHERE evidence.tenant_id = $1 AND evidence.candidate_id = $2
       ON CONFLICT DO NOTHING`,
    [tenantId, candidateId, source.id],
  );

  await db(database,
    `INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
       SELECT DISTINCT $1, $3, identity_link.business_identity_id
         FROM knowledge_candidate_image_evidence evidence
         JOIN knowledge_source_business_identities identity_link
           ON identity_link.tenant_id = evidence.tenant_id
          AND identity_link.source_id = evidence.source_id
        WHERE evidence.tenant_id = $1 AND evidence.candidate_id = $2
       ON CONFLICT DO NOTHING`,
    [tenantId, candidateId, source.id],
  );

  await db(database,
    `UPDATE knowledge_candidates
        SET status = 'APPROVED',
            reviewed_by = $3,
            reviewed_at = CURRENT_TIMESTAMP,
            approved_source_id = $4,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2`,
    [candidateId, tenantId, reviewedBy, source.id]);
  return source;
}

export async function rejectConversationKnowledgeCandidate({ database, tenantId, candidateId, reviewedBy }) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(candidateId, 'KNOWLEDGE_CANDIDATE_INVALID');
  requireUuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID');
  const result = await db(database,
    `UPDATE knowledge_candidates
        SET status = 'REJECTED', reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status IN ('DRAFT', 'NEEDS_REVIEW')
      RETURNING id`,
    [candidateId, tenantId, reviewedBy]);
  if (!result.rowCount) throw new KnowledgeCandidateError('KNOWLEDGE_CANDIDATE_NOT_FOUND', 'Knowledge candidate was not found');
}
