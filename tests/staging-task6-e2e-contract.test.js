import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createApiClient, createNonReadyEvidenceSource, normalizeStagingRecipient, querySourceEvidence } from '../scripts/staging-task6-e2e.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('API client attaches bearer auth without exposing it in errors', async () => {
  const token = 'secret-owner-token';
  await withServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `do not leak ${token}` }));
  }, async (baseUrl) => {
    const api = createApiClient({ baseUrl, token, allowLocalForTest: true });
    await assert.rejects(api.request('/failure'), (error) => {
      assert.equal(error.message, 'STAGING_API_HTTP_400');
      assert.doesNotMatch(error.message, /secret-owner-token/);
      return true;
    });
  });
});

test('API client retries only transient Render failures', async () => {
  let requests = 0;
  await withServer((_request, response) => {
    requests += 1;
    response.writeHead(requests < 3 ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  }, async (baseUrl) => {
    const api = createApiClient({ baseUrl, token: 'test', allowLocalForTest: true, retryDelayMs: 1 });
    assert.deepEqual(await api.request('/retry'), { ok: true });
    assert.equal(requests, 3);
  });
});

test('multipart upload matches the deployed Knowledge Intelligence route contract', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/v1/tenants/tenant-a/knowledge-intelligence/sources/upload');
    assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('latin1');
    assert.match(body, /name="title"/);
    assert.match(body, /name="assistant_ids"/);
    assert.match(body, /name="file"; filename="task6-e2e.txt"/);
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ source: { id: 'source-a' } }));
  }, async (baseUrl) => {
    const api = createApiClient({ baseUrl, token: 'test', allowLocalForTest: true });
    const result = await api.uploadSource({ tenantId: 'tenant-a', title: 'marker title', assistantIds: ['assistant-a'], fixture: { filename: 'task6-e2e.txt', mimeType: 'text/plain', bytes: Buffer.from('marker') } });
    assert.equal(result.source.id, 'source-a');
  });
});

test('DB evidence returns vector presence and count without selecting raw embeddings', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[1], processing_status: 'READY', indexing_status: 'READY', chunk_count: '2', vector_count: '2', storage_key: 'knowledge/t/s/a.txt' }] };
  } };
  const evidence = await querySourceEvidence({ database, tenantId: 'tenant-a', sourceId: 'source-a' });
  assert.equal(evidence.vector_count, 2);
  assert.match(calls[0].sql, /embedding IS NOT NULL/);
  assert.doesNotMatch(calls[0].sql, /SELECT[\s\S]*\bembedding\s*(?:,|FROM)/i);
  assert.deepEqual(calls[0].params, ['tenant-a', 'source-a']);
});

test('non-ready evidence fixture remains marker-owned, assigned, and PROCESSING', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/RETURNING id/.test(sql)) return { rows: [{ id: 'source-processing' }] };
    return { rows: [], rowCount: 1 };
  } };
  const sourceId = await createNonReadyEvidenceSource({
    database,
    tenantId: 'tenant-a',
    assistantId: 'assistant-a',
    readySourceId: 'source-ready',
    marker: 'TASK6_E2E_123_1',
  });
  assert.equal(sourceId, 'source-processing');
  assert.match(calls[0].sql, /processing_status, indexing_status/);
  assert.match(calls[0].sql, /'PROCESSING', 'PENDING'/);
  assert.match(calls[1].sql, /knowledge_source_assistants/);
  assert.match(calls[2].sql, /INSERT INTO knowledge_chunks/);
  assert.deepEqual(calls[0].params.slice(0, 2), ['tenant-a', 'TASK6_E2E_123_1 non-ready evidence']);
});

test('staging recipient accepts only canonical digits with an optional leading plus', () => {
  assert.equal(normalizeStagingRecipient('+971501234567'), '971501234567');
  assert.equal(normalizeStagingRecipient('971501234567'), '971501234567');
  assert.throws(() => normalizeStagingRecipient('+971 50 123 4567'), /TASK6_E2E_WHATSAPP_RECIPIENT_INVALID/);
  assert.throws(() => normalizeStagingRecipient('customer-number'), /TASK6_E2E_WHATSAPP_RECIPIENT_INVALID/);
});
