import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { approveConversationKnowledgeCandidate } from '../services/knowledge-candidate-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const candidateId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reviewerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('explicit approval materializes only redacted candidate text through the canonical source path', async () => {
  const calls = [];
  const client = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id, assistant_id, proposed_title/i.test(sql)) return { rows: [{ id: candidateId, assistant_id: null, proposed_title: 'Image fact', proposed_content: 'Redacted business fact', status: 'NEEDS_REVIEW', pii_redaction_status: 'REDACTED', image_semantic_version: '1' }] };
    if (/primary_business_evidence_count/i.test(sql)) return { rows: [{ primary_business_evidence_count: 1, trusted_identity_count: 1, original_source_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }] };
    if (/INSERT INTO knowledge_base_documents/i.test(sql)) return { rows: [{ id: 'approved-source', tenant_id: tenantId, processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) return { rows: [{ id: 'job-1' }] };
    return { rows: [] };
  } };
  const database = { connect: async () => ({ ...client, release: () => {} }) };
  const source = await approveConversationKnowledgeCandidate({ database, tenantId, candidateId, reviewedBy: reviewerId });
  assert.equal(source.id, 'approved-source');
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1).sql, 'COMMIT');
  const sourceInsert = calls.find(({ sql }) => /INSERT INTO knowledge_base_documents/i.test(sql));
  assert.equal(sourceInsert.params[4], 'CONVERSATION_CANDIDATE');
  assert.equal(sourceInsert.params[3], 'Redacted business fact');
  assert.ok(calls.some(({ sql }) => /INSERT INTO knowledge_source_business_identities/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /INSERT INTO knowledge_materialized_source_provenance/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /knowledge_candidate_image_evidence/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /SET status = 'APPROVED'/i.test(sql)));
});

test('a fresh image candidate fails closed without one trusted primary BUSINESS evidence identity', async () => {
  const client = { async query(sql) {
    if (/SELECT id, assistant_id, proposed_title/i.test(sql)) return { rows: [{ id: candidateId, assistant_id: null, proposed_title: 'Image fact', proposed_content: 'Redacted business fact', status: 'NEEDS_REVIEW', pii_redaction_status: 'PASSED', image_semantic_version: '1' }] };
    if (/primary_business_evidence_count/i.test(sql)) return { rows: [{ primary_business_evidence_count: 1, trusted_identity_count: 0 }] };
    if (/INSERT INTO knowledge_base_documents/i.test(sql)) return { rows: [{ id: 'would-be-source', tenant_id: tenantId, processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) return { rows: [{ id: 'job-1' }] };
    return { rows: [] };
  } };
  const database = { connect: async () => ({ ...client, release: () => {} }) };

  await assert.rejects(
    () => approveConversationKnowledgeCandidate({ database, tenantId, candidateId, reviewedBy: reviewerId }),
    { code: 'KNOWLEDGE_CANDIDATE_IMAGE_PROVENANCE_INVALID' },
  );
});

test('approval rolls back candidate materialization when provenance persistence fails', async () => {
  const calls = [];
  const client = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id, assistant_id, proposed_title/i.test(sql)) return { rows: [{ id: candidateId, assistant_id: null, proposed_title: 'Image fact', proposed_content: 'Redacted business fact', status: 'NEEDS_REVIEW', pii_redaction_status: 'PASSED', image_semantic_version: '1' }] };
    if (/primary_business_evidence_count/i.test(sql)) return { rows: [{ primary_business_evidence_count: 1, trusted_identity_count: 1 }] };
    if (/INSERT INTO knowledge_base_documents/i.test(sql)) return { rows: [{ id: 'would-be-source', tenant_id: tenantId, processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) return { rows: [{ id: 'job-1' }] };
    if (/INSERT INTO knowledge_materialized_source_provenance/i.test(sql)) throw Object.assign(new Error('provenance insert failed'), { code: '23503' });
    return { rows: [] };
  } };
  const database = { connect: async () => ({ ...client, release: () => {} }) };

  await assert.rejects(
    () => approveConversationKnowledgeCandidate({ database, tenantId, candidateId, reviewedBy: reviewerId }),
    { code: 'KNOWLEDGE_CANDIDATE_APPROVAL_FAILED' },
  );
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(calls.some(({ sql }) => /SET status = 'APPROVED'/i.test(sql)), false);
});

test('approval records only safe native database diagnostics after rollback', async () => {
  const diagnostics = [];
  const client = { async query(sql) {
    if (/SELECT id, assistant_id, proposed_title/i.test(sql)) return { rows: [{ id: candidateId, assistant_id: null, proposed_title: 'Image fact', proposed_content: 'Redacted business fact', status: 'NEEDS_REVIEW', pii_redaction_status: 'PASSED', image_semantic_version: '1' }] };
    if (/primary_business_evidence_count/i.test(sql)) return { rows: [{ primary_business_evidence_count: 1, trusted_identity_count: 1, original_source_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }] };
    if (/INSERT INTO knowledge_base_documents/i.test(sql)) return { rows: [{ id: 'would-be-source', tenant_id: tenantId, processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) return { rows: [{ id: 'job-1' }] };
    if (/INSERT INTO knowledge_materialized_source_provenance/i.test(sql)) {
      throw Object.assign(new Error('foreign key violation'), { code: '23503', constraint: 'fk_materialized_candidate_source', table: 'knowledge_materialized_source_provenance' });
    }
    return { rows: [] };
  } };
  const database = { connect: async () => ({ ...client, release: () => {} }) };

  await assert.rejects(
    () => approveConversationKnowledgeCandidate({
      database, tenantId, candidateId, reviewedBy: reviewerId,
      approvalFailureRecorder: async (diagnostic) => diagnostics.push(diagnostic),
    }),
    { code: 'KNOWLEDGE_CANDIDATE_APPROVAL_FAILED' },
  );

  assert.deepEqual(diagnostics, [{
    tenantId,
    candidateId,
    materializedSourceId: 'would-be-source',
    originalSourceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    phase: 'MATERIALIZED_SOURCE_PROVENANCE',
    databaseCode: '23503',
    constraintName: 'fk_materialized_candidate_source',
    tableName: 'knowledge_materialized_source_provenance',
  }]);
});

test('materialized provenance statement binds every UUID parameter explicitly', () => {
  const service = fs.readFileSync(new URL('../services/knowledge-candidate-service.js', import.meta.url), 'utf8');
  assert.match(service, /SELECT DISTINCT \$1::uuid, \$3::uuid, evidence\.candidate_id, evidence\.source_id/);
  assert.match(service, /evidence\.tenant_id = \$1::uuid AND evidence\.candidate_id = \$2::uuid/);
  assert.match(service, /SELECT DISTINCT \$1::uuid, \$3::uuid, COALESCE\(evidence\.business_identity_id, identity_link\.business_identity_id\)/);
  assert.match(service, /WHERE evidence\.tenant_id = \$1::uuid AND evidence\.candidate_id = \$2::uuid/);
});

test('already approved candidate cannot be approved again, preventing duplicate materialization', async () => {
  const client = { async query(sql) {
    if (/SELECT id, assistant_id, proposed_title/i.test(sql)) return { rows: [{ id: candidateId, status: 'APPROVED', pii_redaction_status: 'REDACTED' }] };
    return { rows: [] };
  } };
  const database = { connect: async () => ({ ...client, release: () => {} }) };
  await assert.rejects(() => approveConversationKnowledgeCandidate({ database, tenantId, candidateId, reviewedBy: reviewerId }), { code: 'KNOWLEDGE_CANDIDATE_NOT_APPROVABLE' });
});
