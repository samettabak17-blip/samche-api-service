import { createHash } from 'node:crypto';
import pg from 'pg';
import { createApiClient } from './staging-task6-e2e.js';
import { createSyntheticTextPng } from './staging-gemini-image-knowledge-probe.js';

const STAGING_API_ORIGIN = 'https://samche-api-staging.onrender.com';
const documentText = `Company Overview
Blue Dune Event Management LLC is a Dubai-based corporate event management company.

Office
Office 512, Marina Plaza, Dubai, UAE.

Business Hours
Monday to Friday: 09:00–18:00
Saturday: 10:00–15:00
Sunday: Closed

Core Services
- Corporate event planning
- Venue coordination
- Supplier and vendor management
- Attendee registration management
- On-site event operations
- Corporate conference coordination

Booking Policy
New event bookings require a minimum lead time of 10 business days.

Payment Policy
A 40% booking deposit is required to confirm an event.

Cancellation Policy
- More than 14 days before event: 70% of paid deposit refundable.
- 7–14 days: 30% refundable.
- Less than 7 days: deposit non-refundable.

Escalation Procedure
Blue Dune uses the Falcon Gate Protocol.
An unresolved critical event-operation issue must be escalated to the Operations Director after 2 hours.

Service Limitations
Blue Dune does not provide catering directly.
Catering may be coordinated through approved third-party suppliers.`;

function strictTlsConfig(rawUrl) {
  const url = new URL(rawUrl);
  return { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), ssl: { rejectUnauthorized: true, servername: url.hostname } };
}

function adminUserId(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).user_id; }
  catch { throw new Error('COMPANY_B_ADMIN_TOKEN_INVALID'); }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForSource(api, tenantId, sourceId, expectedIndexing) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await api.request(`/api/v1/tenants/${tenantId}/knowledge-intelligence/sources/${sourceId}`);
    const source = response.source;
    if (['FAILED', 'DISABLED', 'ARCHIVED'].includes(source.processing_status)) throw new Error(`COMPANY_B_SOURCE_${source.processing_status}`);
    if (source.processing_status === 'READY' && source.indexing_status === expectedIndexing) return source;
    await sleep(3_000);
  }
  throw new Error('COMPANY_B_SOURCE_READY_TIMEOUT');
}

function safeError(error) {
  const message = String(error?.message || 'COMPANY_B_SETUP_FAILED');
  return /^(?:COMPANY_B|STAGING_API_HTTP|STAGING_API_NETWORK)/.test(message) ? message : 'COMPANY_B_SETUP_FAILED';
}

