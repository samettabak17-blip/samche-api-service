import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import * as whatsappInbox from '../services/whatsapp-live-inbox-service.js';
import { buildWhatsAppTenantModelContext } from '../services/whatsapp-tenant-context-service.js';

const tenantId = '91000000-0000-4000-8000-000000000001';
const otherTenantId = '91000000-0000-4000-8000-000000000002';
const assistantA = '92000000-0000-4000-8000-000000000001';
const assistantB = '92000000-0000-4000-8000-000000000002';
const otherTenantAssistant = '92000000-0000-4000-8000-000000000003';
const marker = 'SAPPHIRE-7319';

test('WhatsApp supplementary knowledge exposes an assignment-aware loader', () => {
  assert.equal(typeof whatsappInbox.loadWhatsAppSupplementaryKnowledge, 'function');
});

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

async function openDatabase() {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const pool = new pg.Pool({
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 5432),
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')),
    ssl: process.env.DATABASE_SSL === 'false'
      ? false
      : { rejectUnauthorized: true, servername: databaseUrl.hostname },
  });
  const client = await pool.connect();
  await client.query('BEGIN');
  return { client, pool };
}

async function closeDatabase({ client, pool }) {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

async function seedIdentity(client) {
  await client.query(
    `INSERT INTO tenants (id, name) VALUES
      ($1, 'WhatsApp supplementary assignment fixture'),
      ($2, 'WhatsApp supplementary isolation fixture')`,
    [tenantId, otherTenantId],
  );
  await client.query(
    `INSERT INTO ai_assistants (id, tenant_id, name, model) VALUES
      ($1, $4, 'Assigned assistant', 'gemini-test'),
      ($2, $4, 'Unassigned assistant', 'gemini-test'),
      ($3, $5, 'Other tenant assistant', 'gemini-test')`,
    [assistantA, assistantB, otherTenantAssistant, tenantId, otherTenantId],
  );
}

async function insertSource(client, {
  id,
  ownerTenantId = tenantId,
  legacyAssistantId = null,
  content = marker,
  contentHash = 'a'.repeat(64),
  processingStatus = 'READY',
  indexingStatus = 'READY',
  enabled = true,
  status = 'active',
  withReadyChunk = true,
  assignedAssistantId = null,
}) {
  await client.query(
    `INSERT INTO knowledge_base_documents (
       id, tenant_id, assistant_id, title, content, status, source_type, content_hash,
       processing_status, indexing_status, enabled
     ) VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', $7, $8, $9, $10)`,
    [id, ownerTenantId, legacyAssistantId, `Fixture ${id}`, content, status, contentHash,
      processingStatus, indexingStatus, enabled],
  );
  if (withReadyChunk) {
    await client.query(
      `INSERT INTO knowledge_chunks (
         tenant_id, source_id, chunk_index, normalized_text, text_hash, token_estimate,
         embedding_model, embedding_version, index_status, is_active
       ) VALUES ($1, $2, 0, $3, $4, 2, 'text-embedding-test', 'v1', 'READY', TRUE)`,
      [ownerTenantId, id, content, id.replaceAll('-', '').padEnd(64, '0').slice(0, 64)],
    );
  }
  if (assignedAssistantId) {
    await client.query(
      `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
       VALUES ($1, $2, $3)`,
      [ownerTenantId, id, assignedAssistantId],
    );
  }
}

async function load(client, selectedAssistantId = assistantA, selectedTenantId = tenantId) {
  return whatsappInbox.loadWhatsAppSupplementaryKnowledge(client, {
    tenantId: selectedTenantId,
    assistantId: selectedAssistantId,
  });
}

integrationTest('unassigned indexed source is excluded from WhatsApp supplementary knowledge', async () => {
  const database = await openDatabase();
  try {
    await seedIdentity(database.client);
    await insertSource(database.client, { id: '93000000-0000-4000-8000-000000000001' });
    assert.deepEqual(await load(database.client), []);
  } finally {
    await closeDatabase(database);
  }
});

integrationTest('assigned indexed source is included for its WhatsApp Assistant', async () => {
  const database = await openDatabase();
  try {
    await seedIdentity(database.client);
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000002',
      assignedAssistantId: assistantA,
    });
    assert.deepEqual(await load(database.client), [marker]);
  } finally {
    await closeDatabase(database);
  }
});

integrationTest('indexed source assigned to a different Assistant or tenant is excluded', async () => {
  const database = await openDatabase();
  try {
    await seedIdentity(database.client);
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000003',
      assignedAssistantId: assistantB,
    });
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000004',
      ownerTenantId: otherTenantId,
      assignedAssistantId: otherTenantAssistant,
      content: 'OTHER-TENANT-SECRET',
    });
    assert.deepEqual(await load(database.client), []);
  } finally {
    await closeDatabase(database);
  }
});

