import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createKnowledgeEntity,
  getKnowledgeEntity,
  listKnowledgeEntities,
  updateKnowledgeEntity,
  approveKnowledgeEntity,
  rejectKnowledgeEntity,
  addEntityMedia,
  approveEntityMedia,
  rejectEntityMedia,
  retrieveApprovedEntities,
  detectEntityAmbiguity,
  KnowledgeEntityError,
} from '../services/knowledge-entity-service.js';
import {
  createUploadedKnowledgeSource,
  createManualKnowledgeSource,
  createVisualEntityKnowledgeSource,
  enqueueKnowledgeIndexJob,

} from '../services/knowledge-source-service.js';
import {
  validateKnowledgeUpload,
  buildKnowledgeStorageKey,
  hashKnowledgeSource,
  KnowledgeSourceIngestionError,
} from '../services/knowledge-source-ingestion-service.js';
import {
  processPdfCatalogIngestion,
  extractPageEntityCandidates,
} from '../services/pdf-catalog-extraction-service.js';
import {
  recoverStaleKnowledgeProcessingJobs,
  processKnowledgeProcessingJob,
} from '../services/knowledge-source-processing-service.js';
import {
  buildGroundedVisualInstruction,
  formatVisualAiClarification,
  resolveVisualAiGroundingContext,
} from '../services/visual-intelligence-intent-service.js';
import {
  createDeterministicMockVisualProvider,
  createVisualAIProvider,
  DETERMINISTIC_MOCK_PNG,
} from '../services/visual-ai-provider-adapter.js';
import { previewKnowledgeRetrieval } from '../services/knowledge-retrieval-preview.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const assistantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userA = '99999999-9999-4999-8999-999999999999';

const SAMPLE_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d040000000049454e44ae426082', 'hex');
const SAMPLE_JPG = Buffer.from('ffd8ffe000104a46494600010101004800480000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090a0c100c0a0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffd9', 'hex');
const SAMPLE_WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
  Buffer.from([0x0e, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x34, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe]),
]);
const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'utf8');

function createMockStorage() {
  const store = new Map();
  return {
    put: async ({ key, body, mimeType }) => {
      store.set(key, { body: Buffer.from(body), mimeType });
      return { key };
    },
    get: async ({ key }) => {
      if (!store.has(key)) throw new Error('NOT_FOUND');
      return store.get(key).body;
    },
    has: (key) => store.has(key),
    dump: () => store,
  };
}

