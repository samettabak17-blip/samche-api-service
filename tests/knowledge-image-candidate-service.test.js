import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createImageKnowledgeCandidates } from '../services/knowledge-candidate-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assistantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const extractionHash = 'd'.repeat(64);
const semanticClassifier = {
  async classify({ segments }) {
    return segments.filter((segment) => segment.role === 'BUSINESS').map((segment) => ({
      segmentId: segment.id,
      segmentOrder: segment.segment_order,
      category: 'DURABLE_BUSINESS_FACT',
      canonicalText: 'Remaining balance is due three business days before the event.',
      confidence: 0.91,
    }));
  },
};

function rows() {
  return [
    { id: 's1', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 0, role: 'CUSTOMER', role_confidence: '0.95', normalized_text: 'Can we pay on the event day?', extraction_method: 'FAKE', source_locator: { page: 1 }, is_current: true },
    { id: 's2', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 1, role: 'BUSINESS', role_confidence: '0.91', normalized_text: 'No. Remaining balance is due 3 business days before the event. Contact sara@example.com.', extraction_method: 'FAKE', source_locator: { page: 1, y: 20 }, is_current: true },
    { id: 's3', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 2, role: 'CUSTOMER', role_confidence: '0.80', normalized_text: 'We normally have 25 attendees.', extraction_method: 'FAKE', source_locator: { page: 1, y: 40 }, is_current: true },
    { id: 's4', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 3, role: 'UNKNOWN', role_confidence: '0.40', normalized_text: 'Forwarded message', extraction_method: 'FAKE', source_locator: null, is_current: true },
  ];
}

function database({ segmentRows = rows(), existing = null, failOnEvidence = false, assistantAssignments = [], sourceBusinessIdentities = [], allowLegacyRegeneration = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM knowledge_source_extraction_segments/i.test(sql)) return { rows: segmentRows };
      if (/FROM knowledge_source_assistants/i.test(sql)) return { rows: assistantAssignments };
      if (/FROM knowledge_source_business_identities/i.test(sql)) return { rows: sourceBusinessIdentities.map((business_identity_id) => ({ business_identity_id })) };
      if (/SELECT (?:candidate\.)?id, (?:candidate\.)?status, (?:candidate\.)?candidate_fingerprint/i.test(sql)) return { rows: existing ? [existing] : [] };
      if (/INSERT INTO knowledge_candidates/i.test(sql)) return existing && !allowLegacyRegeneration ? { rows: [] } : { rows: [{ id: 'candidate-1', status: 'NEEDS_REVIEW', pii_redaction_status: 'REDACTED', candidate_fingerprint: params[6] }] };
      if (/INSERT INTO assistant_knowledge_recommendations/i.test(sql)) return { rows: [{ id: 'recommendation-1', status: 'NEEDS_REVIEW' }] };
      if (/INSERT INTO knowledge_candidate_image_evidence/i.test(sql) && failOnEvidence) throw Object.assign(new Error('evidence write failed'), { code: 'IMAGE_EVIDENCE_WRITE_FAILED' });
      return { rows: [] };
    },
    release() {},
  };
  return { calls, async connect() { return client; } };
}

test('creates a redacted NEEDS_REVIEW candidate from BUSINESS with adjacent CUSTOMER context', async () => {
  const db = database();
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, assistantId, sourceId, extractionHash, semanticClassifier });
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'NEEDS_REVIEW');
  assert.equal(result[0].reused, false);
  const insert = db.calls.find(({ sql }) => /INSERT INTO knowledge_candidates/i.test(sql));
  assert.equal(insert.params[5], 'Remaining balance is due three business days before the event.');
  const evidence = db.calls.filter(({ sql }) => /INSERT INTO knowledge_candidate_image_evidence/i.test(sql));
  assert.equal(evidence.length, 3);
  assert.equal(evidence.find(({ params }) => params[3] === 's2').params[10], 'PRIMARY');
  assert.equal(evidence.filter(({ params }) => params[10] === 'SUPPORTING_CONTEXT').length, 2);
  assert.ok(evidence.every(({ params }) => params[0] === tenantId));
  const sourceScope = db.calls.find(({ sql }) => /FROM knowledge_source_extraction_segments/i.test(sql));
  assert.match(sourceScope.sql, /knowledge_source_assistants/i);
  assert.equal(sourceScope.params[3], assistantId);
});

