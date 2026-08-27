import crypto from 'node:crypto';
import { redactConversationCandidate } from './knowledge-intelligence-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNAL_TYPES = new Set(['UNANSWERED', 'FALLBACK', 'LOW_RETRIEVAL', 'HUMAN_TAKEOVER', 'AGENT_CORRECTION', 'ESCALATION', 'RECURRING_QUESTION']);

export class KnowledgeGapError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireUuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeGapError(code, 'Knowledge gap identifier is invalid');
  return String(value);
}

function normalizedQuestion(value) {
  const redacted = redactConversationCandidate(String(value ?? ''));
  const normalized = redacted.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US').slice(0, 1200);
  if (!normalized) throw new KnowledgeGapError('KNOWLEDGE_GAP_QUESTION_INVALID', 'Knowledge gap question is required');
  return normalized;
}

export function createKnowledgeGapKey({ assistantId = null, question }) {
  const scope = assistantId ? requireUuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID') : 'WORKSPACE';
  return crypto.createHash('sha256').update(`${scope}|${normalizedQuestion(question)}`).digest('hex');
}

export async function recordKnowledgeGap({ database, tenantId, assistantId = null, question, signalType }) {
  if (!database?.query) throw new KnowledgeGapError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  if (assistantId) requireUuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID');
  const normalizedSignal = String(signalType ?? '').toUpperCase();
  if (!SIGNAL_TYPES.has(normalizedSignal)) throw new KnowledgeGapError('KNOWLEDGE_GAP_SIGNAL_INVALID', 'Knowledge gap signal is invalid');
  const normalized = normalizedQuestion(question);
  const dedupeKey = createKnowledgeGapKey({ assistantId, question: normalized });
  const result = await database.query(
    `INSERT INTO knowledge_gaps (
       tenant_id, assistant_id, normalized_question, occurrence_count, status, dedupe_key, signal_type, last_detected_at
     ) VALUES ($1, $2, $3, 1, 'NEEDS_REVIEW', $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL
     DO UPDATE SET occurrence_count = knowledge_gaps.occurrence_count + 1,
                   signal_type = EXCLUDED.signal_type,
                   last_detected_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING id, status, occurrence_count`,
    [tenantId, assistantId, normalized, dedupeKey, normalizedSignal],
  );
  return result.rows[0];
}

