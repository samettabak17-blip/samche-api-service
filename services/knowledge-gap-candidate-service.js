import { createConversationKnowledgeCandidate, KnowledgeCandidateError } from './knowledge-candidate-service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createSuggestedCandidateFromKnowledgeGap({ database, tenantId, gapId, title, content, createdBy }) {
  if (!database?.query) throw new KnowledgeCandidateError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  if (![tenantId, gapId, createdBy].every((value) => UUID.test(String(value ?? '')))) throw new KnowledgeCandidateError('KNOWLEDGE_GAP_INVALID', 'Knowledge gap request is invalid');
  const gapResult = await database.query(
    `SELECT id, assistant_id, normalized_question, suggested_candidate_id FROM knowledge_gaps WHERE id = $1 AND tenant_id = $2 AND status = 'NEEDS_REVIEW' FOR UPDATE`,
    [gapId, tenantId],
  );
  const gap = gapResult.rows[0];
  if (!gap) throw new KnowledgeCandidateError('KNOWLEDGE_GAP_NOT_FOUND', 'Knowledge gap was not found');
  if (gap.suggested_candidate_id) {
    const existing = await database.query(`SELECT id, status FROM knowledge_candidates WHERE id = $1 AND tenant_id = $2`, [gap.suggested_candidate_id, tenantId]);
    if (existing.rowCount) return { ...existing.rows[0], existing: true };
  }
  const signals = await database.query(
    `SELECT conversation_id, message_id, channel_type, created_at
       FROM knowledge_gap_signals
      WHERE tenant_id = $1
        AND assistant_id IS NOT DISTINCT FROM $2
        AND lower(regexp_replace(redacted_question, '\\s+', ' ', 'g')) = $3
      ORDER BY created_at ASC
      LIMIT 20`,
    [tenantId, gap.assistant_id, gap.normalized_question],
  );
  if (!signals.rowCount) throw new KnowledgeCandidateError('KNOWLEDGE_GAP_EVIDENCE_NOT_FOUND', 'Knowledge gap evidence was not found');
  const candidate = await createConversationKnowledgeCandidate({
    database, tenantId, assistantId: gap.assistant_id, candidateType: 'KNOWLEDGE_GAP', title, content,
    confidence: null,
    evidence: signals.rows.map((signal) => ({ conversationId: signal.conversation_id, messageId: signal.message_id, channelType: signal.channel_type, senderType: 'SYSTEM', occurredAt: signal.created_at })),
  });
  await database.query(`UPDATE knowledge_gaps SET suggested_candidate_id = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [gapId, tenantId, candidate.id]);
  return candidate;
}

