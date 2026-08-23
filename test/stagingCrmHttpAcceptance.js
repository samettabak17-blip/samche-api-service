// Manual Task 2 acceptance harness. It targets only the staging API and creates
// disposable records through the already verified fixture lifecycle.
import argon2 from 'argon2';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { cleanupFixtureRun, createFixtureLifecycle, fixtureNames } from './stagingCrmIntegration.js';

const apiBase = (process.env.STAGING_API_BASE_URL || 'https://samche-api-staging.onrender.com').replace(/\/$/, '');
const databaseUrl = process.env.STAGING_DATABASE_URL;
const ownerToken = process.env.STAGING_OWNER_TOKEN;
const rawPassword = 'Task2-Crm-Fixture-Only-2026!';
let failures = 0;

function label() { return `task2-${randomUUID().replace(/-/g, '').slice(0, 20)}`; }
function safeSummary(body) { return typeof body?.error === 'string' ? body.error.slice(0, 140) : 'ok'; }
function log(kind, role, method, endpoint, detail = '') { console.log(`${kind} | ${role} | ${method} | ${endpoint}${detail ? ` | ${detail}` : ''}`); }
function expect(condition, message) { if (!condition) throw new Error(message); }

async function request(role, token, method, endpoint, body, expectedStatus) {
  log('START', role, method, endpoint);
  let response;
  try {
    response = await fetch(`${apiBase}${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    failures += 1;
    log('FAIL', role, method, endpoint, error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    throw error;
  }
  const json = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) {
    failures += 1;
    log('FAIL', role, method, endpoint, `expected ${expectedStatus}, got ${response.status}: ${safeSummary(json)}`);
    throw new Error(`${method} ${endpoint} expected HTTP ${expectedStatus}, got ${response.status}`);
  }
  log('PASS', role, method, endpoint, `HTTP ${response.status}`);
  return json;
}

async function login(email) {
  const response = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: rawPassword }), signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => ({}));
  expect(response.status === 200 && typeof body.token === 'string', `fixture login failed for ${email}`);
  return body.token;
}

async function snapshotReadState(client, fixture) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM crm_lead_analyses WHERE tenant_id = $1 AND lead_id = $2) AS analysis_count,
       (SELECT analysis_hash FROM crm_lead_analyses WHERE tenant_id = $1 AND lead_id = $2 ORDER BY analyzed_at DESC, id DESC LIMIT 1) AS analysis_hash,
       (SELECT analyzed_at::text FROM crm_lead_analyses WHERE tenant_id = $1 AND lead_id = $2 ORDER BY analyzed_at DESC, id DESC LIMIT 1) AS analyzed_at,
       (SELECT lead_score FROM crm_leads WHERE tenant_id = $1 AND id = $2) AS lead_score,
       (SELECT temperature FROM crm_leads WHERE tenant_id = $1 AND id = $2) AS temperature`,
    [fixture.tenantId, fixture.leadId]
  );
  return result.rows[0];
}

async function createConversationPrerequisite(client, fixture, value) {
  const channel = await client.query(
    "INSERT INTO tenant_channels (tenant_id, channel_type, display_name, status) VALUES ($1, 'WEB_CHAT', $2, 'active') RETURNING id",
    [fixture.tenantId, `Task 2 channel ${value}`]
  );
  const conversation = await client.query(
    `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status, contact_id)
     VALUES ($1, $2, $3, $4, 'open', $5) RETURNING id`,
    [fixture.tenantId, channel.rows[0].id, `task2-conversation-${value}`, `task2-customer-${value}`, fixture.contactId]
  );
  await client.query(
    `INSERT INTO conversation_messages (tenant_id, conversation_id, external_message_id, sender_type, content)
     VALUES ($1, $2, $3, 'CUSTOMER', $4)`,
    [fixture.tenantId, conversation.rows[0].id, `task2-message-${value}`, 'Please prepare a company formation proposal for two visas within two weeks.']
  );
  await client.query("UPDATE crm_leads SET conversation_id = $1, source_channel = 'CI' WHERE tenant_id = $2 AND id = $3", [conversation.rows[0].id, fixture.tenantId, fixture.leadId]);
}

async function createCrossTenantFixture(client, value) {
  const names = fixtureNames(value);
  const tenant = await client.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [names.tenantB]);
  const tenantId = tenant.rows[0].id;
  const stage = await client.query("SELECT id FROM crm_pipeline_stages WHERE tenant_id = $1 AND stage_key = 'NEW_LEAD'", [tenantId]);
  const contact = await client.query(
    "INSERT INTO crm_contacts (tenant_id, identity_kind, identity_hash, source) VALUES ($1, 'ANONYMOUS_SESSION', $2, 'CI') RETURNING id",
    [tenantId, `ci-cross-${value}`.padEnd(64, '0').slice(0, 64)]
  );
  const company = await client.query('INSERT INTO crm_companies (tenant_id, name) VALUES ($1, $2) RETURNING id', [tenantId, `Cross tenant ${value}`]);
  const lead = await client.query('INSERT INTO crm_leads (tenant_id, contact_id, pipeline_stage_id) VALUES ($1, $2, $3) RETURNING id', [tenantId, contact.rows[0].id, stage.rows[0].id]);
  return { tenantId, stageId: stage.rows[0].id, leadId: lead.rows[0].id, companyId: company.rows[0].id, contactId: contact.rows[0].id };
}

