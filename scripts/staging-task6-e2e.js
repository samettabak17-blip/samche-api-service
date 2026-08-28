import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';
import { recordVerifiedKnowledgeGapSignal } from '../services/knowledge-gap-signal-service.js';
import { whatsappIntegrationKey } from '../services/whatsapp-multimodal-service.js';
import {
  assertVerifiedTls, createDocxFixture, createPdfFixture, createRunMarker, createTxtFixture,
  pollUntil, safeResultLine, strictTlsConfig, writeFixtureState,
} from './staging-task6-e2e-support.js';

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

function requireEnvironment(names) {
  for (const name of names) if (!process.env[name]) throw new Error(`TASK6_E2E_ENV_MISSING_${name}`);
}

function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('TASK6_E2E_TOKEN_INVALID'); }
}

function assertCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function matchesFor(preview, sourceId) {
  return (preview?.preview?.matches ?? []).filter((match) => match.sourceId === sourceId);
}

async function persistState(path, state) {
  await writeFixtureState(path, state);
}

async function waitReady(api, database, tenantId, sourceId) {
  return pollUntil({
    operation: async () => {
      const response = await api.request(`/api/v1/tenants/${tenantId}/knowledge-intelligence/sources/${sourceId}`);
      if (['FAILED', 'DISABLED', 'ARCHIVED'].includes(response.source.processing_status)) throw new Error('TASK6_E2E_SOURCE_PROCESSING_FAILED');
      return response.source;
    },
    accept: (source) => source.processing_status === 'READY' && source.indexing_status === 'READY',
    reject: () => false, intervalMs: 3000, timeoutMs: 600_000, timeoutCode: 'TASK6_E2E_SOURCE_READY_TIMEOUT',
  }).then(async (source) => ({ source, evidence: await querySourceEvidence({ database, tenantId, sourceId }) }));
}

async function createTenantFixture({ ownerApi, adminApi, adminUserId, marker, suffix, state, statePath }) {
  const tenant = await ownerApi.request('/api/v1/tenants', { method: 'POST', body: { name: `${marker} tenant ${suffix}` } });
  state.tenantIds.push(tenant.id); await persistState(statePath, state);
  await ownerApi.request(`/api/v1/tenants/${tenant.id}/users`, { method: 'POST', body: { user_id: adminUserId, tenant_role: 'ADMIN' } });
  const assistantA = await adminApi.request(`/api/v1/tenants/${tenant.id}/assistants`, { method: 'POST', body: { name: `${marker} Assistant A`, system_prompt: 'Use approved tenant knowledge only.', model: 'gpt-4o-mini' } });
  const assistantB = await adminApi.request(`/api/v1/tenants/${tenant.id}/assistants`, { method: 'POST', body: { name: `${marker} Assistant B`, system_prompt: 'Use approved tenant knowledge only.', model: 'gpt-4o-mini' } });
  state.assistantIds.push(assistantA.id, assistantB.id); await persistState(statePath, state);
  const channel = await adminApi.request(`/api/v1/tenants/${tenant.id}/channels`, { method: 'POST', body: { channel_type: 'WEB_CHAT', display_name: `${marker} Evidence`, external_channel_id: `${marker}_${suffix}`, assistant_id: assistantA.id, status: 'active' } });
  state.channelIds.push(channel.id); await persistState(statePath, state);
  return { tenant, assistantA, assistantB, channel };
}

async function retrieval(api, tenantId, assistantId, query) {
  return api.request(`/api/v1/tenants/${tenantId}/knowledge-intelligence/assistants/${assistantId}/retrieval-preview`, { method: 'POST', body: { query, limit: 8 } });
}

async function sourceHashes(database, tenantId, sourceId) {
  const result = await database.query('SELECT text_hash FROM knowledge_chunks WHERE tenant_id = $1 AND source_id = $2 AND is_active = TRUE ORDER BY chunk_index', [tenantId, sourceId]);
  return result.rows.map((row) => row.text_hash);
}