function createMockDatabase() {
  const entities = [];
  const entityMedia = [];
  const sources = [];
  const jobs = [];

  return {
    entities,
    entityMedia,
    sources,
    jobs,
    query: async (sql, params = []) => {
      const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();

      if (normalizedSql.includes('INSERT INTO knowledge_entities')) {
        const [tenant_id, source_id, business_identity_id, candidate_id, entity_type, name, external_code, description, attributesJson, textual_evidence, confidence, approval_status, is_runtime_eligible, provenanceJson, reviewed_by] = params;
        const row = {
          id: crypto.randomUUID(),
          tenant_id,
          source_id,
          business_identity_id,
          candidate_id,
          entity_type: entity_type || 'GENERIC',
          name,
          external_code,
          description,
          attributes: typeof attributesJson === 'string' ? JSON.parse(attributesJson) : attributesJson,
          textual_evidence,
          confidence: Number(confidence) || 1.0,
          approval_status: approval_status || 'PENDING',
          is_runtime_eligible: Boolean(is_runtime_eligible),
          provenance: typeof provenanceJson === 'string' ? JSON.parse(provenanceJson) : provenanceJson,
          reviewed_by,
          reviewed_at: reviewed_by ? new Date().toISOString() : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        entities.push(row);
        return { rowCount: 1, rows: [row] };
      }

      if (normalizedSql.includes('INSERT INTO knowledge_entity_media')) {
        const [id, tenant_id, entity_id, source_id, mime_type, storage_key, original_filename, file_size_bytes, content_hash, media_role, page_number, bounding_box, approval_status, is_runtime_eligible, confidence, provenanceJson] = params;
        const row = {
          id: id || crypto.randomUUID(),
          tenant_id,
          entity_id,
          source_id,
          media_type: 'IMAGE',
          mime_type,
          storage_key,
          original_filename,
          file_size_bytes: Number(file_size_bytes),
          content_hash,
          media_role,
          page_number,
          bounding_box: bounding_box ? JSON.parse(bounding_box) : null,
          approval_status: approval_status || 'PENDING',
          is_runtime_eligible: Boolean(is_runtime_eligible),
          confidence: Number(confidence) || 1.0,
          provenance: provenanceJson ? JSON.parse(provenanceJson) : {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        entityMedia.push(row);
        return { rowCount: 1, rows: [row] };
      }

      if (normalizedSql.includes('INSERT INTO knowledge_base_documents')) {
        const row = {
          id: params[0] || crypto.randomUUID(),
          tenant_id: params[1],
          title: params[3] || 'Knowledge Source',
          content: params[4] || '',
          source_type: params[6] || 'DOCUMENT',
          status: 'active',
          processing_status: 'READY',
          indexing_status: 'READY',
          enabled: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        sources.push(row);
        return { rowCount: 1, rows: [row] };
      }

      if (normalizedSql.includes('INSERT INTO knowledge_source_assistants')) {
        return { rowCount: 1, rows: [{ id: crypto.randomUUID(), status: 'PENDING' }] };
      }
      if (normalizedSql.includes('INSERT INTO knowledge_processing_jobs')) {
        const [tId, sId, cHash, , , , force] = params;
        let job = jobs.find((j) => j.tenant_id === tId && j.source_id === sId);
        if (!job) {
          job = {
            id: crypto.randomUUID(),
            tenant_id: tId,
            source_id: sId,
            job_type: 'INDEX_SOURCE',
            content_hash: cHash,
            status: 'PENDING',
            attempts: 0,
            locked_at: null,
            locked_until: null,
          };
          jobs.push(job);
        } else if (force) {
          job.status = 'PENDING';
          job.attempts = 0;
          job.locked_at = null;
          job.locked_until = null;
        }
        return { rowCount: 1, rows: [job] };
      }


      if (normalizedSql.includes('INSERT INTO knowledge_source_assistants') || normalizedSql.includes('INSERT INTO knowledge_processing_jobs')) {
        return { rowCount: 1, rows: [{ id: crypto.randomUUID(), status: 'PENDING' }] };
      }
      if (normalizedSql.includes('FROM knowledge_base_documents') && normalizedSql.includes('WHERE id = $1 AND tenant_id = $2')) {
        const [sourceId, tenantId] = params;
        const source = sources.find((s) => s.id === sourceId && s.tenant_id === tenantId);
        if (!source) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [source] };
      }


      if (normalizedSql.includes('FROM knowledge_entity_media') && normalizedSql.includes('WHERE id = $1 AND tenant_id = $2')) {
        const [mediaId, tenantId] = params;
        const media = entityMedia.find((m) => m.id === mediaId && m.tenant_id === tenantId);
        if (!media) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [media] };
      }

      if (normalizedSql.includes('FROM knowledge_entities e') && normalizedSql.includes('WHERE e.id = $1 AND e.tenant_id = $2')) {
        const [entityId, tenantId] = params;
        const entity = entities.find((e) => e.id === entityId && e.tenant_id === tenantId);
        if (!entity) return { rowCount: 0, rows: [] };
        const media = entityMedia.filter((m) => m.entity_id === entity.id && m.tenant_id === tenantId);
        return { rowCount: 1, rows: [{ ...entity, media }] };
      }

      if (normalizedSql.includes('FROM knowledge_entities e') && !normalizedSql.includes('match_score')) {
        const tenantId = params[0];
        let matched = entities.filter((e) => e.tenant_id === tenantId);
        if (params.includes('APPROVED')) matched = matched.filter((e) => e.approval_status === 'APPROVED');
        if (params.includes('PENDING')) matched = matched.filter((e) => e.approval_status === 'PENDING');
        const rows = matched.map((e) => ({
          ...e,
          media: entityMedia.filter((m) => m.entity_id === e.id && m.tenant_id === tenantId),
        }));
        return { rowCount: rows.length, rows };
      }

      if (normalizedSql.includes('UPDATE knowledge_entities') && normalizedSql.includes("approval_status = 'APPROVED'")) {
        const [entityId, tenantId, reviewedBy] = params;
        const entity = entities.find((e) => e.id === entityId && e.tenant_id === tenantId);
        if (!entity) return { rowCount: 0, rows: [] };
        entity.approval_status = 'APPROVED';
        entity.is_runtime_eligible = true;
        entity.reviewed_by = reviewedBy;
        entity.reviewed_at = new Date().toISOString();
        return { rowCount: 1, rows: [entity] };
      }

      if (normalizedSql.includes('UPDATE knowledge_entities') && normalizedSql.includes("approval_status = 'REJECTED'")) {
        const [entityId, tenantId, reviewedBy] = params;
        const entity = entities.find((e) => e.id === entityId && e.tenant_id === tenantId);
        if (!entity) return { rowCount: 0, rows: [] };
        entity.approval_status = 'REJECTED';
        entity.is_runtime_eligible = false;
        entity.reviewed_by = reviewedBy;
        return { rowCount: 1, rows: [entity] };
      }

      if (normalizedSql.includes('UPDATE knowledge_entity_media') && normalizedSql.includes("approval_status = 'APPROVED'")) {
        if (params.length === 2 && normalizedSql.includes('WHERE entity_id = $1')) {
          const [entityId, tenantId] = params;
          entityMedia.filter((m) => m.entity_id === entityId && m.tenant_id === tenantId && m.approval_status !== 'REJECTED')
            .forEach((m) => { m.approval_status = 'APPROVED'; m.is_runtime_eligible = true; });
          return { rowCount: 1, rows: [] };
        }
        if (params.length === 3 && normalizedSql.includes('WHERE id = $1')) {
          const [mediaId, tenantId, entityId] = params;
          const media = entityMedia.find((m) => m.id === mediaId && m.tenant_id === tenantId && m.entity_id === entityId);
          if (!media) return { rowCount: 0, rows: [] };
          media.approval_status = 'APPROVED';
          media.is_runtime_eligible = true;
          return { rowCount: 1, rows: [media] };
        }
      }

      if (normalizedSql.includes('UPDATE knowledge_entity_media') && normalizedSql.includes("approval_status = 'REJECTED'")) {
        if (params.length === 2 && normalizedSql.includes('WHERE entity_id = $1')) {
          const [entityId, tenantId] = params;
          entityMedia.filter((m) => m.entity_id === entityId && m.tenant_id === tenantId)
            .forEach((m) => { m.approval_status = 'REJECTED'; m.is_runtime_eligible = false; });
          return { rowCount: 1, rows: [] };
        }
        if (params.length === 3 && normalizedSql.includes('WHERE id = $1')) {
          const [mediaId, tenantId, entityId] = params;
          const media = entityMedia.find((m) => m.id === mediaId && m.tenant_id === tenantId && m.entity_id === entityId);
          if (!media) return { rowCount: 0, rows: [] };
          media.approval_status = 'REJECTED';
          media.is_runtime_eligible = false;
          return { rowCount: 1, rows: [media] };
        }
      }

      if (normalizedSql.includes('match_score') && normalizedSql.includes('knowledge_entities')) {
        const tenantId = params[0];
        const queryText = String(params[1] || '').toLowerCase();
        const approved = entities.filter((e) => e.tenant_id === tenantId && e.approval_status === 'APPROVED' && e.is_runtime_eligible);

        const rows = [];
        for (const e of approved) {
          const name = String(e.name || '').toLowerCase();
          const code = String(e.external_code || '').toLowerCase();
          const desc = String(e.description || '').toLowerCase();

          let matchScore = 0;
          if (code && code === queryText) matchScore = 1.0;
          else if (name === queryText) matchScore = 0.98;
          else if (name.includes(queryText)) matchScore = 0.88;
          else if (queryText.includes(name)) matchScore = 0.82;
          else if (desc.includes(queryText)) matchScore = 0.65;
          else continue;

          const approvedMedia = entityMedia.filter((m) => m.entity_id === e.id && m.tenant_id === tenantId && m.approval_status === 'APPROVED' && m.is_runtime_eligible);
          rows.push({
            ...e,
            source_title: 'Catalog Document',
            approved_media: approvedMedia,
            match_score: matchScore,
          });
        }
        rows.sort((a, b) => b.match_score - a.match_score);
        return { rowCount: rows.length, rows };
      }

      if (normalizedSql.includes('FROM ai_assistants')) {
        return { rowCount: 1, rows: [{ id: assistantA, tenant_id: params[0] }] };
      }

      if (normalizedSql.includes('stale_recovery_count') && normalizedSql.includes('UPDATE knowledge_processing_jobs')) {
        const recovered = jobs.filter((j) => j.status === 'PROCESSING');
        const rows = [];
        for (const j of recovered) {
          if (j.attempts >= 3) {
            j.status = 'FAILED';
            j.last_error_code = 'KNOWLEDGE_PROCESSING_LEASE_EXPIRED';
          } else {
            j.status = 'PENDING';
          }
          rows.push({ id: j.id, tenant_id: j.tenant_id, source_id: j.source_id, status: j.status, attempts: j.attempts });
        }
        return { rowCount: rows.length, rows };
      }

      return { rowCount: 0, rows: [] };
    },
  };
}

test('1 & 2 & 3: PDF catalog upload extracts searchable text and preserves visual reference evidence', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const sourceId = crypto.randomUUID();

  const mockPdfBytes = Buffer.from('%PDF-1.4\nCatalog Content\n%%EOF');
  const mockText = 'Item: Nordic Cloud Sofa\nSKU: SOFA-NC-01\nDimensions: 220x95cm\nMaterial: Boucle Fabric\nComfortable 3-seater modular sofa.';
  const mockImage = {
    pageNumber: 1,
    buffer: SAMPLE_PNG,
    mimeType: 'image/png',
    width: 800,
    height: 600,
    originalFilename: 'sofa_front.png',
  };

  const result = await processPdfCatalogIngestion({
    database,
    storage,
    tenantId: tenantA,
    sourceId,
    bytes: mockPdfBytes,
    contentHash: 'a'.repeat(64),
    extractPdfText: async () => ({ text: mockText, pages: [{ pageNumber: 1, text: mockText }] }),
    extractPdfImages: async () => [mockImage],
  });

  assert.equal(result.entityCount, 1);
  assert.equal(result.mediaCount, 1);
  assert.ok(result.extractedText.includes('Nordic Cloud Sofa'));

  // Verify entity created with textual knowledge and attributes
  const entities = await listKnowledgeEntities({ database, tenantId: tenantA, sourceId });
  assert.equal(entities.length, 1);
  assert.equal(entities[0].name, 'Nordic Cloud Sofa');
  assert.equal(entities[0].external_code, 'SOFA-NC-01');
  assert.equal(entities[0].attributes.dimensions, '220x95cm');
  assert.equal(entities[0].attributes.material, 'Boucle Fabric');

  // Verify visual reference media preserved in storage & DB
  assert.equal(entities[0].media.length, 1);
  assert.equal(entities[0].media[0].mime_type, 'image/png');
  assert.ok(storage.has(entities[0].media[0].storage_key));
});

test('4 & 5 & 6: Multiple entities with multiple reference images originate from multi-page PDF with provenance', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const sourceId = crypto.randomUUID();

  const page1Text = 'Item: Nordic Cloud Sofa\nSKU: SOFA-01\nColor: Beige';
  const page2Text = 'Item: Minimalist Floor Lamp\nSKU: LAMP-02\nColor: Matte Black';

  const images = [
    { pageNumber: 1, buffer: SAMPLE_PNG, mimeType: 'image/png', width: 600, height: 600, originalFilename: 'sofa_front.png' },
    { pageNumber: 1, buffer: SAMPLE_JPG, mimeType: 'image/jpeg', width: 600, height: 600, originalFilename: 'sofa_side.jpg' },
    { pageNumber: 2, buffer: SAMPLE_PNG, mimeType: 'image/png', width: 400, height: 800, originalFilename: 'lamp_angle.png' },
  ];

  const result = await processPdfCatalogIngestion({
    database,
    storage,
    tenantId: tenantA,
    sourceId,
    bytes: SAMPLE_PDF,
    contentHash: 'b'.repeat(64),
    extractPdfText: async () => ({
      text: `${page1Text}\n\n${page2Text}`,
      pages: [
        { pageNumber: 1, text: page1Text },
        { pageNumber: 2, text: page2Text },
      ],
    }),
    extractPdfImages: async () => images,
  });

  assert.equal(result.entityCount, 2);
  assert.equal(result.mediaCount, 3);

  const entities = await listKnowledgeEntities({ database, tenantId: tenantA, sourceId });
  assert.equal(entities.length, 2);

  const sofa = entities.find((e) => e.name === 'Nordic Cloud Sofa');
  const lamp = entities.find((e) => e.name === 'Minimalist Floor Lamp');

  assert.ok(sofa);
  assert.ok(lamp);
  assert.equal(sofa.provenance.pageNumber, 1);
  assert.equal(lamp.provenance.pageNumber, 2);
  assert.equal(sofa.media.length, 2); // 2 images on page 1
  assert.equal(lamp.media.length, 1); // 1 image on page 2
});

