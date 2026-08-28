import { pathToFileURL } from 'node:url';

import { safeResultLine } from './staging-task6-e2e-support.js';

const STAGING_API_ORIGIN = 'https://samche-api-staging.onrender.com';
const TRANSIENT_HTTP = new Set([502, 503, 504]);

function normalizedBaseUrl(baseUrl, allowLocalForTest) {
  const parsed = new URL(baseUrl);
  if (!allowLocalForTest && parsed.origin !== STAGING_API_ORIGIN) throw new Error('TASK6_E2E_STAGING_API_REQUIRED');
  if (allowLocalForTest && !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('TASK6_E2E_TEST_API_INVALID');
  return parsed.origin;
}

export function createApiClient({ baseUrl = STAGING_API_ORIGIN, token, fetchImpl = fetch, allowLocalForTest = false, retryDelayMs = 1000 }) {
  const origin = normalizedBaseUrl(baseUrl, allowLocalForTest);
  if (!token) throw new Error('TASK6_E2E_AUTH_TOKEN_MISSING');

  async function request(path, { method = 'GET', body, headers = {}, attempts = 3 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(`${origin}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
          body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw new Error('STAGING_API_NETWORK_FAILED');
      }
      if (response.ok) {
        if (response.status === 204) return null;
        return response.json();
      }
      if (TRANSIENT_HTTP.has(response.status) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        continue;
      }
      throw new Error(`STAGING_API_HTTP_${response.status}`);
    }
    throw new Error('STAGING_API_RETRY_EXHAUSTED');
  }

  async function uploadSource({ tenantId, title, assistantIds, fixture }) {
    const form = new FormData();
    form.set('title', title);
    form.set('assistant_ids', JSON.stringify(assistantIds));
    form.set('file', new Blob([fixture.bytes], { type: fixture.mimeType }), fixture.filename);
    return request(`/api/v1/tenants/${tenantId}/knowledge-intelligence/sources/upload`, { method: 'POST', body: form });
  }

  return { request, uploadSource };
}

export async function querySourceEvidence({ database, tenantId, sourceId }) {
  const result = await database.query(
    `SELECT source.id, source.processing_status, source.indexing_status, source.storage_key,
            count(chunk.id)::integer AS chunk_count,
            count(chunk.id) FILTER (WHERE chunk.embedding IS NOT NULL)::integer AS vector_count
       FROM knowledge_base_documents source
       LEFT JOIN knowledge_chunks chunk
         ON chunk.tenant_id = source.tenant_id AND chunk.source_id = source.id AND chunk.is_active = TRUE
      WHERE source.tenant_id = $1 AND source.id = $2
      GROUP BY source.id`,
    [tenantId, sourceId]
  );
  if (result.rows.length !== 1) throw new Error('TASK6_E2E_SOURCE_EVIDENCE_MISSING');
  return { ...result.rows[0], chunk_count: Number(result.rows[0].chunk_count), vector_count: Number(result.rows[0].vector_count) };
}

async function main() {
  console.log(safeResultLine('FAIL', 'HARNESS', { status: 'TASK6_E2E_NOT_IMPLEMENTED' }));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