export async function createNonReadyEvidenceSource({ database, tenantId, assistantId, readySourceId, marker }) {
  const title = `${marker} non-ready evidence`;
  const normalizedText = `${marker}_NON_READY must never be retrievable while processing is incomplete.`;
  const textHash = crypto.createHash('sha256').update(normalizedText).digest('hex');
  const source = await database.query(
    `INSERT INTO knowledge_base_documents
       (tenant_id, title, content, status, source_type, processing_status, indexing_status, enabled)
     VALUES ($1, $2, $3, 'active', 'MANUAL', 'PROCESSING', 'PENDING', TRUE)
     RETURNING id`,
    [tenantId, title, normalizedText],
  );
  const sourceId = source.rows[0].id;
  await database.query(
    'INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id) VALUES ($1, $2, $3)',
    [tenantId, sourceId, assistantId],
  );
  await database.query(
    `INSERT INTO knowledge_chunks
       (tenant_id, source_id, chunk_index, normalized_text, text_hash, token_estimate,
        embedding, embedding_provider, embedding_model, embedding_version, embedding_dimensions,
        index_status, is_active, metadata, indexed_at)
     SELECT $1, $2, 0, $3, $4, 20,
            embedding, embedding_provider, embedding_model, embedding_version, embedding_dimensions,
            'READY', TRUE, '{"fixture":"non-ready-exclusion"}'::jsonb, CURRENT_TIMESTAMP
       FROM knowledge_chunks
      WHERE tenant_id = $1 AND source_id = $5 AND embedding IS NOT NULL
      ORDER BY chunk_index
      LIMIT 1`,
    [tenantId, sourceId, normalizedText, textHash, readySourceId],
  );
  return sourceId;
}