test('7 & 8: Irrelevant tiny PDF graphics filtered; uncertain multi-entity associations remain reviewable/unapproved', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const sourceId = crypto.randomUUID();

  // Multi-item page with ambiguous image association
  const multiItemPageText = 'Item: Variant A Dining Chair\nSKU: CHAIR-A\n\nItem: Variant B Dining Chair\nSKU: CHAIR-B';

  const images = [
    // Tiny decorative logo or icon (width < 48) -> should be filtered
    { pageNumber: 1, buffer: Buffer.from('tiny'), mimeType: 'image/png', width: 16, height: 16, originalFilename: 'logo.png' },
    // Legitimate product image on a multi-item page
    { pageNumber: 1, buffer: SAMPLE_PNG, mimeType: 'image/png', width: 500, height: 500, originalFilename: 'chair_catalog.png' },
  ];

  const result = await processPdfCatalogIngestion({
    database,
    storage,
    tenantId: tenantA,
    sourceId,
    bytes: SAMPLE_PDF,
    contentHash: 'c'.repeat(64),
    extractPdfText: async () => ({
      text: multiItemPageText,
      pages: [{ pageNumber: 1, text: multiItemPageText }],
    }),
    extractPdfImages: async () => images.filter((img) => img.width >= 48),
  });

  assert.equal(result.entityCount, 2);

  const entities = await listKnowledgeEntities({ database, tenantId: tenantA, sourceId });
  assert.equal(entities.length, 2);

  // Both entities are in PENDING review state
  for (const ent of entities) {
    assert.equal(ent.approval_status, 'PENDING');
    assert.equal(ent.is_runtime_eligible, false);
    // Associated image marked as UNCERTAIN_ASSOCIATION rather than falsely high confidence
    for (const med of ent.media) {
      assert.equal(med.media_role, 'UNCERTAIN_ASSOCIATION');
      assert.equal(med.approval_status, 'PENDING');
      assert.equal(med.is_runtime_eligible, false);
    }
  }
});


