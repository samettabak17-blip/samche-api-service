import { retrieveApprovedKnowledge } from './knowledge-intelligence-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class KnowledgeRetrievalPreviewError extends Error { constructor(code, message) { super(message); this.code = code; } }

export async function previewKnowledgeRetrieval({ database, embed, tenantId, assistantId, query, limit = 6 }) {
  if (!UUID_PATTERN.test(String(tenantId ?? '')) || !UUID_PATTERN.test(String(assistantId ?? ''))) throw new KnowledgeRetrievalPreviewError('KNOWLEDGE_PREVIEW_SCOPE_INVALID', 'Retrieval preview scope is invalid');
  const normalizedQuery = String(query ?? '').trim();
  if (!normalizedQuery || normalizedQuery.length > 2000) throw new KnowledgeRetrievalPreviewError('KNOWLEDGE_PREVIEW_QUERY_INVALID', 'Retrieval preview query is invalid');
  const matches = await retrieveApprovedKnowledge({ database, embed, tenantId, assistantId, query: normalizedQuery, limit: Math.max(1, Math.min(Number(limit) || 6, 12)) });
  return {
    query: normalizedQuery,
    matches: matches.map((match) => ({ chunkId: match.chunkId, sourceId: match.sourceId, sourceTitle: match.sourceTitle, excerpt: String(match.text).slice(0, 1000), similarity: match.similarity })),
  };
}
