import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createKnowledgeGapKey,
  recordKnowledgeGap,
} from '../services/knowledge-gap-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const assistantId = '22222222-2222-4222-8222-222222222222';

test('knowledge gaps are tenant and assistant scoped, deduplicated, and redact PII before storage', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: '33333333-3333-4333-8333-333333333333', status: 'NEEDS_REVIEW', occurrence_count: 2 }], rowCount: 1 };
    },
  };

  const result = await recordKnowledgeGap({
    database,
    tenantId,
    assistantId,
    question: 'Where is my invoice? Contact me at customer@example.com or +90 555 123 45 67.',
    signalType: 'HUMAN_TAKEOVER',
  });

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, dedupe_key\)/);
  assert.equal(calls[0].params[0], tenantId);
  assert.equal(calls[0].params[1], assistantId);
  assert.doesNotMatch(calls[0].params[2], /customer@example\.com|555/);
  assert.match(calls[0].params[2], /\[redacted email\]/);
  assert.match(calls[0].sql, /'NEEDS_REVIEW'/);
  assert.equal(
    createKnowledgeGapKey({ assistantId, question: 'where is my invoice?' }),
    createKnowledgeGapKey({ assistantId, question: ' Where   is my invoice? ' }),
  );
});

test('knowledge gap recording never creates retrievable knowledge chunks or auto-approves raw conversation content', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../services/knowledge-gap-service.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /INSERT INTO knowledge_chunks/i);
  assert.doesNotMatch(source, /status\s*=\s*'APPROVED'/i);
  assert.match(source, /NEEDS_REVIEW/);
});