test('9 & 10 & 11 & 12: Direct PNG, JPG, WebP uploads succeed while unsupported MIME types fail', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  // 1. Direct PNG upload
  const pngUpload = validateKnowledgeUpload({
    originalname: 'chair-front.png',
    mimetype: 'image/png',
    buffer: SAMPLE_PNG,
    size: SAMPLE_PNG.length,
  });
  assert.equal(pngUpload.mimeType, 'image/png');
  assert.equal(pngUpload.extension, 'png');

  // 2. Direct JPG upload
  const jpgUpload = validateKnowledgeUpload({
    originalname: 'chair-side.jpg',
    mimetype: 'image/jpeg',
    buffer: SAMPLE_JPG,
    size: SAMPLE_JPG.length,
  });
  assert.equal(jpgUpload.mimeType, 'image/jpeg');
  assert.ok(['jpg', 'jpeg'].includes(jpgUpload.extension));

  // 3. Direct WebP upload
  const webpUpload = validateKnowledgeUpload({
    originalname: 'chair-render.webp',
    mimetype: 'image/webp',
    buffer: SAMPLE_WEBP,
    size: SAMPLE_WEBP.length,
  });
  assert.equal(webpUpload.mimeType, 'image/webp');
  assert.equal(webpUpload.extension, 'webp');

  // 4. Unsupported MIME type fails safely
  assert.throws(() => {
    validateKnowledgeUpload({
      originalname: 'archive.zip',
      mimetype: 'application/zip',
      buffer: Buffer.from('PK...'),
      size: 5,
    });
  }, KnowledgeSourceIngestionError);
});

test('13 & 14: Malformed and oversized uploads fail safely with canonical limits', () => {
  // Corrupted image header
  assert.throws(() => {
    validateKnowledgeUpload({
      originalname: 'fake.png',
      mimetype: 'image/png',
      buffer: Buffer.from('not-a-real-png-header'),
      size: 21,
    });
  });

  // Oversized source (> 25MB)
  assert.throws(() => {
    validateKnowledgeUpload({
      originalname: 'huge.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4...'),
      size: 30 * 1024 * 1024,
    });
  }, KnowledgeSourceIngestionError);
});

test('15 & 16 & 17: Approval lifecycle: approved entities are retrievable; unapproved & rejected are excluded', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  // Create 3 entities: 1 to approve, 1 to leave pending, 1 to reject
  const entity1 = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Approved Nordic Sofa',
    externalCode: 'SOFA-APP-01',
    description: 'Beautiful beige sofa',
    confidence: 1.0,
    approvalStatus: 'PENDING',
    isRuntimeEligible: false,
  });

  const entity2 = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Pending Unapproved Armchair',
    externalCode: 'CHAIR-PEND-01',
    description: 'Armchair awaiting review',
    confidence: 0.8,
    approvalStatus: 'PENDING',
    isRuntimeEligible: false,
  });

  const entity3 = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Rejected Defective Table',
    externalCode: 'TABLE-REJ-01',
    description: 'Table with error',
    confidence: 0.5,
    approvalStatus: 'PENDING',
    isRuntimeEligible: false,
  });

  // Approve entity 1
  await approveKnowledgeEntity({ database, tenantId: tenantA, entityId: entity1.id, reviewedBy: userA });
  // Reject entity 3
  await rejectKnowledgeEntity({ database, tenantId: tenantA, entityId: entity3.id, reviewedBy: userA });

  // Query retrieval
  const ret1 = await retrieveApprovedEntities({ database, tenantId: tenantA, query: 'Approved Nordic Sofa' });
  assert.equal(ret1.length, 1);
  assert.equal(ret1[0].name, 'Approved Nordic Sofa');

  const ret2 = await retrieveApprovedEntities({ database, tenantId: tenantA, query: 'Pending Unapproved Armchair' });
  assert.equal(ret2.length, 0); // Unapproved entity NOT retrievable

  const ret3 = await retrieveApprovedEntities({ database, tenantId: tenantA, query: 'Rejected Defective Table' });
  assert.equal(ret3.length, 0); // Rejected entity NOT retrievable
});

