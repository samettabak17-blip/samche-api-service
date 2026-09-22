import crypto from 'node:crypto';
import { validateImageKnowledgeInput } from './image-knowledge-extraction.js';
import { buildKnowledgeStorageKey, hashKnowledgeSource } from './knowledge-source-ingestion-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KnowledgeEntityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'KnowledgeEntityError';
    this.code = code;
  }
}

function requireUuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) {
    throw new KnowledgeEntityError(code, 'Identifier is invalid');
  }
  return String(value);
}

function normalizeString(value, maxLength = 255) {
  if (value === null || value === undefined) return null;
  const str = String(value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, maxLength);
  return str || null;
}

function boundedConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) return 1.0;
  return num;
}

export async function listKnowledgeEntities({
  database,
  tenantId,
  sourceId = null,
  approvalStatus = null,
  isRuntimeEligible = null,
  entityType = null,
  limit = 100,
  offset = 0,
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  if (sourceId) requireUuid(sourceId, 'KNOWLEDGE_SOURCE_INVALID');

  const conditions = ['e.tenant_id = $1'];
  const params = [tenantId];

  if (sourceId) {
    params.push(sourceId);
    conditions.push(`e.source_id = $${params.length}`);
  }
  if (approvalStatus) {
    params.push(String(approvalStatus).toUpperCase());
    conditions.push(`e.approval_status = $${params.length}`);
  }
  if (isRuntimeEligible !== null && isRuntimeEligible !== undefined) {
    params.push(Boolean(isRuntimeEligible));
    conditions.push(`e.is_runtime_eligible = $${params.length}`);
  }
  if (entityType) {
    params.push(String(entityType).toUpperCase());
    conditions.push(`e.entity_type = $${params.length}`);
  }

  params.push(Math.max(1, Math.min(Number(limit) || 100, 200)));
  params.push(Math.max(0, Number(offset) || 0));

  const result = await database.query(
    `SELECT e.id, e.tenant_id, e.source_id, e.business_identity_id, e.candidate_id,
            e.entity_type, e.name, e.external_code, e.description, e.attributes,
            e.textual_evidence, e.confidence, e.approval_status, e.is_runtime_eligible,
            e.provenance, e.reviewed_by, e.reviewed_at, e.created_at, e.updated_at,
            s.title AS source_title,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', m.id,
                'media_type', m.media_type,
                'mime_type', m.mime_type,
                'storage_key', m.storage_key,
                'original_filename', m.original_filename,
                'file_size_bytes', m.file_size_bytes,
                'content_hash', m.content_hash,
                'media_role', m.media_role,
                'page_number', m.page_number,
                'bounding_box', m.bounding_box,
                'approval_status', m.approval_status,
                'is_runtime_eligible', m.is_runtime_eligible,
                'confidence', m.confidence,
                'provenance', m.provenance,
                'created_at', m.created_at
              ) ORDER BY m.created_at ASC)
              FROM knowledge_entity_media m
              WHERE m.entity_id = e.id AND m.tenant_id = e.tenant_id
            ), '[]'::json) AS media
       FROM knowledge_entities e
       LEFT JOIN knowledge_base_documents s ON s.id = e.source_id AND s.tenant_id = e.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows;
}

export async function getKnowledgeEntity({ database, tenantId, entityId }) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(entityId, 'KNOWLEDGE_ENTITY_INVALID');

  const result = await database.query(
    `SELECT e.id, e.tenant_id, e.source_id, e.business_identity_id, e.candidate_id,
            e.entity_type, e.name, e.external_code, e.description, e.attributes,
            e.textual_evidence, e.confidence, e.approval_status, e.is_runtime_eligible,
            e.provenance, e.reviewed_by, e.reviewed_at, e.created_at, e.updated_at,
            s.title AS source_title,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', m.id,
                'media_type', m.media_type,
                'mime_type', m.mime_type,
                'storage_key', m.storage_key,
                'original_filename', m.original_filename,
                'file_size_bytes', m.file_size_bytes,
                'content_hash', m.content_hash,
                'media_role', m.media_role,
                'page_number', m.page_number,
                'bounding_box', m.bounding_box,
                'approval_status', m.approval_status,
                'is_runtime_eligible', m.is_runtime_eligible,
                'confidence', m.confidence,
                'provenance', m.provenance,
                'created_at', m.created_at
              ) ORDER BY m.created_at ASC)
              FROM knowledge_entity_media m
              WHERE m.entity_id = e.id AND m.tenant_id = e.tenant_id
            ), '[]'::json) AS media
       FROM knowledge_entities e
       LEFT JOIN knowledge_base_documents s ON s.id = e.source_id AND s.tenant_id = e.tenant_id
      WHERE e.id = $1 AND e.tenant_id = $2`,
    [entityId, tenantId]
  );

  if (!result.rowCount) {
    throw new KnowledgeEntityError('KNOWLEDGE_ENTITY_NOT_FOUND', 'Knowledge entity was not found');
  }

  return result.rows[0];
}

export async function createKnowledgeEntity({
  database,
  tenantId,
  sourceId = null,
  businessIdentityId = null,
  candidateId = null,
  entityType = 'GENERIC',
  name,
  externalCode = null,
  description = null,
  attributes = {},
  textualEvidence = null,
  confidence = 1.0,
  approvalStatus = 'PENDING',
  isRuntimeEligible = false,
  provenance = {},
  reviewedBy = null,
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  if (sourceId) requireUuid(sourceId, 'KNOWLEDGE_SOURCE_INVALID');
  if (businessIdentityId) requireUuid(businessIdentityId, 'KNOWLEDGE_BUSINESS_IDENTITY_INVALID');
  if (candidateId) requireUuid(candidateId, 'KNOWLEDGE_CANDIDATE_INVALID');
  if (reviewedBy) requireUuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID');

  const normalizedName = normalizeString(name, 255);
  if (!normalizedName) {
    throw new KnowledgeEntityError('KNOWLEDGE_ENTITY_NAME_REQUIRED', 'Entity name is required');
  }

  const normalizedType = normalizeString(entityType, 64)?.toUpperCase() || 'GENERIC';
  const normalizedCode = normalizeString(externalCode, 128);
  const normalizedDesc = typeof description === 'string' ? description.trim() : null;
  const normalizedAttr = attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {};
  const validStatus = ['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'].includes(String(approvalStatus).toUpperCase())
    ? String(approvalStatus).toUpperCase()
    : 'PENDING';
  const runtimeEligible = validStatus === 'APPROVED' ? Boolean(isRuntimeEligible) : false;

  const result = await database.query(
    `INSERT INTO knowledge_entities (
       tenant_id, source_id, business_identity_id, candidate_id, entity_type,
       name, external_code, description, attributes, textual_evidence,
       confidence, approval_status, is_runtime_eligible, provenance,
       reviewed_by, reviewed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::jsonb, $15, CASE WHEN $15::uuid IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END)
     RETURNING *`,
    [
      tenantId,
      sourceId,
      businessIdentityId,
      candidateId,
      normalizedType,
      normalizedName,
      normalizedCode,
      normalizedDesc,
      JSON.stringify(normalizedAttr),
      textualEvidence,
      boundedConfidence(confidence),
      validStatus,
      runtimeEligible,
      JSON.stringify(provenance || {}),
      reviewedBy,
    ]
  );

  return result.rows[0];
}

export async function updateKnowledgeEntity({
  database,
  tenantId,
  entityId,
  name,
  entityType,
  externalCode,
  description,
  attributes,
  textualEvidence,
  confidence,
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(entityId, 'KNOWLEDGE_ENTITY_INVALID');

  const existing = await getKnowledgeEntity({ database, tenantId, entityId });

  const updatedName = name !== undefined ? normalizeString(name, 255) : existing.name;
  if (!updatedName) {
    throw new KnowledgeEntityError('KNOWLEDGE_ENTITY_NAME_REQUIRED', 'Entity name is required');
  }

  const updatedType = entityType !== undefined ? normalizeString(entityType, 64)?.toUpperCase() || 'GENERIC' : existing.entity_type;
  const updatedCode = externalCode !== undefined ? normalizeString(externalCode, 128) : existing.external_code;
  const updatedDesc = description !== undefined ? (typeof description === 'string' ? description.trim() : null) : existing.description;
  const updatedAttr = attributes !== undefined ? (attributes && typeof attributes === 'object' ? attributes : {}) : existing.attributes;
  const updatedEvidence = textualEvidence !== undefined ? textualEvidence : existing.textual_evidence;
  const updatedConfidence = confidence !== undefined ? boundedConfidence(confidence) : existing.confidence;

  const result = await database.query(
    `UPDATE knowledge_entities
        SET name = $3,
            entity_type = $4,
            external_code = $5,
            description = $6,
            attributes = $7::jsonb,
            textual_evidence = $8,
            confidence = $9,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [
      entityId,
      tenantId,
      updatedName,
      updatedType,
      updatedCode,
      updatedDesc,
      JSON.stringify(updatedAttr),
      updatedEvidence,
      updatedConfidence,
    ]
  );

  return result.rows[0];
}