integrationTest('true legacy Knowledge Base rows retain global and Assistant-specific compatibility', async () => {
  const database = await openDatabase();
  try {
    await seedIdentity(database.client);
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000005',
      content: 'LEGACY-GLOBAL',
      contentHash: null,
      indexingStatus: 'PENDING',
      withReadyChunk: false,
    });
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000006',
      legacyAssistantId: assistantA,
      content: 'LEGACY-ASSISTANT-A',
      contentHash: null,
      indexingStatus: 'PENDING',
      withReadyChunk: false,
    });
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000007',
      legacyAssistantId: assistantB,
      content: 'LEGACY-ASSISTANT-B',
      contentHash: null,
      indexingStatus: 'PENDING',
      withReadyChunk: false,
    });
    assert.deepEqual(new Set(await load(database.client)), new Set(['LEGACY-GLOBAL', 'LEGACY-ASSISTANT-A']));
  } finally {
    await closeDatabase(database);
  }
});

integrationTest('archived, non-ready, and disabled indexed sources are excluded', async () => {
  const database = await openDatabase();
  try {
    await seedIdentity(database.client);
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000008',
      content: 'ARCHIVED-MARKER',
      processingStatus: 'ARCHIVED',
      indexingStatus: 'ARCHIVED',
      enabled: false,
      status: 'inactive',
      withReadyChunk: false,
      assignedAssistantId: assistantA,
    });
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000009',
      content: 'PROCESSING-MARKER',
      processingStatus: 'PROCESSING',
      indexingStatus: 'INDEXING',
      withReadyChunk: false,
      assignedAssistantId: assistantA,
    });
    await insertSource(database.client, {
      id: '93000000-0000-4000-8000-000000000010',
      content: 'DISABLED-MARKER',
      enabled: false,
      assignedAssistantId: assistantA,
    });
    assert.deepEqual(await load(database.client), []);
  } finally {
    await closeDatabase(database);
  }
});

integrationTest('same-conversation unassignment removes current knowledge without rewriting prior history', async () => {
  const database = await openDatabase();
  try {
    await seedIdentity(database.client);
    const sourceId = '93000000-0000-4000-8000-000000000011';
    await insertSource(database.client, { id: sourceId, assignedAssistantId: assistantA });
    assert.deepEqual(await load(database.client), [marker]);
    await database.client.query(
      `DELETE FROM knowledge_source_assistants
       WHERE tenant_id = $1 AND source_id = $2 AND assistant_id = $3`,
      [tenantId, sourceId, assistantA],
    );
    const currentKnowledge = await load(database.client);
    const context = buildWhatsAppTenantModelContext({
      tenant: {
        companyName: 'Fixture tenant',
        assistantName: 'Fixture assistant',
        systemPrompt: 'Answer using only currently available tenant knowledge.',
        knowledge: currentKnowledge,
      },
      history: [{ sender_type: 'ASSISTANT', content: `Earlier answer: ${marker}` }],
      customerText: 'What is the verification code?',
      communicationLanguage: 'en',
    });
    assert.match(context.systemInstruction, /No additional active tenant knowledge is available/);
    assert.doesNotMatch(context.systemInstruction, new RegExp(marker));
    assert.match(context.userPrompt, new RegExp(marker));
  } finally {
    await closeDatabase(database);
  }
});

integrationTest('fresh history after unassignment contains no indexed source marker', async () => {
  const database = await openDatabase();
  try {
    await seedIdentity(database.client);
    const sourceId = '93000000-0000-4000-8000-000000000012';
    await insertSource(database.client, { id: sourceId, assignedAssistantId: assistantA });
    await database.client.query(
      `DELETE FROM knowledge_source_assistants
       WHERE tenant_id = $1 AND source_id = $2 AND assistant_id = $3`,
      [tenantId, sourceId, assistantA],
    );
    const context = buildWhatsAppTenantModelContext({
      tenant: {
        companyName: 'Fixture tenant',
        assistantName: 'Fixture assistant',
        systemPrompt: 'Answer using only currently available tenant knowledge.',
        knowledge: await load(database.client),
      },
      history: [],
      customerText: 'What is the verification code?',
      communicationLanguage: 'en',
    });
    assert.doesNotMatch(context.systemInstruction, new RegExp(marker));
    assert.doesNotMatch(context.userPrompt, new RegExp(marker));
  } finally {
    await closeDatabase(database);
  }
});