async function main() {
  if (!process.env.STAGING_DATABASE_URL || !process.env.STAGING_OWNER_TOKEN || !process.env.STAGING_ADMIN_TOKEN) throw new Error('COMPANY_B_SETUP_ENV_MISSING');
  const database = new pg.Pool(strictTlsConfig(process.env.STAGING_DATABASE_URL));
  try {
    const client = await database.connect();
    try {
      if (client.connection.stream.encrypted !== true || client.connection.stream.authorized !== true) throw new Error('COMPANY_B_TLS_REQUIRED');
    } finally { client.release(); }
    const ownerApi = createApiClient({ baseUrl: STAGING_API_ORIGIN, token: process.env.STAGING_OWNER_TOKEN });
    const adminApi = createApiClient({ baseUrl: STAGING_API_ORIGIN, token: process.env.STAGING_ADMIN_TOKEN });
    const tenant = await ownerApi.request('/api/v1/tenants', { method: 'POST', body: { name: 'Blue Dune Event Management LLC' } });
    const tenantId = tenant.id;
    await ownerApi.request(`/api/v1/tenants/${tenantId}/users`, { method: 'POST', body: { user_id: adminUserId(process.env.STAGING_ADMIN_TOKEN), tenant_role: 'ADMIN' } });
    const assistant = await adminApi.request(`/api/v1/tenants/${tenantId}/assistants`, { method: 'POST', body: { name: 'WhatsApp Chatbot', system_prompt: 'Use approved tenant knowledge only.', model: 'gpt-4o-mini' } });
    const identity = await adminApi.request(`/api/v1/tenants/${tenantId}/knowledge-intelligence/business-identities`, { method: 'POST', body: { display_name: 'Blue Dune Event Management LLC' } });
    const upload = async ({ title, filename, mimeType, bytes }) => {
      const form = new FormData();
      form.set('title', title); form.set('assistant_ids', JSON.stringify([assistant.id]));
      form.set('file', new Blob([bytes], { type: mimeType }), filename);
      return adminApi.request(`/api/v1/tenants/${tenantId}/knowledge-intelligence/sources/upload`, { method: 'POST', body: form });
    };
    const document = await upload({ title: 'Blue Dune handbook', filename: 'blue-dune-handbook.txt', mimeType: 'text/plain', bytes: Buffer.from(documentText) });
    const imageBytes = createSyntheticTextPng(['CUSTOMER:', 'DO YOU ORGANIZE OUTDOOR CORPORATE EVENTS?', 'BUSINESS:', 'YES. OUTDOOR CORPORATE EVENTS ARE AVAILABLE FROM OCTOBER THROUGH APRIL.', 'CUSTOMER:', 'WHAT IS THE MINIMUM STANDARD EVENT SIZE?', 'BUSINESS:', 'STANDARD CORPORATE EVENT PACKAGES REQUIRE AT LEAST 25 ATTENDEES.', 'CUSTOMER:', 'MY EMAIL IS TEST.CUSTOMER@EXAMPLE.COM', 'BUSINESS:', 'REMAINING BALANCE IS DUE AT LEAST 3 BUSINESS DAYS BEFORE THE EVENT. CONTACT COORDINATOR@EXAMPLE.COM.', 'UNKNOWN:', 'FORWARDED MESSAGE']);
    const image = await upload({ title: 'Blue Dune conversation evidence', filename: 'blue-dune-conversation.png', mimeType: 'image/png', bytes: imageBytes });
    await waitForSource(adminApi, tenantId, document.source.id, 'READY');
    await waitForSource(adminApi, tenantId, image.source.id, 'DISABLED');
    const imageEvidence = await database.query(
      `SELECT source.extraction_hash, source.processing_status, source.indexing_status,
              count(segment.id)::integer AS segment_count,
              array_agg(DISTINCT segment.role ORDER BY segment.role) FILTER (WHERE segment.role IS NOT NULL) AS roles
         FROM knowledge_base_documents source
         LEFT JOIN knowledge_source_extraction_segments segment ON segment.tenant_id = source.tenant_id AND segment.source_id = source.id AND segment.is_current = TRUE
        WHERE source.tenant_id = $1 AND source.id = $2
        GROUP BY source.id`, [tenantId, image.source.id]);
    const evidence = imageEvidence.rows[0];
    if (!evidence?.extraction_hash || evidence.processing_status !== 'READY' || evidence.indexing_status !== 'DISABLED') throw new Error('COMPANY_B_IMAGE_PIPELINE_INVALID');
    const candidates = await adminApi.request(`/api/v1/tenants/${tenantId}/knowledge-intelligence/sources/${image.source.id}/candidates/generate`, { method: 'POST', body: { assistant_id: assistant.id, extraction_hash: evidence.extraction_hash, candidate_type: 'POLICY' } });
    const ids = (candidates.candidates ?? []).map((candidate) => candidate.id);
    if (!ids.length || !(candidates.candidates ?? []).every((candidate) => candidate.status === 'NEEDS_REVIEW')) throw new Error('COMPANY_B_IMAGE_CANDIDATE_NOT_REVIEWABLE');
    const candidateSafety = await database.query(
      `SELECT count(*)::integer AS candidate_count,
              bool_and(status = 'NEEDS_REVIEW') AS all_needs_review,
              bool_or(proposed_content ILIKE '%test.customer@example.com%' OR proposed_content ILIKE '%coordinator@example.com%') AS pii_leaked
         FROM knowledge_candidates WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
    const safety = candidateSafety.rows[0];
    if (!safety.all_needs_review || safety.pii_leaked) throw new Error('COMPANY_B_IMAGE_CANDIDATE_SAFETY_FAILED');
    console.log(JSON.stringify({ classification: 'SUCCESS', tenant_id: tenantId, assistant_id: assistant.id, business_identity_id: identity.business_identity.id, document_source_id: document.source.id, image_source_id: image.source.id, image_processing_status: evidence.processing_status, image_indexing_status: evidence.indexing_status, image_extraction_hash_prefix: String(evidence.extraction_hash).slice(0, 12), image_segment_count: Number(evidence.segment_count), image_role_summary: evidence.roles ?? [], candidate_ids: ids, candidate_count: Number(safety.candidate_count), candidates_need_review: Boolean(safety.all_needs_review), pii_redaction_safe: !safety.pii_leaked, image_source_hash_prefix: createHash('sha256').update(imageBytes).digest('hex').slice(0, 12) }));
  } finally { await database.end(); }
}

main().catch((error) => { console.log(JSON.stringify({ classification: safeError(error) })); process.exitCode = 1; });