export async function approveKnowledgeEntity({ database, tenantId, entityId, reviewedBy = null }) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(entityId, 'KNOWLEDGE_ENTITY_INVALID');
  if (reviewedBy) requireUuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID');

  const result = await database.query(
    `UPDATE knowledge_entities
        SET approval_status = 'APPROVED',
            is_runtime_eligible = TRUE,
            reviewed_by = $3,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [entityId, tenantId, reviewedBy ?? null]
  );

  if (!result.rowCount) {
    throw new KnowledgeEntityError('KNOWLEDGE_ENTITY_NOT_FOUND', 'Knowledge entity was not found');
  }

  await database.query(
    `UPDATE knowledge_entity_media
        SET approval_status = 'APPROVED',
            is_runtime_eligible = TRUE,
            updated_at = CURRENT_TIMESTAMP
      WHERE entity_id = $1 AND tenant_id = $2 AND approval_status <> 'REJECTED'`,
    [entityId, tenantId]
  );

  return getKnowledgeEntity({ database, tenantId, entityId });
}

export async function rejectKnowledgeEntity({ database, tenantId, entityId, reviewedBy = null }) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(entityId, 'KNOWLEDGE_ENTITY_INVALID');
  if (reviewedBy) requireUuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID');

  const result = await database.query(
    `UPDATE knowledge_entities
        SET approval_status = 'REJECTED',
            is_runtime_eligible = FALSE,
            reviewed_by = $3,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [entityId, tenantId, reviewedBy ?? null]
  );

  if (!result.rowCount) {
    throw new KnowledgeEntityError('KNOWLEDGE_ENTITY_NOT_FOUND', 'Knowledge entity was not found');
  }

  await database.query(
    `UPDATE knowledge_entity_media
        SET approval_status = 'REJECTED',
            is_runtime_eligible = FALSE,
            updated_at = CURRENT_TIMESTAMP
      WHERE entity_id = $1 AND tenant_id = $2`,
    [entityId, tenantId]
  );

  return getKnowledgeEntity({ database, tenantId, entityId });
}


