import { retrieveApprovedKnowledge } from './knowledge-intelligence-service.js';
import { retrieveApprovedEntities, detectEntityAmbiguity } from './knowledge-entity-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class KnowledgeRetrievalPreviewError extends Error { constructor(code, message) { super(message); this.code = code; } }

export async function previewKnowledgeRetrieval({ database, embed, tenantId, assistantId, query, limit = 6 }) {
  if (!UUID_PATTERN.test(String(tenantId ?? '')) || !UUID_PATTERN.test(String(assistantId ?? ''))) throw new KnowledgeRetrievalPreviewError('KNOWLEDGE_PREVIEW_SCOPE_INVALID', 'Retrieval preview scope is invalid');
  const normalizedQuery = String(query ?? '').trim();
  if (!normalizedQuery || normalizedQuery.length > 2000) throw new KnowledgeRetrievalPreviewError('KNOWLEDGE_PREVIEW_QUERY_INVALID', 'Retrieval preview query is invalid');
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 6, 12));
  const matches = await retrieveApprovedKnowledge({ database, embed, tenantId, assistantId, query: normalizedQuery, limit: boundedLimit });
  let entities = [];
  try {
    entities = await retrieveApprovedEntities({ database, tenantId, assistantId, query: normalizedQuery, limit: boundedLimit });
  } catch {
    entities = [];
  }
  const validEntities = entities.filter((e) => e && typeof e.name === 'string');

  const result = {
    query: normalizedQuery,
    matches: matches.map((match) => ({ chunkId: match.chunkId, sourceId: match.sourceId, sourceTitle: match.sourceTitle, excerpt: String(match.text).slice(0, 1000), similarity: match.similarity })),
  };

  if (validEntities.length > 0) {
    const ambiguity = detectEntityAmbiguity(validEntities);
    result.entities = validEntities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      entityType: entity.entity_type,
      externalCode: entity.external_code,
      description: entity.description,
      attributes: entity.attributes,
      approvedMedia: entity.approved_media || [],
      matchScore: entity.match_score,
      sourceTitle: entity.source_title,
    }));
    result.isAmbiguous = ambiguity.isAmbiguous;
    result.ambiguousCandidates = ambiguity.candidates;
  }

  return result;
}
