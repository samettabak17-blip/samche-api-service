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
