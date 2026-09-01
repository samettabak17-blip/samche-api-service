import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createImageKnowledgeCandidates } from '../services/knowledge-candidate-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assistantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const extractionHash = 'd'.repeat(64);

function rows() {
  return [
    { id: 's1', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 0, role: 'CUSTOMER', role_confidence: '0.95', normalized_text: 'Can we pay on the event day?', extraction_method: 'FAKE', source_locator: { page: 1 }, is_current: true },
    { id: 's2', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 1, role: 'BUSINESS', role_confidence: '0.91', normalized_text: 'No. Remaining balance is due 3 business days before the event. Contact sara@example.com.', extraction_method: 'FAKE', source_locator: { page: 1, y: 20 }, is_current: true },
    { id: 's3', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 2, role: 'CUSTOMER', role_confidence: '0.80', normalized_text: 'We normally have 25 attendees.', extraction_method: 'FAKE', source_locator: { page: 1, y: 40 }, is_current: true },
    { id: 's4', tenant_id: tenantId, source_id: sourceId, extraction_version: '1', extraction_hash: extractionHash, segment_order: 3, role: 'UNKNOWN', role_confidence: '0.40', normalized_text: 'Forwarded message', extraction_method: 'FAKE', source_locator: null, is_current: true },
  ];
}

function database({ segmentRows = rows(), existing = null, failOnEvidence = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM knowledge_source_extraction_segments/i.test(sql)) return { rows: segmentRows };
      if (/SELECT id, status, candidate_fingerprint/i.test(sql)) return { rows: existing ? [existing] : [] };
      if (/INSERT INTO knowledge_candidates/i.test(sql)) return existing ? { rows: [] } : { rows: [{ id: 'candidate-1', status: 'NEEDS_REVIEW', pii_redaction_status: 'REDACTED', candidate_fingerprint: params[6] }] };
      if (/INSERT INTO knowledge_candidate_image_evidence/i.test(sql) && failOnEvidence) throw Object.assign(new Error('evidence write failed'), { code: 'IMAGE_EVIDENCE_WRITE_FAILED' });
      return { rows: [] };
    },
    release() {},
  };
  return { calls, async connect() { return client; } };
}

test('creates a redacted NEEDS_REVIEW candidate from BUSINESS with adjacent CUSTOMER context', async () => {
  const db = database();
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, assistantId, sourceId, extractionHash });
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'NEEDS_REVIEW');
  assert.equal(result[0].reused, false);
  const insert = db.calls.find(({ sql }) => /INSERT INTO knowledge_candidates/i.test(sql));
  assert.doesNotMatch(insert.params[5], /sara@example\.com/);
  assert.match(insert.params[5], /\[redacted email\]/);
  const evidence = db.calls.filter(({ sql }) => /INSERT INTO knowledge_candidate_image_evidence/i.test(sql));
  assert.equal(evidence.length, 3);
  assert.equal(evidence.find(({ params }) => params[3] === 's2').params[10], 'PRIMARY');
  assert.equal(evidence.filter(({ params }) => params[10] === 'SUPPORTING_CONTEXT').length, 2);
  assert.ok(evidence.every(({ params }) => params[0] === tenantId));
  const sourceScope = db.calls.find(({ sql }) => /FROM knowledge_source_extraction_segments/i.test(sql));
  assert.match(sourceScope.sql, /knowledge_source_assistants/i);
  assert.equal(sourceScope.params[3], assistantId);
});

test('CUSTOMER and UNKNOWN segments alone do not create candidates', async () => {
  const db = database({ segmentRows: rows().filter((segment) => segment.role !== 'BUSINESS') });
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash });
  assert.deepEqual(result, []);
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO knowledge_candidates/i.test(sql)), false);
});

test('reuses an exact image candidate fingerprint without duplicating it', async () => {
  const db = database({ existing: { id: 'existing-candidate', status: 'NEEDS_REVIEW', candidate_fingerprint: 'existing' } });
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, assistantId, sourceId, extractionHash });
  assert.equal(result[0].id, 'existing-candidate');
  assert.equal(result[0].reused, true);
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO knowledge_candidates/i.test(sql)), false);
});

test('stale or disabled image source produces no candidate', async () => {
  const db = database({ segmentRows: [] });
  const result = await createImageKnowledgeCandidates({ database: db, tenantId, sourceId, extractionHash });
  assert.deepEqual(result, []);
});

test('redaction or evidence failure rolls back without leaving a candidate', async () => {
  const db = database({ failOnEvidence: true });
  await assert.rejects(() => createImageKnowledgeCandidates({ database: db, tenantId, assistantId, sourceId, extractionHash }), { code: 'IMAGE_EVIDENCE_WRITE_FAILED' });
  assert.ok(db.calls.some(({ sql }) => /^ROLLBACK$/i.test(sql.trim())));
});

test('candidate insert conflict target matches the partial fingerprint uniqueness invariant', () => {
  const source = fs.readFileSync(new URL('../services/knowledge-candidate-service.js', import.meta.url), 'utf8');
  assert.match(source, /ON CONFLICT \(tenant_id, candidate_fingerprint\)\s+WHERE candidate_fingerprint IS NOT NULL\s+DO NOTHING/);
});