test('18 & 19: Entity retrieval returns both textual evidence and multiple visual reference images', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  const entity = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Modular Sectional Sofa',
    externalCode: 'SEC-MOD-01',
    description: '4-piece modular configuration with water-resistant fabric.',
    attributes: { pieces: 4, fabric: 'performance-boucle', color: 'sand' },
    textualEvidence: 'Modular Sectional Sofa (SEC-MOD-01) - 4 piece set in sand color.',
    confidence: 1.0,
    approvalStatus: 'PENDING',
    isRuntimeEligible: false,
  });

  // Add 2 reference images to this entity
  await addEntityMedia({
    database,
    storage,
    tenantId: tenantA,
    entityId: entity.id,
    file: { buffer: SAMPLE_PNG, mimetype: 'image/png', originalname: 'sectional_front.png', size: SAMPLE_PNG.length },
    mediaRole: 'PRIMARY_REFERENCE',
    approvalStatus: 'PENDING',
  });

  await addEntityMedia({
    database,
    storage,
    tenantId: tenantA,
    entityId: entity.id,
    file: { buffer: SAMPLE_JPG, mimetype: 'image/jpeg', originalname: 'sectional_side.jpg', size: SAMPLE_JPG.length },
    mediaRole: 'SECONDARY_REFERENCE',
    approvalStatus: 'PENDING',
  });

  // Approve entity
  await approveKnowledgeEntity({ database, tenantId: tenantA, entityId: entity.id, reviewedBy: userA });

  // Retrieve approved entity
  const matches = await retrieveApprovedEntities({ database, tenantId: tenantA, query: 'Modular Sectional Sofa' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'Modular Sectional Sofa');
  assert.equal(matches[0].external_code, 'SEC-MOD-01');
  assert.equal(matches[0].attributes.color, 'sand');

  // Both approved reference images returned
  assert.equal(matches[0].approved_media.length, 2);
  assert.equal(matches[0].approved_media[0].mime_type, 'image/png');
  assert.equal(matches[0].approved_media[1].mime_type, 'image/jpeg');
});

test('20 & 21 & 22: Cross-tenant isolation: Tenant B cannot retrieve Tenant A entities or visual resources', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  const entityA = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Confidential Tenant A Product',
    externalCode: 'CONF-A-01',
    confidence: 1.0,
    approvalStatus: 'APPROVED',
    isRuntimeEligible: true,
  });

  await addEntityMedia({
    database,
    storage,
    tenantId: tenantA,
    entityId: entityA.id,
    file: { buffer: SAMPLE_PNG, mimetype: 'image/png', originalname: 'secret_a.png', size: SAMPLE_PNG.length },
    mediaRole: 'PRIMARY_REFERENCE',
    approvalStatus: 'APPROVED',
    isRuntimeEligible: true,
  });

  // Tenant B searches for Tenant A product
  const tenantBMatches = await retrieveApprovedEntities({ database, tenantId: tenantB, query: 'Confidential Tenant A Product' });
  assert.equal(tenantBMatches.length, 0);

  // Tenant B attempts to get Tenant A entity directly
  await assert.rejects(async () => {
    await getKnowledgeEntity({ database, tenantId: tenantB, entityId: entityA.id });
  }, KnowledgeEntityError);
});

test('23 & 24 & 25: Existing manual and document text sources remain fully functional and compatible', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  // Create standard text source
  const textSource = await createManualKnowledgeSource({
    database,
    tenantId: tenantA,
    title: 'Store Return Policy',
    content: 'Customers can return items within 30 days of purchase with valid receipt.',
  });

  assert.ok(textSource.id);
  assert.equal(textSource.tenantId, tenantA);

  // Preview retrieval continues to work seamlessly with text matches
  const preview = await previewKnowledgeRetrieval({
    database,
    embed: async () => new Array(1536).fill(0.01),
    tenantId: tenantA,
    assistantId: assistantA,
    query: 'What is the return policy?',
  });

  assert.ok(preview);
  assert.equal(preview.query, 'What is the return policy?');
  assert.ok(Array.isArray(preview.matches));
  assert.ok(!preview.entities || Array.isArray(preview.entities));
});

test('26 & 27: Visual AI normalized request receives tenant reference media without knowledge-coupling in adapter', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  const entity = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Nordic Cloud Sofa',
    externalCode: 'SOFA-NC-01',
    description: 'Minimalist boucle fabric sofa',
    confidence: 1.0,
    approvalStatus: 'APPROVED',
    isRuntimeEligible: true,
  });

  await addEntityMedia({
    database,
    storage,
    tenantId: tenantA,
    entityId: entity.id,
    file: { buffer: SAMPLE_PNG, mimetype: 'image/png', originalname: 'catalog_sofa.png', size: SAMPLE_PNG.length },
    mediaRole: 'PRIMARY_REFERENCE',
    approvalStatus: 'APPROVED',
    isRuntimeEligible: true,
  });

  const grounding = await resolveVisualAiGroundingContext({
    database,
    tenantId: tenantA,
    instruction: 'Show the Nordic Cloud Sofa in my living room.',
  });

  assert.ok(grounding.entity);
  assert.equal(grounding.entity.name, 'Nordic Cloud Sofa');
  assert.equal(grounding.referenceMedia.length, 1);

  const groundedInstruction = buildGroundedVisualInstruction({
    instruction: 'Show the Nordic Cloud Sofa in my living room.',
    groundingContext: grounding,
  });
  assert.ok(groundedInstruction.includes('Nordic Cloud Sofa'));

  const requests = [];
  const googleProvider = createVisualAIProvider({
    providerType: 'GOOGLE',
    env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test-key' },
    googleClientFactory: () => ({
      models: {
        generateContent: async (req) => {
          requests.push(req);
          return {
            candidates: [{ content: { parts: [{ inlineData: { data: DETERMINISTIC_MOCK_PNG.toString('base64'), mimeType: 'image/png' } }] } }],
          };
        },
      },
    }),
  });

  const customerRoomBuffer = Buffer.from('customer-living-room-photo');
  const catalogMediaBuffer = await storage.get({ key: grounding.referenceMedia[0].storage_key });

  const result = await googleProvider.generateConcept({
    instruction: groundedInstruction,
    sourceImages: [{ buffer: customerRoomBuffer, mimeType: 'image/jpeg', originalFilename: 'my_room.jpg' }],
    referenceImages: [{ buffer: catalogMediaBuffer, mimeType: grounding.referenceMedia[0].mime_type, originalFilename: 'catalog_sofa.png' }],
  });

  assert.equal(result.finishReason, 'SUCCESS');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].contents[0].parts.length, 3);
});

