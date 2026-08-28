import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuggestedCandidateFromKnowledgeGap } from '../services/knowledge-gap-candidate-service.js';

test('a gap creates only a tenant-scoped NEEDS_REVIEW candidate with signal evidence', async () => {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    if (/FROM knowledge_gaps/.test(sql)) return { rows: [{ id: '33333333-3333-4333-8333-333333333333', assistant_id: '22222222-2222-4222-8222-222222222222', normalized_question: 'policy question' }], rowCount: 1 };
    if (/FROM knowledge_gap_signals/.test(sql)) return { rows: [{ conversation_id: '44444444-4444-4444-8444-444444444444', message_id: '55555555-5555-4555-8555-555555555555', channel_type: 'WHATSAPP', created_at: '2026-01-01T00:00:00.000Z' }], rowCount: 1 };
    if (/SELECT 1/.test(sql)) return { rows: [{}], rowCount: 1 };
    if (/INSERT INTO knowledge_candidates/.test(sql)) return { rows: [{ id: '66666666-6666-4666-8666-666666666666', status: 'NEEDS_REVIEW' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const result = await createSuggestedCandidateFromKnowledgeGap({ database, tenantId: '11111111-1111-4111-8111-111111111111', gapId: '33333333-3333-4333-8333-333333333333', title: 'Renewal policy', content: 'Use the approved renewal policy.', createdBy: '77777777-7777-4777-8777-777777777777' });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(calls.some(({ sql }) => /WHERE id = \$1 AND tenant_id = \$2/.test(sql)));
  assert.ok(calls.some(({ sql }) => /lower\(regexp_replace\(redacted_question/.test(sql)));
  assert.ok(calls.some(({ sql }) => /UPDATE knowledge_gaps/.test(sql)));
});

