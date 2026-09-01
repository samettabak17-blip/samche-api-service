import test from 'node:test';
import assert from 'node:assert/strict';
import { approveConversationKnowledgeCandidate } from '../services/knowledge-candidate-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const candidateId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reviewerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('explicit approval materializes only redacted candidate text through the canonical source path', async () => {
  const calls = [];
  const database = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id, assistant_id, proposed_title/i.test(sql)) return { rows: [{ id: candidateId, assistant_id: null, proposed_title: 'Image fact', proposed_content: 'Redacted business fact', status: 'NEEDS_REVIEW', pii_redaction_status: 'REDACTED' }] };
    if (/INSERT INTO knowledge_base_documents/i.test(sql)) return { rows: [{ id: 'approved-source', tenant_id: tenantId, processing_status: 'UPLOADED', indexing_status: 'PENDING' }] };
    if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) return { rows: [{ id: 'job-1' }] };
    return { rows: [] };
  } };
  const source = await approveConversationKnowledgeCandidate({ database, tenantId, candidateId, reviewedBy: reviewerId });
  assert.equal(source.id, 'approved-source');
  const sourceInsert = calls.find(({ sql }) => /INSERT INTO knowledge_base_documents/i.test(sql));
  assert.equal(sourceInsert.params[4], 'CONVERSATION_CANDIDATE');
  assert.equal(sourceInsert.params[3], 'Redacted business fact');
  assert.ok(calls.some(({ sql }) => /INSERT INTO knowledge_source_business_identities/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /INSERT INTO knowledge_materialized_source_provenance/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /knowledge_candidate_image_evidence/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /SET status = 'APPROVED'/i.test(sql)));
});

test('already approved candidate cannot be approved again, preventing duplicate materialization', async () => {
  const database = { async query(sql) {
    if (/SELECT id, assistant_id, proposed_title/i.test(sql)) return { rows: [{ id: candidateId, status: 'APPROVED', pii_redaction_status: 'REDACTED' }] };
    return { rows: [] };
  } };
  await assert.rejects(() => approveConversationKnowledgeCandidate({ database, tenantId, candidateId, reviewedBy: reviewerId }), { code: 'KNOWLEDGE_CANDIDATE_NOT_APPROVABLE' });
});