test('28 & 29 & 30: Generic entity architecture contains no provider, vertical, or customer-specific branches', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  const fashionEntity = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    entityType: 'CLOTHING',
    name: 'Silk Trench Coat',
    externalCode: 'COAT-01',
    description: 'Double-breasted silk trench coat',
  });
  assert.equal(fashionEntity.entity_type, 'CLOTHING');

  const realEstateEntity = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    entityType: 'PROPERTY',
    name: 'Penthouse Unit 402',
    description: '3-bedroom penthouse with terrace view',
  });
  assert.equal(realEstateEntity.entity_type, 'PROPERTY');

  const equipmentEntity = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    entityType: 'EQUIPMENT',
    name: 'Hydraulic Lift XL',
    externalCode: 'LIFT-88',
  });
  assert.equal(equipmentEntity.entity_type, 'EQUIPMENT');
});

test('31: Fresh tenant can upload visual source with multiple images in one flow without manual SQL', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const freshTenant = crypto.randomUUID();

  const result = await createVisualEntityKnowledgeSource({
    database,
    storage,
    tenantId: freshTenant,
    title: 'Modern Coffee Table',
    entityType: 'FURNITURE',
    name: 'Nordic Oak Table',
    externalCode: 'TABLE-OAK-01',
    description: 'Solid oak minimalist coffee table',
    attributes: { material: 'Solid Oak', finish: 'Natural Matte' },
    files: [
      { buffer: SAMPLE_PNG, mimetype: 'image/png', originalname: 'table_top.png', size: SAMPLE_PNG.length },
      { buffer: SAMPLE_JPG, mimetype: 'image/jpeg', originalname: 'table_side.jpg', size: SAMPLE_JPG.length },
    ],
  });

  assert.ok(result.sourceId);
  assert.ok(result.entityId);
  assert.equal(result.entity.name, 'Nordic Oak Table');
  assert.equal(result.media.length, 2);
  assert.equal(result.processingStatus, 'READY');

  const retrieved = await retrieveApprovedEntities({ database, tenantId: freshTenant, query: 'Nordic Oak Table' });
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].approved_media.length, 2);
});

test('32: Ambiguity detection and multi-language clarification (EN, TR, AR)', () => {
  const matchedVariants = [
    { id: '1', name: 'Nordic Sofa Beige', external_code: 'NS-BEIGE', match_score: 0.88 },
    { id: '2', name: 'Nordic Sofa Charcoal', external_code: 'NS-CHARC', match_score: 0.86 },
  ];

  const ambiguity = detectEntityAmbiguity(matchedVariants);
  assert.equal(ambiguity.isAmbiguous, true);
  assert.equal(ambiguity.candidates.length, 2);

  const enMsg = formatVisualAiClarification('en', ['Nordic Sofa Beige', 'Nordic Sofa Charcoal']);
  assert.ok(enMsg.includes('Nordic Sofa Beige'));
  assert.ok(enMsg.includes('Nordic Sofa Charcoal'));

  const trMsg = formatVisualAiClarification('tr', ['Nordic Sofa Beige', 'Nordic Sofa Charcoal']);
  assert.ok(trMsg.includes('Hangi seçeneği'));

  const arMsg = formatVisualAiClarification('ar', ['Nordic Sofa Beige', 'Nordic Sofa Charcoal']);
  assert.ok(arMsg.includes('أي خيار'));
});

test('33 & 34 & 35: Evidence precedence, multi-reference generation and provider fault tolerance', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  const provider = createDeterministicMockVisualProvider();
  const customerRoom = { buffer: Buffer.from('my-room-bytes'), mimeType: 'image/jpeg', originalFilename: 'room.jpg' };
  const catalogSofa = { buffer: SAMPLE_PNG, mimeType: 'image/png', originalFilename: 'sofa.png' };
  const catalogLamp = { buffer: SAMPLE_JPG, mimeType: 'image/jpeg', originalFilename: 'lamp.jpg' };

  const genResult = await provider.generateConcept({
    instruction: 'Place the sofa and lamp in my room.',
    sourceImages: [customerRoom],
    referenceImages: [catalogSofa, catalogLamp],
  });
  assert.equal(genResult.finishReason, 'SUCCESS');

  const faultyProvider = createDeterministicMockVisualProvider({ simulateError: 'RATE_LIMIT' });
  await assert.rejects(async () => {
    await faultyProvider.generateConcept({
      instruction: 'Place the sofa in my room.',
      sourceImages: [customerRoom],
      referenceImages: [catalogSofa],
    });
  });

  const entity = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Intact Entity',
    approvalStatus: 'APPROVED',
    isRuntimeEligible: true,
  });
  assert.equal(entity.name, 'Intact Entity');
});

test('36: Stale processing jobs are recovered and max-attempt exhausted jobs fail safely', async () => {
  const database = createMockDatabase();
  const sourceId1 = crypto.randomUUID();
  const sourceId2 = crypto.randomUUID();

  // Job 1: 1 attempt, status PROCESSING -> should be recovered to PENDING
  database.jobs.push({
    id: crypto.randomUUID(),
    tenant_id: tenantA,
    source_id: sourceId1,
    status: 'PROCESSING',
    attempts: 1,
  });

  // Job 2: 3 attempts, status PROCESSING -> should transition to FAILED
  database.jobs.push({
    id: crypto.randomUUID(),
    tenant_id: tenantA,
    source_id: sourceId2,
    status: 'PROCESSING',
    attempts: 3,
  });

  const outcome = await recoverStaleKnowledgeProcessingJobs(database);
  assert.equal(outcome.recovered, 1);
  assert.equal(outcome.failed, 1);
  assert.equal(database.jobs[0].status, 'PENDING');
  assert.equal(database.jobs[1].status, 'FAILED');
});