export async function addEntityMedia({
  database,
  storage,
  tenantId,
  entityId,
  sourceId = null,
  file,
  mediaRole = 'PRIMARY_REFERENCE',
  pageNumber = null,
  boundingBox = null,
  confidence = 1.0,
  approvalStatus = 'PENDING',
  isRuntimeEligible = false,
  provenance = {},
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(entityId, 'KNOWLEDGE_ENTITY_INVALID');
  if (sourceId) requireUuid(sourceId, 'KNOWLEDGE_SOURCE_INVALID');

  const validated = validateImageKnowledgeInput(file);
  const mediaId = crypto.randomUUID();
  const contentHash = hashKnowledgeSource(validated.buffer);
  const storageKey = buildKnowledgeStorageKey({
    tenantId,
    sourceId: sourceId || entityId,
    contentHash,
    extension: validated.extension,
  });

  if (storage && typeof storage.put === 'function') {
    await storage.put({ key: storageKey, body: validated.buffer, mimeType: validated.mimeType });
  }

  const role = ['PRIMARY_REFERENCE', 'SECONDARY_REFERENCE', 'SWATCH', 'CONTEXT_VIEW', 'CANDIDATE_GRAPHIC', 'UNCERTAIN_ASSOCIATION'].includes(mediaRole)
    ? mediaRole
    : 'PRIMARY_REFERENCE';

  const validStatus = ['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'].includes(approvalStatus) ? approvalStatus : 'PENDING';
  const runtimeEligible = validStatus === 'APPROVED' ? Boolean(isRuntimeEligible) : false;

  const result = await database.query(
    `INSERT INTO knowledge_entity_media (
       id, tenant_id, entity_id, source_id, media_type, mime_type, storage_key,
       original_filename, file_size_bytes, content_hash, media_role, page_number,
       bounding_box, approval_status, is_runtime_eligible, confidence, provenance
     ) VALUES ($1, $2, $3, $4, 'IMAGE', $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16::jsonb)
     RETURNING *`,
    [
      mediaId,
      tenantId,
      entityId,
      sourceId,
      validated.mimeType,
      storageKey,
      normalizeString(file?.originalname, 255) || `media.${validated.extension}`,
      validated.sizeBytes,
      contentHash,
      role,
      Number.isInteger(pageNumber) ? pageNumber : null,
      boundingBox ? JSON.stringify(boundingBox) : null,
      validStatus,
      runtimeEligible,
      boundedConfidence(confidence),
      JSON.stringify(provenance || {}),
    ]
  );

  return result.rows[0];
}

export async function getEntityMedia({ database, tenantId, mediaId }) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(mediaId, 'KNOWLEDGE_MEDIA_INVALID');

  const result = await database.query(
    `SELECT id, tenant_id, entity_id, source_id, media_type, mime_type, storage_key,
            original_filename, file_size_bytes, content_hash, media_role, page_number,
            bounding_box, approval_status, is_runtime_eligible, confidence, provenance,
            created_at, updated_at
       FROM knowledge_entity_media
      WHERE id = $1 AND tenant_id = $2`,
    [mediaId, tenantId]
  );

  if (!result.rowCount) {
    throw new KnowledgeEntityError('KNOWLEDGE_MEDIA_NOT_FOUND', 'Entity media was not found');
  }

  return result.rows[0];
}

