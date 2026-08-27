import { redactConversationCandidate } from './knowledge-intelligence-service.js';
import { recordKnowledgeGap, KnowledgeGapError } from './knowledge-gap-service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(['WHATSAPP', 'WEB_CHAT', 'AI_GUIDE']);
const ATTRIBUTED = new Set(['MISSING_KNOWLEDGE_CONFIRMED', 'AGENT_CORRECTION_CONFIRMED', 'REPEATED_UNANSWERED_CONFIRMED']);

export async function recordVerifiedKnowledgeGapSignal({ database, tenantId, assistantId = null, conversationId, messageId, channelType, signalType, question }) {
  if (!database?.query) throw new KnowledgeGapError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  for (const [value, code] of [[tenantId, 'KNOWLEDGE_TENANT_INVALID'], [conversationId, 'KNOWLEDGE_CONVERSATION_INVALID'], [messageId, 'KNOWLEDGE_MESSAGE_INVALID']]) {
    if (!UUID.test(String(value ?? ''))) throw new KnowledgeGapError(code, 'Knowledge gap provenance is invalid');
  }
  if (assistantId && !UUID.test(String(assistantId))) throw new KnowledgeGapError('KNOWLEDGE_ASSISTANT_INVALID', 'Knowledge gap assistant is invalid');
  const channel = String(channelType ?? '').toUpperCase();
  if (!CHANNELS.has(channel)) throw new KnowledgeGapError('KNOWLEDGE_GAP_CHANNEL_INVALID', 'Knowledge gap channel is invalid');
  const type = String(signalType ?? '').toUpperCase();
  if (!ATTRIBUTED.has(type)) throw new KnowledgeGapError('KNOWLEDGE_GAP_SIGNAL_NOT_ATTRIBUTED', 'Knowledge gap signal is not attributable to missing knowledge');
  const redactedQuestion = redactConversationCandidate(String(question ?? '')).replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!redactedQuestion) throw new KnowledgeGapError('KNOWLEDGE_GAP_QUESTION_INVALID', 'Knowledge gap question is required');

  await database.query(
    `INSERT INTO knowledge_gap_signals (tenant_id, assistant_id, conversation_id, message_id, channel_type, redacted_question, signal_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, conversation_id, message_id, signal_type) DO NOTHING`,
    [tenantId, assistantId, conversationId, messageId, channel, redactedQuestion, type],
  );
  return recordKnowledgeGap({
    database, tenantId, assistantId, question: redactedQuestion,
    signalType: type === 'AGENT_CORRECTION_CONFIRMED' ? 'AGENT_CORRECTION' : type === 'REPEATED_UNANSWERED_CONFIRMED' ? 'RECURRING_QUESTION' : 'UNANSWERED',
  });
}

