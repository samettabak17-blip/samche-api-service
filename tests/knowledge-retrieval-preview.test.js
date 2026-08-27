import test from 'node:test';
import assert from 'node:assert/strict';
import { previewKnowledgeRetrieval } from '../services/knowledge-retrieval-preview.js';

test('previews tenant and assistant scoped retrieval with bounded safe excerpts', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'chunk-a', source_id: 'source-a', source_title: 'Hours', normalized_text: 'Open weekdays', similarity: '0.91' }] };
  } };
  const result = await previewKnowledgeRetrieval({
    database,
    embed: async () => Array.from({ length: 1536 }, () => 0.01),
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    query: 'When are you open?',
    limit: 3,
  });

  assert.deepEqual(result, { query: 'When are you open?', matches: [{ chunkId: 'chunk-a', sourceId: 'source-a', sourceTitle: 'Hours', excerpt: 'Open weekdays', similarity: 0.91 }] });
  assert.match(calls[0].sql, /k\.tenant_id = \$1/);
  assert.match(calls[0].sql, /ksa\.assistant_id = \$2/);
  assert.deepEqual(calls[0].params.slice(0, 2), ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
});

test('rejects empty preview queries before embedding or database access', async () => {
  let invoked = false;
  await assert.rejects(
    previewKnowledgeRetrieval({ database: { query: async () => { invoked = true; } }, embed: async () => { invoked = true; }, tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', assistantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', query: '   ' }),
    (error) => error.code === 'KNOWLEDGE_PREVIEW_QUERY_INVALID',
  );
  assert.equal(invoked, false);
});