export async function approveEntityMedia({ database, tenantId, mediaId }) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(mediaId, 'KNOWLEDGE_MEDIA_INVALID');

  const result = await database.query(
    `UPDATE knowledge_entity_media
        SET approval_status = 'APPROVED',
            is_runtime_eligible = TRUE,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [mediaId, tenantId]
  );

  if (!result.rowCount) {
    throw new KnowledgeEntityError('KNOWLEDGE_MEDIA_NOT_FOUND', 'Entity media was not found');
  }

  return result.rows[0];
}

export async function rejectEntityMedia({ database, tenantId, mediaId }) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(mediaId, 'KNOWLEDGE_MEDIA_INVALID');

  const result = await database.query(
    `UPDATE knowledge_entity_media
        SET approval_status = 'REJECTED',
            is_runtime_eligible = FALSE,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [mediaId, tenantId]
  );

  if (!result.rowCount) {
    throw new KnowledgeEntityError('KNOWLEDGE_MEDIA_NOT_FOUND', 'Entity media was not found');
  }

  return result.rows[0];
}

export async function retrieveApprovedEntities({
  database,
  tenantId,
  assistantId = null,
  query,
  limit = 5,
}) {
  if (!database?.query || !tenantId || !query) return [];
  const normalizedQuery = String(query).replace(/[\u0000-\u001f]/g, ' ').trim().toLowerCase();
  if (!normalizedQuery) return [];

  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5, 10));

  const result = await database.query(
    `SELECT e.id, e.tenant_id, e.source_id, e.entity_type, e.name, e.external_code,
            e.description, e.attributes, e.textual_evidence, e.confidence,
            e.approval_status, e.is_runtime_eligible, e.provenance,
            s.title AS source_title,
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', m.id,
                'media_type', m.media_type,
                'mime_type', m.mime_type,
                'storage_key', m.storage_key,
                'original_filename', m.original_filename,
                'media_role', m.media_role,
                'page_number', m.page_number,
                'confidence', m.confidence
              ) ORDER BY (CASE WHEN m.media_role = 'PRIMARY_REFERENCE' THEN 0 ELSE 1 END), m.created_at ASC)
              FROM knowledge_entity_media m
              WHERE m.entity_id = e.id
                AND m.tenant_id = e.tenant_id
                AND m.approval_status = 'APPROVED'
                AND m.is_runtime_eligible = TRUE
            ), '[]'::json) AS approved_media,
            CASE
              WHEN lower(e.external_code) = $2 THEN 1.0
              WHEN lower(e.name) = $2 THEN 0.98
              WHEN lower(e.name) LIKE '%' || $2 || '%' THEN 0.85
              WHEN $2 LIKE '%' || lower(e.name) || '%' THEN 0.80
              WHEN lower(e.description) LIKE '%' || $2 || '%' THEN 0.60
              ELSE 0.40
            END AS match_score
       FROM knowledge_entities e
       JOIN knowledge_base_documents s
         ON s.id = e.source_id AND s.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1
        AND e.approval_status = 'APPROVED'
        AND e.is_runtime_eligible = TRUE
        AND s.enabled = TRUE
        AND s.status = 'active'
        AND s.processing_status = 'READY'
        AND (
          $3::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM knowledge_source_assistants ksa
             WHERE ksa.tenant_id = e.tenant_id
               AND ksa.source_id = e.source_id
               AND ksa.assistant_id = $3
          )
        )
        AND (
          lower(e.name) LIKE '%' || $2 || '%'
          OR (e.external_code IS NOT NULL AND lower(e.external_code) LIKE '%' || $2 || '%')
          OR (e.description IS NOT NULL AND lower(e.description) LIKE '%' || $2 || '%')
          OR $2 LIKE '%' || lower(e.name) || '%'
          OR EXISTS (
            SELECT 1 FROM jsonb_each_text(e.attributes) kv
             WHERE lower(kv.value) LIKE '%' || $2 || '%'
          )
        )
      ORDER BY match_score DESC, e.created_at DESC
      LIMIT $4`,
    [tenantId, normalizedQuery, assistantId, boundedLimit]
  );

  return result.rows;
}

export function detectEntityAmbiguity(matchedEntities = []) {
  if (!Array.isArray(matchedEntities) || matchedEntities.length < 2) {
    return { isAmbiguous: false, candidates: matchedEntities };
  }

  const topScore = Number(matchedEntities[0]?.match_score || 0);
  const secondScore = Number(matchedEntities[1]?.match_score || 0);

  if (Math.abs(topScore - secondScore) <= 0.10 && topScore >= 0.70) {
    return {
      isAmbiguous: true,
      candidates: matchedEntities.slice(0, 3).map((e) => ({
        id: e.id,
        name: e.name,
        externalCode: e.external_code,
        description: e.description,
        attributes: e.attributes,
      })),
    };
  }

  return { isAmbiguous: false, candidates: matchedEntities };
}