test('persists the explicit source Business Identity as immutable candidate evidence provenance', async () => {
  const identityId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const db = database({ sourceBusinessIdentities: [identityId] });
  await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier });
  const evidence = db.calls.filter(({ sql }) => /INSERT INTO knowledge_candidate_image_evidence/i.test(sql));
  assert.equal(evidence.length, 3);
  assert.ok(evidence.every(({ params }) => params[14] === identityId));
});

test('does not invent evidence Business Identity when a source has no explicit or has conflicting assignments', async () => {
  const db = database({ sourceBusinessIdentities: [] });
  await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier });
  const evidence = db.calls.find(({ sql }) => /INSERT INTO knowledge_candidate_image_evidence/i.test(sql));
  assert.equal(evidence.params[14], null);
});

test('CUSTOMER and UNKNOWN segments alone do not create candidates', async () => {
  const db = database({ segmentRows: rows().filter((segment) => segment.role !== 'BUSINESS') });
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier });
  assert.deepEqual(result, []);
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO knowledge_candidates/i.test(sql)), false);
});

test('reuses an exact image candidate fingerprint without duplicating it', async () => {
  const db = database({ existing: { id: 'existing-candidate', status: 'NEEDS_REVIEW', candidate_fingerprint: 'existing' } });
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, assistantId, sourceId, extractionHash, semanticClassifier });
  assert.equal(result[0].id, 'existing-candidate');
  assert.equal(result[0].reused, true);
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO knowledge_candidates/i.test(sql)), false);
});

test('an evidence-less approved legacy candidate does not block a stronger provenance regeneration', async () => {
  const db = database({ existing: { id: 'legacy-candidate', status: 'APPROVED', candidate_fingerprint: 'legacy', proposed_content: 'Remaining balance is due three business days before the event.', has_provenance: false }, allowLegacyRegeneration: true });
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, assistantId, sourceId, extractionHash, semanticClassifier });
  assert.equal(result[0].status, 'NEEDS_REVIEW');
  assert.equal(result[0].reused, false);
  const insert = db.calls.find(({ sql }) => /INSERT INTO knowledge_candidates/i.test(sql));
  assert.notEqual(insert.params[6], 'legacy');
  assert.match(db.calls.find(({ sql }) => /SELECT candidate\.id, candidate\.status/i.test(sql)).sql, /has_provenance/i);
});

test('stale or disabled image source produces no candidate', async () => {
  const db = database({ segmentRows: [] });
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier });
  assert.deepEqual(result, []);
});

test('redaction or evidence failure rolls back without leaving a candidate', async () => {
  const db = database({ failOnEvidence: true });
  await assert.rejects(() => createImageKnowledgeCandidates({ database: db, tenantId, assistantId, sourceId, extractionHash, semanticClassifier }), { code: 'IMAGE_EVIDENCE_WRITE_FAILED' });
  assert.ok(db.calls.some(({ sql }) => /^ROLLBACK$/i.test(sql.trim())));
});

test('candidate insert conflict target matches the partial fingerprint uniqueness invariant', () => {
  const source = fs.readFileSync(new URL('../services/knowledge-candidate-service.js', import.meta.url), 'utf8');
  assert.match(source, /ON CONFLICT \(tenant_id, candidate_fingerprint\)\s+WHERE candidate_fingerprint IS NOT NULL\s+DO NOTHING/);
});

test('keeps durable candidates tenant-scoped while creating assigned-assistant behavior recommendations', async () => {
  const behaviorSegment = { ...rows()[1], id: 's5', segment_order: 4, normalized_text: 'What budget range should the customer share before we recommend a package?' };
  const db = database({ segmentRows: [...rows(), behaviorSegment], assistantAssignments: [{ assistant_id: assistantId }] });
  const classifier = {
    async classify() {
      return [
        { segmentId: 's2', segmentOrder: 1, category: 'DURABLE_BUSINESS_FACT', canonicalText: 'The company provides event planning services.', confidence: 0.9 },
        { segmentId: 's5', segmentOrder: 4, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonicalText: 'Ask for the customer\'s estimated budget range before recommending a package.', confidence: 0.8 },
      ];
    },
  };
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier: classifier });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.behavior_recommendations.length, 1);
  assert.equal(result.behavior_recommendations[0].status, 'NEEDS_REVIEW');
  assert.equal(result.warnings.length, 0);
});