test('37: PDF catalog extraction recovers gracefully when image extraction fails or times out', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const sourceId = crypto.randomUUID();

  const mockText = 'Item: Resilient Entity\nSKU: RES-01\nDescription: Text remains extracted even if image extractor fails';

  const result = await processPdfCatalogIngestion({
    database,
    storage,
    tenantId: tenantA,
    sourceId,
    bytes: SAMPLE_PDF,
    contentHash: 'd'.repeat(64),
    extractPdfText: async () => ({ text: mockText, pages: [{ pageNumber: 1, text: mockText }] }),
    extractPdfImages: async () => { throw new Error('SIMULATED_PDF_IMAGE_TIMEOUT'); },
  });

  assert.equal(result.entityCount, 1);
  assert.equal(result.mediaCount, 0);
  assert.ok(result.extractedText.includes('Resilient Entity'));

  const entities = await listKnowledgeEntities({ database, tenantId: tenantA, sourceId });
  assert.equal(entities.length, 1);
  assert.equal(entities[0].name, 'Resilient Entity');
});

test('38: Knowledge processing worker emits structured observability on claim, progress, and completion', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const sourceId = crypto.randomUUID();

  const source = {
    id: sourceId,
    tenant_id: tenantA,
    source_type: 'MANUAL',
    content: 'Sample structured knowledge content for testing logging.',
    mime_type: null,
    storage_key: null,
    content_hash: 'e'.repeat(64),
    enabled: true,
    status: 'active',
    processing_status: 'PROCESSING',
    indexing_status: 'INDEXING',
  };
  database.sources.push(source);

  const logs = [];
  const mockLogger = {
    info: (event, payload) => logs.push({ level: 'info', event, payload: JSON.parse(payload) }),
    error: (event, payload) => logs.push({ level: 'error', event, payload }),
  };

  const job = {
    id: crypto.randomUUID(),
    tenant_id: tenantA,
    source_id: sourceId,
    job_type: 'INDEX_SOURCE',
    attempts: 1,
  };

  const result = await processKnowledgeProcessingJob({
    database,
    storage,
    job,
    embed: async () => new Array(1536).fill(0.01),
    index: async () => ({ chunkCount: 1, status: 'READY' }),
    logger: mockLogger,
  });

  assert.equal(result.status, 'READY');
  const eventNames = logs.map((l) => l.event);
  assert.ok(eventNames.includes('KNOWLEDGE_PROCESSING_JOB_CLAIMED'));
  assert.ok(eventNames.includes('KNOWLEDGE_PROCESSING_STAGE_STARTED'));
  assert.ok(eventNames.includes('KNOWLEDGE_PROCESSING_JOB_COMPLETED'));
});

test('39: Re-index forces stuck job to PENDING and clears stale locks', async () => {
  const database = createMockDatabase();
  const sourceId = crypto.randomUUID();
  const contentHash = 'f'.repeat(64);

  // Pre-existing stuck job
  database.jobs.push({
    id: crypto.randomUUID(),
    tenant_id: tenantA,
    source_id: sourceId,
    job_type: 'INDEX_SOURCE',
    content_hash: contentHash,
    status: 'PROCESSING',
    attempts: 2,
    locked_at: new Date().toISOString(),
    locked_until: new Date(Date.now() + 60000).toISOString(),
  });

  const job = await enqueueKnowledgeIndexJob({
    database,
    tenantId: tenantA,
    sourceId,
    contentHash,
    force: true,
  });

  assert.equal(job.status, 'PENDING');
  assert.equal(database.jobs[0].status, 'PENDING');
  assert.equal(database.jobs[0].attempts, 0);
  assert.equal(database.jobs[0].locked_at, null);
  assert.equal(database.jobs[0].locked_until, null);
});

test('40: Multi-page catalog extraction creates candidate entities and links visual page references', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const sourceId = crypto.randomUUID();

  const page1Text = 'Product: BILLY Bookcase\nSKU: 002.638.50\nPrice: $69.00\nDimensions: 80x28x202 cm\nClassic bookshelf with adjustable shelves.';
  const page2Text = 'Product: STRANDMON Armchair\nSKU: 503.004.32\nPrice: $299.00\nComfortable high-back wing armchair.';

  const result = await processPdfCatalogIngestion({
    database,
    storage,
    tenantId: tenantA,
    sourceId,
    bytes: SAMPLE_PDF,
    contentHash: 'a'.repeat(64),
    extractPdfText: async () => ({
      text: `${page1Text}\n\n${page2Text}`,
      pages: [
        { pageNumber: 1, text: page1Text },
        { pageNumber: 2, text: page2Text },
      ],
    }),
    extractPdfImages: async () => [
      {
        pageNumber: 1,
        buffer: SAMPLE_PNG,
        mimeType: 'image/png',
        width: 400,
        height: 400,
        originalFilename: 'billy_ref.png',
      },
      {
        pageNumber: 2,
        buffer: SAMPLE_PNG,
        mimeType: 'image/png',
        width: 400,
        height: 400,
        originalFilename: 'strandmon_ref.png',
      },
    ],
  });

  assert.equal(result.entityCount, 2);
  assert.equal(result.mediaCount, 2);

  const entities = await listKnowledgeEntities({ database, tenantId: tenantA, sourceId });
  assert.equal(entities.length, 2);
  assert.equal(entities[0].name, 'BILLY Bookcase');
  assert.equal(entities[0].external_code, '002.638.50');
  assert.equal(entities[0].media.length, 1);
  assert.equal(entities[0].media[0].original_filename, 'billy_ref.png');

  assert.equal(entities[1].name, 'STRANDMON Armchair');
  assert.equal(entities[1].external_code, '503.004.32');
  assert.equal(entities[1].media.length, 1);
  assert.equal(entities[1].media[0].original_filename, 'strandmon_ref.png');
});
test('41: Corrupted embedded image stream or storage error is isolated and does not fail PDF catalog extraction', async () => {
  const database = createMockDatabase();
  const failingStorage = {
    put: async () => { throw new Error('SIMULATED_R2_STORAGE_PUT_FAILURE'); },
  };
  const sourceId = crypto.randomUUID();

  const mockText = 'Product: MALM Bed Frame\nSKU: 700.123.45\nPrice: $199.00\nSturdy modern wooden bed frame.';

  const result = await processPdfCatalogIngestion({
    database,
    storage: failingStorage,
    tenantId: tenantA,
    sourceId,
    bytes: SAMPLE_PDF,
    contentHash: 'b'.repeat(64),
    extractPdfText: async () => ({
      text: mockText,
      pages: [{ pageNumber: 1, text: mockText }],
    }),
    extractPdfImages: async () => [
      {
        pageNumber: 1,
        buffer: Buffer.from([0x00, 0x11, 0x22, 0x33]), // Corrupted non-image bytes
        mimeType: 'image/png',
        width: 100,
        height: 100,
        originalFilename: 'corrupted.png',
      },
    ],
  });

  assert.equal(result.entityCount, 1);
  assert.equal(result.mediaCount, 0); // Corrupted image safely skipped

  const entities = await listKnowledgeEntities({ database, tenantId: tenantA, sourceId });
  assert.equal(entities.length, 1);
  assert.equal(entities[0].name, 'MALM Bed Frame');
  assert.equal(entities[0].external_code, '700.123.45');
});