async function safeFetchJson(path, options = {}) {
  const response = await fetch(`${STAGING_API_ORIGIN}${path}`, { ...options, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`STAGING_PUBLIC_HTTP_${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { text }; }
}

async function verifyChannelMappings({ database, adminApi, marker, state, statePath }) {
  const phoneKey = whatsappIntegrationKey(process.env.STAGING_WHATSAPP_PHONE_ID);
  const result = await database.query(
    `SELECT ci.integration_type, ci.integration_key, ci.tenant_id, ci.channel_id, ci.assistant_id
       FROM channel_integrations ci
      WHERE ci.enabled = TRUE AND (
        (ci.integration_type = 'WHATSAPP' AND ci.integration_key = $1)
        OR (ci.integration_type = 'SAMCHEGUIDE' AND ci.integration_key = 'SAMCHEGUIDE:staging')
        OR ci.integration_type = 'WEB_CHAT'
      )
      ORDER BY ci.integration_type`, [phoneKey],
  );
  const byType = Object.fromEntries(result.rows.map((row) => [row.integration_type, row]));
  for (const type of ['WHATSAPP', 'SAMCHEGUIDE']) assertCondition(byType[type], `TASK6_E2E_${type}_MAPPING_MISSING`);
  assertCondition(byType.WHATSAPP.tenant_id === byType.SAMCHEGUIDE.tenant_id, 'TASK6_E2E_CROSS_CHANNEL_TENANT_MISMATCH');
  if (!byType.WEB_CHAT) {
    const tenantId = byType.WHATSAPP.tenant_id;
    const assistantId = byType.WHATSAPP.assistant_id;
    const channel = await adminApi.request(`/api/v1/tenants/${tenantId}/channels`, {
      method: 'POST',
      body: { channel_type: 'WEB_CHAT', display_name: `${marker} Web Chat`, external_channel_id: `${marker}_web_chat`, assistant_id: assistantId, status: 'active' },
    });
    state.scopedTenantIds.push(tenantId);
    state.scopedChannelIds.push(channel.id);
    await persistState(statePath, state);
    const integration = await database.query(
      `INSERT INTO channel_integrations (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
       VALUES ($1, 'WEB_CHAT', $2, $3, $4, TRUE)
       RETURNING id, integration_type, integration_key, tenant_id, channel_id, assistant_id`,
      [`${marker}_widget`, tenantId, channel.id, assistantId],
    );
    byType.WEB_CHAT = integration.rows[0];
    state.scopedIntegrationIds.push(integration.rows[0].id);
    await persistState(statePath, state);
  }
  assertCondition(new Set(Object.values(byType).map((row) => row.tenant_id)).size === 1, 'TASK6_E2E_CROSS_CHANNEL_TENANT_MISMATCH');
  return byType;
}

async function main() {
  requireEnvironment([
    'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'STAGING_DATABASE_URL', 'STAGING_OWNER_TOKEN', 'STAGING_ADMIN_TOKEN',
    'STAGING_WHATSAPP_APP_SECRET', 'STAGING_WHATSAPP_E2E_RECIPIENT', 'STAGING_WHATSAPP_PHONE_ID', 'TASK6_E2E_STATE_PATH',
  ]);
  const marker = createRunMarker();
  const statePath = process.env.TASK6_E2E_STATE_PATH;
  const state = { marker, tenantIds: [], assistantIds: [], channelIds: [], integrationIds: [], sourceIds: [], scopedTenantIds: [], scopedChannelIds: [], scopedIntegrationIds: [], scopedSourceIds: [], scopedConversationIds: [], scopedMessageIds: [], scopedAuditIds: [], conversationIds: [], userIds: [], storageObjects: [] };
  await persistState(statePath, state);

  const ownerClaims = jwtClaims(process.env.STAGING_OWNER_TOKEN);
  const adminClaims = jwtClaims(process.env.STAGING_ADMIN_TOKEN);
  assertCondition(ownerClaims.system_role === 'OWNER', 'TASK6_E2E_OWNER_ROLE_INVALID');
  assertCondition(adminClaims.system_role === 'CUSTOMER' && adminClaims.user_id, 'TASK6_E2E_ADMIN_ROLE_INVALID');
  const ownerApi = createApiClient({ token: process.env.STAGING_OWNER_TOKEN });
  const adminApi = createApiClient({ token: process.env.STAGING_ADMIN_TOKEN });
  const database = new pg.Pool(strictTlsConfig(process.env.STAGING_DATABASE_URL));
  const probe = await database.connect();
  try { assertVerifiedTls(probe); } finally { probe.release(); }
  console.log(safeResultLine('PASS', 'STRICT_TLS', { status: 'VERIFIED' }));

  try {
    const fixtureA = await createTenantFixture({ ownerApi, adminApi, adminUserId: adminClaims.user_id, marker, suffix: 'A', state, statePath });
    const fixtureB = await createTenantFixture({ ownerApi, adminApi, adminUserId: adminClaims.user_id, marker, suffix: 'B', state, statePath });
    const documents = [createPdfFixture(marker), await createDocxFixture(marker), createTxtFixture(marker)];
    const readySources = [];
    const storage = createConversationResourceStorage();
    for (const document of documents) {
      const uploaded = await adminApi.uploadSource({ tenantId: fixtureA.tenant.id, title: `${marker} ${document.filename}`, assistantIds: [fixtureA.assistantA.id], fixture: document });
      state.sourceIds.push(uploaded.source.id); await persistState(statePath, state);
      const ready = await waitReady(adminApi, database, fixtureA.tenant.id, uploaded.source.id);
      assertCondition(ready.evidence.chunk_count > 0 && ready.evidence.vector_count === ready.evidence.chunk_count, 'TASK6_E2E_VECTOR_EVIDENCE_FAILED');
      assertCondition(String(ready.evidence.storage_key).startsWith(`knowledge/${fixtureA.tenant.id}/${uploaded.source.id}/`), 'TASK6_E2E_STORAGE_SCOPE_FAILED');
      await storage.head({ key: ready.evidence.storage_key });
      state.storageObjects.push({ tenantId: fixtureA.tenant.id, sourceId: uploaded.source.id, key: ready.evidence.storage_key }); await persistState(statePath, state);
      readySources.push({ document, id: uploaded.source.id, evidence: ready.evidence });
      console.log(safeResultLine('PASS', `${document.filename.split('.').pop().toUpperCase()}_INGESTION`, { format: document.mimeType, status: 'READY', source_id: uploaded.source.id, chunk_count: ready.evidence.chunk_count, vector_count: ready.evidence.vector_count }));
    }

    const positive = await retrieval(adminApi, fixtureA.tenant.id, fixtureA.assistantA.id, readySources[0].document.semanticMarker);
    assertCondition(matchesFor(positive, readySources[0].id).length > 0, 'TASK6_E2E_RETRIEVAL_FAILED');
    const assistantNegative = await retrieval(adminApi, fixtureA.tenant.id, fixtureA.assistantB.id, readySources[0].document.semanticMarker);
    const tenantNegative = await retrieval(adminApi, fixtureB.tenant.id, fixtureB.assistantA.id, readySources[0].document.semanticMarker);
    assertCondition(matchesFor(assistantNegative, readySources[0].id).length === 0, 'TASK6_E2E_ASSISTANT_ISOLATION_FAILED');
    assertCondition(matchesFor(tenantNegative, readySources[0].id).length === 0, 'TASK6_E2E_TENANT_ISOLATION_FAILED');
    console.log(safeResultLine('PASS', 'RETRIEVAL_ISOLATION', { status: 'SCOPED' }));

    const nonReadySourceId = await createNonReadyEvidenceSource({
      database, tenantId: fixtureA.tenant.id, assistantId: fixtureA.assistantA.id,
      readySourceId: readySources[0].id, marker,
    });
    state.sourceIds.push(nonReadySourceId); await persistState(statePath, state);
    assertCondition(matchesFor(await retrieval(adminApi, fixtureA.tenant.id, fixtureA.assistantA.id, `${marker}_NON_READY`), nonReadySourceId).length === 0, 'TASK6_E2E_NON_READY_EXCLUSION_FAILED');
    console.log(safeResultLine('PASS', 'NON_READY_EXCLUSION', { status: 'VERIFIED' }));

    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/sources/${readySources[0].id}/assignments/${fixtureA.assistantA.id}`, { method: 'DELETE' });
    assertCondition(matchesFor(await retrieval(adminApi, fixtureA.tenant.id, fixtureA.assistantA.id, readySources[0].document.semanticMarker), readySources[0].id).length === 0, 'TASK6_E2E_UNASSIGNMENT_FAILED');
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/sources/${readySources[0].id}/assignments`, { method: 'POST', body: { assistant_id: fixtureA.assistantA.id } });
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/sources/${readySources[2].id}/archive`, { method: 'POST', body: {} });
    assertCondition(matchesFor(await retrieval(adminApi, fixtureA.tenant.id, fixtureA.assistantA.id, readySources[2].document.semanticMarker), readySources[2].id).length === 0, 'TASK6_E2E_ARCHIVE_EXCLUSION_FAILED');
    const beforeHashes = await sourceHashes(database, fixtureA.tenant.id, readySources[1].id);
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/sources/${readySources[1].id}/reindex`, { method: 'POST', body: {} });
    await waitReady(adminApi, database, fixtureA.tenant.id, readySources[1].id);
    assertCondition(JSON.stringify(beforeHashes) === JSON.stringify(await sourceHashes(database, fixtureA.tenant.id, readySources[1].id)), 'TASK6_E2E_REINDEX_IDEMPOTENCY_FAILED');
    console.log(safeResultLine('PASS', 'ASSIGN_ARCHIVE_REINDEX', { status: 'VERIFIED' }));

    const conversation = await database.query(`INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id) VALUES ($1, $2, $3, $3) RETURNING id`, [fixtureA.tenant.id, fixtureA.channel.id, `${marker}_gap`]);
    const message = await database.query(`INSERT INTO conversation_messages (tenant_id, conversation_id, external_message_id, sender_type, content) VALUES ($1, $2, $3, 'CUSTOMER', $4) RETURNING id, created_at`, [fixtureA.tenant.id, conversation.rows[0].id, `${marker}_gap_message`, `contact me at test@example.com about ${marker}_CANDIDATE`]);
    state.conversationIds.push(conversation.rows[0].id); await persistState(statePath, state);
    const gapArgs = { database, tenantId: fixtureA.tenant.id, assistantId: fixtureA.assistantA.id, conversationId: conversation.rows[0].id, messageId: message.rows[0].id, channelType: 'WEB_CHAT', signalType: 'MISSING_KNOWLEDGE_CONFIRMED', question: `contact me at test@example.com about ${marker.toLowerCase()}_candidate` };
    const gapFirst = await recordVerifiedKnowledgeGapSignal(gapArgs);
    const gapSecond = await recordVerifiedKnowledgeGapSignal(gapArgs);
    assertCondition(gapFirst.id === gapSecond.id && Number(gapSecond.occurrence_count) === 2, 'TASK6_E2E_GAP_DEDUPE_FAILED');
    const candidateMarker = `${marker}_CANDIDATE`;
    const preApproval = await retrieval(adminApi, fixtureA.tenant.id, fixtureA.assistantA.id, candidateMarker);
    assertCondition(!(preApproval.preview?.matches ?? []).some((match) => String(match.excerpt).includes(candidateMarker)), 'TASK6_E2E_CANDIDATE_PREAPPROVAL_RETRIEVABLE');
    const candidateResponse = await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/gaps/${gapFirst.id}/candidate`, { method: 'POST', body: { title: `${marker} candidate`, content: `${candidateMarker} means the violet harbor protocol. Contact test@example.com.` } });
    assertCondition(candidateResponse.candidate.status === 'NEEDS_REVIEW', 'TASK6_E2E_CANDIDATE_GATE_FAILED');
    const candidateRow = await database.query('SELECT pii_redaction_status, proposed_content FROM knowledge_candidates WHERE id = $1 AND tenant_id = $2', [candidateResponse.candidate.id, fixtureA.tenant.id]);
    assertCondition(candidateRow.rows[0].pii_redaction_status === 'REDACTED' && !candidateRow.rows[0].proposed_content.includes('test@example.com'), 'TASK6_E2E_PII_REDACTION_FAILED');
    const approvedCandidate = await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/candidates/${candidateResponse.candidate.id}/approve`, { method: 'POST', body: {} });
    state.sourceIds.push(approvedCandidate.source.id); await persistState(statePath, state);
    await waitReady(adminApi, database, fixtureA.tenant.id, approvedCandidate.source.id);
    assertCondition(matchesFor(await retrieval(adminApi, fixtureA.tenant.id, fixtureA.assistantA.id, candidateMarker), approvedCandidate.source.id).length > 0, 'TASK6_E2E_CANDIDATE_APPROVAL_RETRIEVAL_FAILED');
    console.log(safeResultLine('PASS', 'GAP_CANDIDATE', { status: 'APPROVED_RETRIEVABLE' }));

    const profile1 = (await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/generate`, { method: 'POST', body: {} })).profile;
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/${profile1.id}`, { method: 'PUT', body: { profile_data: { summary: `${marker} reviewed profile one` } } });
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/${profile1.id}/approve`, { method: 'POST', body: {} });
    let profilePointer = await database.query('SELECT active_version_id FROM business_profiles WHERE tenant_id = $1', [fixtureA.tenant.id]);
    assertCondition(profilePointer.rows[0].active_version_id === null, 'TASK6_E2E_PROFILE_APPROVAL_ACTIVATED_RUNTIME');
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/${profile1.id}/activate`, { method: 'POST', body: {} });
    const profile2 = (await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/generate`, { method: 'POST', body: {} })).profile;
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/${profile2.id}`, { method: 'PUT', body: { profile_data: { summary: `${marker} reviewed profile two` } } });
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/${profile2.id}/approve`, { method: 'POST', body: {} });
    profilePointer = await database.query('SELECT active_version_id FROM business_profiles WHERE tenant_id = $1', [fixtureA.tenant.id]);
    assertCondition(profilePointer.rows[0].active_version_id === profile1.id, 'TASK6_E2E_APPROVED_EQUALS_ACTIVE_REGRESSION');
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/${profile2.id}/activate`, { method: 'POST', body: {} });
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/profiles/${profile1.id}/rollback`, { method: 'POST', body: {} });
    profilePointer = await database.query('SELECT active_version_id FROM business_profiles WHERE tenant_id = $1', [fixtureA.tenant.id]);
    assertCondition(profilePointer.rows[0].active_version_id === profile1.id, 'TASK6_E2E_PROFILE_ROLLBACK_FAILED');
    const provenance = await database.query(`SELECT count(*)::integer AS count FROM knowledge_generation_runs WHERE tenant_id = $1 AND target_type = 'BUSINESS_PROFILE' AND status = 'SUCCEEDED' AND provider = 'GEMINI' AND model = 'gemini-3-flash-preview'`, [fixtureA.tenant.id]);
    assertCondition(provenance.rows[0].count >= 2, 'TASK6_E2E_PROFILE_PROVENANCE_FAILED');
    console.log(safeResultLine('PASS', 'BUSINESS_PROFILE_LIFECYCLE', { status: 'APPROVED_ACTIVE_ROLLBACK' }));

    async function generateConfiguration(sequence) {
      const recommendation = (await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/recommendations/generate`, { method: 'POST', body: {} })).recommendation;
      await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/recommendations/${recommendation.id}/approve`, { method: 'POST', body: {} });
      const configuration = (await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/configurations/generate`, { method: 'POST', body: { recommendation_id: recommendation.id } })).configuration;
      await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/configurations/${configuration.id}`, { method: 'PUT', body: { configuration_data: { instruction: `${marker} configuration ${sequence}` } } });
      await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/configurations/${configuration.id}/approve`, { method: 'POST', body: {} });
      return configuration;
    }
    const config1 = await generateConfiguration(1);
    let configPointer = await database.query('SELECT active_configuration_version_id FROM ai_assistants WHERE id = $1 AND tenant_id = $2', [fixtureA.assistantA.id, fixtureA.tenant.id]);
    assertCondition(configPointer.rows[0].active_configuration_version_id === null, 'TASK6_E2E_CONFIGURATION_APPROVAL_ACTIVATED_RUNTIME');
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/configurations/${config1.id}/activate`, { method: 'POST', body: {} });
    const config2 = await generateConfiguration(2);
    configPointer = await database.query('SELECT active_configuration_version_id FROM ai_assistants WHERE id = $1 AND tenant_id = $2', [fixtureA.assistantA.id, fixtureA.tenant.id]);
    assertCondition(configPointer.rows[0].active_configuration_version_id === config1.id, 'TASK6_E2E_CONFIGURATION_APPROVED_EQUALS_ACTIVE');
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/configurations/${config2.id}/activate`, { method: 'POST', body: {} });
    await adminApi.request(`/api/v1/tenants/${fixtureA.tenant.id}/knowledge-intelligence/assistants/${fixtureA.assistantA.id}/configurations/${config1.id}/rollback`, { method: 'POST', body: {} });
    configPointer = await database.query('SELECT active_configuration_version_id FROM ai_assistants WHERE id = $1 AND tenant_id = $2', [fixtureA.assistantA.id, fixtureA.tenant.id]);
    assertCondition(configPointer.rows[0].active_configuration_version_id === config1.id, 'TASK6_E2E_CONFIGURATION_ROLLBACK_FAILED');
    console.log(safeResultLine('PASS', 'CONFIGURATION_LIFECYCLE', { status: 'APPROVED_ACTIVE_ROLLBACK' }));

    const mappings = await verifyChannelMappings({ database, adminApi, marker, state, statePath });
    const sharedTenantId = mappings.WHATSAPP.tenant_id;
    const sharedAssistantIds = [...new Set(Object.values(mappings).map((row) => row.assistant_id))];
    const channelMarker = `${marker}_CHANNEL`;
    const shared = await adminApi.request(`/api/v1/tenants/${sharedTenantId}/knowledge-intelligence/sources/manual`, { method: 'POST', body: { title: `${marker} cross-channel`, content: `${channelMarker} identifies the cobalt lantern protocol.`, assistant_ids: sharedAssistantIds } });
    state.scopedTenantIds.push(sharedTenantId); state.scopedSourceIds.push(shared.source.id); await persistState(statePath, state);
    await waitReady(adminApi, database, sharedTenantId, shared.source.id);
    for (const mapping of Object.values(mappings)) assertCondition(matchesFor(await retrieval(adminApi, sharedTenantId, mapping.assistant_id, channelMarker), shared.source.id).length > 0, 'TASK6_E2E_CHANNEL_RETRIEVAL_SCOPE_FAILED');

    const recipient = process.env.STAGING_WHATSAPP_E2E_RECIPIENT;
    const channelStartedAt = new Date().toISOString();
    assertCondition(/^\d{7,20}$/.test(recipient), 'TASK6_E2E_WHATSAPP_RECIPIENT_INVALID');
    const webhookBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: marker, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: process.env.STAGING_WHATSAPP_PHONE_ID }, contacts: [{ wa_id: recipient, profile: { name: 'Task 6 E2E' } }], messages: [{ from: recipient, id: `wamid.${marker}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: `What protocol does ${channelMarker} identify?` } }] } }] }] });
    const signature = `sha256=${crypto.createHmac('sha256', process.env.STAGING_WHATSAPP_APP_SECRET).update(webhookBody).digest('hex')}`;
    await safeFetchJson('/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: webhookBody });
    const whatsAppConversation = await pollUntil({ operation: async () => database.query(`SELECT c.id FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id WHERE c.tenant_id = $1 AND m.external_message_id = $2 LIMIT 1`, [sharedTenantId, `wamid.${marker}`]), accept: (result) => result.rowCount === 1, reject: () => false, intervalMs: 2000, timeoutMs: 120_000, timeoutCode: 'TASK6_E2E_WHATSAPP_INBOUND_TIMEOUT' });
    const conversationId = whatsAppConversation.rows[0].id;
    const aiReply = await pollUntil({ operation: async () => database.query(`SELECT content FROM conversation_messages WHERE tenant_id = $1 AND conversation_id = $2 AND sender_type = 'ASSISTANT' AND created_at > CURRENT_TIMESTAMP - interval '5 minutes' ORDER BY created_at DESC LIMIT 1`, [sharedTenantId, conversationId]), accept: (result) => /cobalt lantern/i.test(result.rows[0]?.content ?? ''), reject: () => false, intervalMs: 3000, timeoutMs: 180_000, timeoutCode: 'TASK6_E2E_WHATSAPP_RESPONSE_TIMEOUT' });
    assertCondition(aiReply.rowCount === 1, 'TASK6_E2E_WHATSAPP_RESPONSE_FAILED');
    await adminApi.request(`/api/v1/tenants/${sharedTenantId}/conversations/${conversationId}/takeover`, { method: 'POST', body: {} });
    const beforeSuppressed = await database.query(`SELECT count(*)::integer AS count FROM conversation_messages WHERE tenant_id = $1 AND conversation_id = $2 AND sender_type = 'ASSISTANT'`, [sharedTenantId, conversationId]);
    const suppressedBody = webhookBody.replace(`wamid.${marker}`, `wamid.${marker}.suppressed`).replace(`What protocol does ${channelMarker} identify?`, `Repeat ${channelMarker}`);
    const suppressedSignature = `sha256=${crypto.createHmac('sha256', process.env.STAGING_WHATSAPP_APP_SECRET).update(suppressedBody).digest('hex')}`;
    await safeFetchJson('/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': suppressedSignature }, body: suppressedBody });
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const afterSuppressed = await database.query(`SELECT count(*)::integer AS count FROM conversation_messages WHERE tenant_id = $1 AND conversation_id = $2 AND sender_type = 'ASSISTANT'`, [sharedTenantId, conversationId]);
    assertCondition(afterSuppressed.rows[0].count === beforeSuppressed.rows[0].count, 'TASK6_E2E_HUMAN_TAKEOVER_SUPPRESSION_FAILED');
    await adminApi.request(`/api/v1/tenants/${sharedTenantId}/conversations/${conversationId}/return-to-ai`, { method: 'POST', body: {} });
    const whatsappArtifacts = await database.query(`SELECT id FROM conversation_messages WHERE tenant_id = $1 AND conversation_id = $2 AND created_at >= $3::timestamptz`, [sharedTenantId, conversationId, channelStartedAt]);
    const whatsappAudits = await database.query(`SELECT id FROM conversation_audit_events WHERE tenant_id = $1 AND conversation_id = $2 AND created_at >= $3::timestamptz`, [sharedTenantId, conversationId, channelStartedAt]);
    state.scopedMessageIds.push(...whatsappArtifacts.rows.map((row) => row.id));
    state.scopedAuditIds.push(...whatsappAudits.rows.map((row) => row.id)); await persistState(statePath, state);
    console.log(safeResultLine('PASS', 'WHATSAPP_KNOWLEDGE_HTO', { status: 'RETRIEVED_SUPPRESSED_RETURNED' }));

    const guide = await safeFetchJson('/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': marker }, body: JSON.stringify({ text: `What protocol does ${channelMarker} identify?` }) });
    assertCondition(/cobalt lantern/i.test(guide?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''), 'TASK6_E2E_AI_GUIDE_RESPONSE_FAILED');
    const guideConversation = await database.query(`SELECT DISTINCT c.id FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id WHERE c.tenant_id = $1 AND c.channel_id = $2 AND m.content LIKE $3 AND c.created_at >= $4::timestamptz`, [sharedTenantId, mappings.SAMCHEGUIDE.channel_id, `%${marker}%`, channelStartedAt]);
    assertCondition(guideConversation.rowCount === 1, 'TASK6_E2E_AI_GUIDE_CONVERSATION_EVIDENCE_FAILED');
    state.scopedConversationIds.push(guideConversation.rows[0].id); await persistState(statePath, state);
    const bootstrap = await safeFetchJson('/api/chat/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ widget_key: mappings.WEB_CHAT.integration_key }) });
    const web = await safeFetchJson('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-samche-web-chat-session': bootstrap.session }, body: JSON.stringify({ message: `What protocol does ${channelMarker} identify?` }) });
    assertCondition(/cobalt lantern/i.test(JSON.stringify(web)), 'TASK6_E2E_WEB_CHAT_RESPONSE_FAILED');
    const webConversation = await database.query(`SELECT DISTINCT c.id FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id WHERE c.tenant_id = $1 AND c.channel_id = $2 AND m.content LIKE $3 AND c.created_at >= $4::timestamptz`, [sharedTenantId, mappings.WEB_CHAT.channel_id, `%${marker}%`, channelStartedAt]);
    assertCondition(webConversation.rowCount === 1, 'TASK6_E2E_WEB_CHAT_CONVERSATION_EVIDENCE_FAILED');
    state.scopedConversationIds.push(webConversation.rows[0].id); await persistState(statePath, state);
    console.log(safeResultLine('PASS', 'CROSS_CHANNEL', { status: 'WHATSAPP_AI_GUIDE_WEB_CHAT' }));
    console.log(safeResultLine('PASS', 'TASK6_E2E', { status: 'COMPLETE' }));
  } finally {
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = String(error?.message ?? '');
    const safeCode = /^(TASK6_E2E|STAGING_API|STAGING_PUBLIC|TLS_VERIFICATION_FAILED)/.test(message) ? message : 'TASK6_E2E_FAILED';
    console.error(safeResultLine('FAIL', 'TASK6_E2E', { status: safeCode }));
    process.exitCode = 1;
  });
}