test('persists both durable knowledge and assistant behavior from one mixed BUSINESS segment', async () => {
  const db = database({ assistantAssignments: [{ assistant_id: assistantId }] });
  const classifier = {
    async classify() {
      return [
        { segmentId: 's2', segmentOrder: 1, category: 'DURABLE_BUSINESS_FACT', canonicalText: 'The company provides event planning services.', confidence: 0.9 },
        { segmentId: 's2', segmentOrder: 1, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonicalText: 'Ask whether the customer already has a venue.', confidence: 0.8 },
      ];
    },
  };

  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier: classifier });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.behavior_recommendations.length, 1);
  assert.equal(result.behavior_recommendations[0].assistant_id, assistantId);
  assert.equal(result.behavior_recommendations[0].status, 'NEEDS_REVIEW');
});

test('unassigned image source still creates durable facts and returns the behavior-assignment warning', async () => {
  const behaviorSegment = { ...rows()[1], id: 's5', segment_order: 4, normalized_text: 'What budget range should the customer share before we recommend a package?' };
  const db = database({ segmentRows: [...rows(), behaviorSegment] });
  const classifier = {
    async classify() {
      return [
        { segmentId: 's2', segmentOrder: 1, category: 'DURABLE_BUSINESS_FACT', canonicalText: 'The company provides event planning services.', confidence: 0.9 },
        { segmentId: 's5', segmentOrder: 4, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonicalText: 'Ask for the customer\'s estimated budget range.', confidence: 0.8 },
      ];
    },
  };
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier: classifier });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.behavior_recommendations.length, 0);
  assert.deepEqual(result.warnings, ['Assign this source to an assistant to generate behavior recommendations.']);
});

test('creates separate behavior recommendations for each assigned assistant', async () => {
  const secondAssistantId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const db = database({ assistantAssignments: [{ assistant_id: assistantId }, { assistant_id: secondAssistantId }] });
  const classifier = {
    async classify() {
      return [{ segmentId: 's2', segmentOrder: 1, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonicalText: 'Ask for the customer\'s estimated budget range.', confidence: 0.8 }];
    },
  };
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier: classifier });
  assert.equal(result.behavior_recommendations.length, 2);
  assert.deepEqual(new Set(result.behavior_recommendations.map((item) => item.assistant_id)), new Set([assistantId, secondAssistantId]));
});

test('redacts behavior recommendation text before persisting assistant-scoped guidance', async () => {
  const db = database({ assistantAssignments: [{ assistant_id: assistantId }] });
  const classifier = {
    async classify() {
      return [{ segmentId: 's2', segmentOrder: 1, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonicalText: 'Ask the customer to contact sara@example.com before recommending a package.', confidence: 0.8 }];
    },
  };
  await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash, semanticClassifier: classifier });
  const recommendationInsert = db.calls.find(({ sql }) => /INSERT INTO assistant_knowledge_recommendations/i.test(sql));
  assert.doesNotMatch(recommendationInsert.params[3], /sara@example\.com/i);
  assert.match(recommendationInsert.params[3], /\[redacted email\]/);
});

test('assistant recommendation idempotency is enforced by the scoped semantic fingerprint migration', () => {
  const migration = fs.readFileSync(new URL('../migrations/042_assistant_behavior_recommendation_semantics.sql', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../services/knowledge-candidate-service.js', import.meta.url), 'utf8');
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_assistant_recommendations_semantic_fingerprint/);
  assert.match(migration, /\(tenant_id, semantic_fingerprint\)/);
  assert.match(service, /ON CONFLICT \(tenant_id, semantic_fingerprint\)\s+WHERE semantic_fingerprint IS NOT NULL\s+DO NOTHING/);
});