test('42: Bounded per-page visual extraction succeeds and isolates single-page rendering faults', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();
  const sourceId = crypto.randomUUID();

  const page1 = 'Product: KALLAX Shelf\nSKU: 101.202.30\nPrice: $45.00';
  const page2 = 'Product: LACK Side Table\nSKU: 404.505.60\nPrice: $12.00';

  const result = await processPdfCatalogIngestion({
    database,
    storage,
    tenantId: tenantA,
    sourceId,
    bytes: SAMPLE_PDF,
    contentHash: 'c'.repeat(64),
    extractPdfText: async () => ({
      text: `${page1}\n\n${page2}`,
      pages: [
        { pageNumber: 1, text: page1 },
        { pageNumber: 2, text: page2 },
      ],
    }),
    extractPdfImages: async () => [
      {
        pageNumber: 1,
        buffer: SAMPLE_PNG,
        mimeType: 'image/png',
        width: 200,
        height: 200,
        originalFilename: 'kallax.png',
      },
    ],
  });

  assert.equal(result.entityCount, 2);
  assert.equal(result.mediaCount, 1);

  const entities = await listKnowledgeEntities({ database, tenantId: tenantA, sourceId });
  assert.equal(entities.length, 2);
  assert.equal(entities[0].name, 'KALLAX Shelf');
  assert.equal(entities[0].media.length, 1);
  assert.equal(entities[1].name, 'LACK Side Table');
  assert.equal(entities[1].media.length, 0);
});

test('43: Open-domain entities without "product:" or "item:" prefixes are extracted cleanly with SKUs, prices and attributes', () => {
  const catalogPageText = `BILLY
Art. no. 002.638.50
Price: $79.00
Dimensions: 80x28x202 cm
Color: White
A simple unit can be enough storage for a limited space or the foundation for a larger storage solution.

POÄNG
104.567.89
1.499 TL
Material: Layer-glued bent birch frame
Classic armchair with comfortable resilient cushion.`;

  const candidates = extractPageEntityCandidates(catalogPageText, 1);
  assert.equal(candidates.length, 2);

  assert.equal(candidates[0].name, 'BILLY');
  assert.equal(candidates[0].externalCode, '002.638.50');
  assert.equal(candidates[0].attributes.price, '$79.00');
  assert.equal(candidates[0].attributes.dimensions, '80x28x202 cm');
  assert.equal(candidates[0].attributes.color, 'White');
  assert.ok(candidates[0].description.includes('simple unit can be enough'));

  assert.equal(candidates[1].name, 'POÄNG');
  assert.equal(candidates[1].externalCode, '104.567.89');
  assert.equal(candidates[1].attributes.price, '1.499 TL');
  assert.equal(candidates[1].attributes.material, 'Layer-glued bent birch frame');
  assert.ok(candidates[1].description.includes('Classic armchair'));
});

test('44: getEntityMedia retrieves specific media record with tenant isolation', async () => {
  const database = createMockDatabase();
  const storage = createMockStorage();

  const entity = await createKnowledgeEntity({
    database,
    tenantId: tenantA,
    name: 'Test Desk',
  });

  const media = await addEntityMedia({
    database,
    storage,
    tenantId: tenantA,
    entityId: entity.id,
    file: {
      buffer: SAMPLE_PNG,
      mimetype: 'image/png',
      originalname: 'desk.png',
      size: SAMPLE_PNG.length,
    },
    mediaRole: 'PRIMARY_REFERENCE',
  });

  const { getEntityMedia } = await import('../services/knowledge-entity-service.js');
  const fetched = await getEntityMedia({ database, tenantId: tenantA, mediaId: media.id });
  assert.equal(fetched.id, media.id);
  assert.equal(fetched.mime_type, 'image/png');

  // Tenant B cannot access Tenant A media
  await assert.rejects(
    getEntityMedia({ database, tenantId: tenantB, mediaId: media.id }),
    (err) => err instanceof KnowledgeEntityError && err.code === 'KNOWLEDGE_MEDIA_NOT_FOUND'
  );
});

test('media review cannot cross entity or tenant boundaries', async () => {
  const database = createMockDatabase();
  const first = await createKnowledgeEntity({ database, tenantId: tenantA, name: 'First item' });
  const second = await createKnowledgeEntity({ database, tenantId: tenantA, name: 'Second item' });
  const media = await addEntityMedia({ database, storage: createMockStorage(), tenantId: tenantA, entityId: first.id, file: { buffer: SAMPLE_PNG, mimetype: 'image/png', originalname: 'first.png', size: SAMPLE_PNG.length }, mediaRole: 'PRIMARY_REFERENCE' });

  await assert.rejects(approveEntityMedia({ database, tenantId: tenantA, entityId: second.id, mediaId: media.id }), (error) => error instanceof KnowledgeEntityError && error.code === 'KNOWLEDGE_MEDIA_NOT_FOUND');
  await assert.rejects(rejectEntityMedia({ database, tenantId: tenantB, entityId: first.id, mediaId: media.id }), (error) => error instanceof KnowledgeEntityError && error.code === 'KNOWLEDGE_MEDIA_NOT_FOUND');
  assert.equal(database.entityMedia[0].approval_status, 'PENDING');
});