async function run() {
  expect(databaseUrl, 'STAGING_DATABASE_URL is required');
  expect(ownerToken, 'STAGING_OWNER_TOKEN is required');
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  const value = label();
  let fixture;
  let cross;
  try {
    const passwordHash = await argon2.hash(rawPassword, { type: argon2.argon2id });
    fixture = await createFixtureLifecycle({ client, label: value, passwordHash });
    cross = await createCrossTenantFixture(client, value);
    await createConversationPrerequisite(client, fixture, value);
    const adminToken = await login(`ci-crm-admin-${value}@example.test`);
    const agentToken = await login(fixture.names.agentEmail);
    const t = `/api/v1/tenants/${fixture.tenantId}`;

    const baseline = await snapshotReadState(client, fixture);
    await request('ADMIN', adminToken, 'GET', `${t}/leads?limit=1&offset=0&temperature=COLD&source=CI`, undefined, 200);
    await request('ADMIN', adminToken, 'GET', `${t}/leads/${fixture.leadId}`, undefined, 200);
    await request('ADMIN', adminToken, 'GET', `${t}/contacts?limit=1&offset=0`, undefined, 200);
    await request('ADMIN', adminToken, 'GET', `${t}/contacts/${fixture.contactId}`, undefined, 200);
    await request('ADMIN', adminToken, 'GET', `${t}/companies?limit=1&offset=0`, undefined, 200);
    const pipeline = await request('ADMIN', adminToken, 'GET', `${t}/pipelines`, undefined, 200);
    await request('ADMIN', adminToken, 'GET', `${t}/deals?limit=1&offset=0`, undefined, 200);
    const afterReads = await snapshotReadState(client, fixture);
    expect(JSON.stringify(afterReads) === JSON.stringify(baseline), 'ordinary CRM reads mutated qualification state');
    log('PASS', 'DB', 'CHECK', 'crm qualification state', 'read snapshot unchanged');

    const created = await request('OWNER', ownerToken, 'POST', `${t}/leads`, { contact_id: fixture.contactId, intent: 'FORMATION', source_channel: 'CI' }, 201);
    const createdLeadId = created.id;
    await request('ADMIN', adminToken, 'GET', `${t}/leads?limit=1&offset=1`, undefined, 200);
    await request('ADMIN', adminToken, 'PUT', `${t}/leads/${createdLeadId}`, { service_interest: 'Free Zone company formation' }, 200);
    await request('ADMIN', adminToken, 'POST', `${t}/leads/${fixture.leadId}/assign`, { user_id: fixture.agentId }, 200);
    await request('AGENT', agentToken, 'GET', `${t}/leads`, undefined, 200);
    await request('AGENT', agentToken, 'PUT', `${t}/leads/${fixture.leadId}`, { intent: 'not permitted' }, 403);
    const qualified = pipeline.find((stage) => stage.stage_key === 'QUALIFIED');
    expect(qualified?.id, 'fixture pipeline lacks QUALIFIED stage');
    await request('AGENT', agentToken, 'POST', `${t}/leads/${fixture.leadId}/stage`, { pipeline_stage_id: qualified.id }, 200);
    await request('AGENT', agentToken, 'POST', `${t}/leads/${createdLeadId}/stage`, { pipeline_stage_id: qualified.id }, 403);
    await request('ADMIN', adminToken, 'POST', `${t}/leads/${fixture.leadId}/rescore`, {}, 202);
    await request('ADMIN', adminToken, 'GET', `${t}/leads/not-a-uuid`, undefined, 400);
    await request('ADMIN', adminToken, 'GET', `${t}/leads?limit=0`, undefined, 400);
    await request('ADMIN', adminToken, 'GET', `${t}/leads/${cross.leadId}`, undefined, 404);
    await request('ADMIN', adminToken, 'PUT', `${t}/leads/${cross.leadId}`, { intent: 'cross tenant' }, 404);

    const deal = await request('OWNER', ownerToken, 'POST', `${t}/deals`, { lead_id: fixture.leadId, pipeline_stage_id: qualified.id, title: 'Task 2 fixture deal', value: 1000, currency: 'AED' }, 201);
    await request('ADMIN', adminToken, 'GET', `${t}/deals/${deal.id}`, undefined, 200);
    await request('ADMIN', adminToken, 'PUT', `${t}/deals/${deal.id}`, { title: 'Updated task 2 fixture deal', probability: 75, notes: 'Persisted fixture note' }, 200);
    await request('AGENT', agentToken, 'GET', `${t}/deals`, undefined, 200);
    const won = pipeline.find((stage) => stage.stage_key === 'WON');
    expect(won?.id, 'fixture pipeline lacks WON stage');
    await request('ADMIN', adminToken, 'POST', `${t}/deals/${deal.id}/stage`, { pipeline_stage_id: won.id }, 200);
    await request('ADMIN', adminToken, 'GET', `${t}/pipelines/summary`, undefined, 200);
    await request('ADMIN', adminToken, 'GET', `${t}/crm/overview`, undefined, 200);
    const directDeal = await request('ADMIN', adminToken, 'POST', `${t}/deals`, { contact_id: fixture.contactId, title: 'Direct contact opportunity', value: 2000, currency: 'AED', probability: 60, source: 'CI' }, 201);
    await request('ADMIN', adminToken, 'DELETE', `${t}/deals/${directDeal.id}`, undefined, 204);
    await request('ADMIN', adminToken, 'GET', `${t}/deals/${directDeal.id}`, undefined, 404);
    await request('ADMIN', adminToken, 'POST', `${t}/deals`, { contact_id: cross.contactId, title: 'Invalid cross-tenant contact' }, 409);
    await request('ADMIN', adminToken, 'POST', `${t}/deals`, { lead_id: fixture.leadId, pipeline_stage_id: cross.stageId, title: 'Invalid cross-tenant stage' }, 409);
    await request('ADMIN', adminToken, 'POST', `${t}/leads`, { contact_id: cross.companyId }, 409);
  } finally {
    try {
      if (fixture) {
        const names = fixture.names;
        log('CLEANUP', 'FIXTURE', 'DELETE', 'CRM graph');
        await cleanupFixtureRun({
          client,
          tenantIds: cross ? [fixture.tenantId, cross.tenantId] : [fixture.tenantId],
          names: { tenantA: names.tenantA, tenantB: names.tenantB, agentEmail: names.agentEmail },
          agentId: fixture.agentId,
          adminId: fixture.adminId,
          adminEmail: `ci-crm-admin-${value}@example.test`,
        });
        log('CLEANUP', 'FIXTURE', 'DELETE', 'complete');
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
  if (failures > 0) process.exitCode = 1;
}

run().catch((error) => { console.error(`FAIL | HARNESS | ${error.message}`); process.exitCode = 1; });

