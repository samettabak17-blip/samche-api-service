process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import { createDeterministicMockVisualProvider } from '../services/visual-ai-provider-adapter.js';
import { enqueueVisualAiGenerationJob } from '../services/visual-ai-job-service.js';
import { processOneVisualAiGenerationJob } from '../services/visual-ai-generation-worker.js';
import { selectRecentWhatsAppResourceContext } from '../services/whatsapp-live-inbox-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) throw new Error('TEST_DATABASE_URL_REQUIRED');

const database = new pg.Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 6,
});
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
const created = {};
const storageObjects = new Map();

async function createVisualFixture() {
  const tenant = await database.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`Visual AI PostgreSQL ${suffix}`]);
  created.tenantId = tenant.rows[0].id;
  const assistant = await database.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, $2, 'active') RETURNING id`, [created.tenantId, 'Visual Test Assistant']);
  const channel = await database.query(
    `INSERT INTO tenant_channels (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
     VALUES ($1, $2, 'WHATSAPP', 'Visual Test WhatsApp', $3, 'active') RETURNING id`,
    [created.tenantId, assistant.rows[0].id, `visual-${suffix}`]
  );
  created.channelId = channel.rows[0].id;
  await database.query(
    `INSERT INTO channel_integrations (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled, config)
     VALUES ($1, 'WHATSAPP', $2, $3, $4, TRUE, '{}'::jsonb)`,
    [`visual-test-${suffix}`, created.tenantId, created.channelId, assistant.rows[0].id]
  );
  const conversation = await database.query(
    `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status, handling_mode)
     VALUES ($1, $2, $3, '15551234567', 'open', 'AI') RETURNING id`,
    [created.tenantId, created.channelId, `visual-conversation-${suffix}`]
  );
  created.conversationId = conversation.rows[0].id;
  const sourceMessage = await database.query(
    `INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content, idempotency_key)
     VALUES ($1, $2, 'CUSTOMER', 'Make this garden modern', $3) RETURNING id`,
    [created.tenantId, created.conversationId, `visual-source-${suffix}`]
  );
  const sourceResource = await database.query(
    `INSERT INTO conversation_resources (
       tenant_id, conversation_id, message_id, source_type, media_category, original_filename,
       mime_type, size_bytes, storage_key, content_hash, processing_status, processed_at
     ) VALUES ($1, $2, $3, 'WHATSAPP_MEDIA', 'IMAGE', 'garden.jpg', 'image/jpeg', 12, $4, $5, 'READY', CURRENT_TIMESTAMP)
     RETURNING id, storage_key`,
    [created.tenantId, created.conversationId, sourceMessage.rows[0].id, `visual-source/${suffix}`, crypto.createHash('sha256').update('source-image').digest('hex')]
  );
  created.targetResourceId = sourceResource.rows[0].id;
  storageObjects.set(sourceResource.rows[0].storage_key, Buffer.from('source-image'));
  await database.query(`INSERT INTO tenant_visual_ai_config (tenant_id, enabled) VALUES ($1, TRUE)`, [created.tenantId]);
}

async function enqueueFixtureJob(key) {
  return enqueueVisualAiGenerationJob({
    database,
    tenantId: created.tenantId,
    conversationId: created.conversationId,
    targetResourceId: created.targetResourceId,
    promptInstruction: 'Make this garden modern Mediterranean',
    idempotencyKey: key,
    maxAttempts: 3,
  });
}

const storage = {
  get: async ({ key }) => [storageObjects.get(key)],
  put: async ({ key, body }) => { storageObjects.set(key, Buffer.from(body)); },
};

test.before(async () => { await createVisualFixture(); });
test.after(async () => {
  if (created.tenantId) {
    await database.query(`DELETE FROM visual_ai_generation_jobs WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM conversation_resources WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM conversation_messages WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM channel_integrations WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM conversations WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM crm_pipeline_stages WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM tenant_platform_provisioning WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM tenant_channels WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM ai_assistants WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM tenant_visual_ai_config WHERE tenant_id = $1`, [created.tenantId]);
    await database.query(`DELETE FROM tenants WHERE id = $1`, [created.tenantId]);
  }
  await database.end();
});

test('PostgreSQL Visual AI: two independent workers converge one resource, message, linkage, delivery, and terminal job', async () => {
  const job = await enqueueFixtureJob(`visual-race-${suffix}`);
  const [workerA, workerB] = await Promise.all([database.connect(), database.connect()]);
  let deliveries = 0;
  const deliverWhatsAppMedia = async () => {
    deliveries += 1;
    return { providerMessageId: `wamid.visual-${job.id}` };
  };
  try {
    const results = await Promise.all([
      processOneVisualAiGenerationJob({ database: workerA, storage, visualProvider: createDeterministicMockVisualProvider(), deliverWhatsAppMedia }),
      processOneVisualAiGenerationJob({ database: workerB, storage, visualProvider: createDeterministicMockVisualProvider(), deliverWhatsAppMedia }),
    ]);
    assert.equal(results.filter((result) => result.processed).length, 1);

    const finalJob = await database.query(`SELECT * FROM visual_ai_generation_jobs WHERE id = $1 AND tenant_id = $2`, [job.id, created.tenantId]);
    assert.equal(finalJob.rows[0].status, 'COMPLETED');
    assert.equal(finalJob.rows[0].delivery_status, 'SENT');
    assert.ok(finalJob.rows[0].generated_resource_id);
    assert.ok(finalJob.rows[0].output_message_id);
    assert.equal(deliveries, 1);

    const generated = await database.query(
      `SELECT r.id, r.message_id, m.id AS canonical_message_id
         FROM conversation_resources r
         JOIN conversation_messages m ON m.id = r.message_id AND m.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.conversation_id = $2 AND r.source_type = 'VISUAL_AI_GENERATED' AND r.id = $3`,
      [created.tenantId, created.conversationId, finalJob.rows[0].generated_resource_id]
    );
    assert.equal(generated.rowCount, 1, 'the canonical Live Inbox relation resolves generated media');
    assert.equal(generated.rows[0].message_id, finalJob.rows[0].output_message_id);

    const liveInboxContext = await selectRecentWhatsAppResourceContext({
      client: database,
      tenantId: created.tenantId,
      conversationId: created.conversationId,
      customerText: 'Please show this image again',
      storage,
    });
    assert.deepEqual(liveInboxContext.resourceIds, [finalJob.rows[0].generated_resource_id]);
  } finally {
    workerA.release();
    workerB.release();
  }
});

test('PostgreSQL Visual AI: an expired processing lease is reclaimed and converges once', async () => {
  const job = await enqueueFixtureJob(`visual-stale-${suffix}`);
  await database.query(
    `UPDATE visual_ai_generation_jobs
        SET status = 'PROCESSING', attempts = 1, locked_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes', locked_until = CURRENT_TIMESTAMP - INTERVAL '5 minutes'
      WHERE id = $1 AND tenant_id = $2`,
    [job.id, created.tenantId]
  );
  let deliveries = 0;
  const result = await processOneVisualAiGenerationJob({
    database,
    storage,
    visualProvider: createDeterministicMockVisualProvider(),
    deliverWhatsAppMedia: async () => ({ providerMessageId: `wamid.stale-${++deliveries}` }),
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(deliveries, 1);
  const finalJob = await database.query(`SELECT status, attempts FROM visual_ai_generation_jobs WHERE id = $1 AND tenant_id = $2`, [job.id, created.tenantId]);
  assert.equal(finalJob.rows[0].status, 'COMPLETED');
  assert.equal(finalJob.rows[0].attempts, 2);
});

test('PostgreSQL Visual AI: canonical HUMAN ownership suppresses an already-queued autonomous generation', async () => {
  const job = await enqueueFixtureJob(`visual-human-${suffix}`);
  await database.query(
    `UPDATE conversations SET handling_mode = 'HUMAN', handling_version = handling_version + 1
      WHERE id = $1 AND tenant_id = $2`,
    [created.conversationId, created.tenantId]
  );
  let deliveries = 0;
  const result = await processOneVisualAiGenerationJob({
    database,
    storage,
    visualProvider: createDeterministicMockVisualProvider(),
    deliverWhatsAppMedia: async () => ({ providerMessageId: `wamid.human-${++deliveries}` }),
  });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(deliveries, 0);
  const persisted = await database.query(
    `SELECT status, generated_resource_id FROM visual_ai_generation_jobs WHERE id = $1 AND tenant_id = $2`,
    [job.id, created.tenantId]
  );
  assert.equal(persisted.rows[0].status, 'CANCELLED');
  assert.equal(persisted.rows[0].generated_resource_id, null);
  await database.query(`UPDATE conversations SET handling_mode = 'AI' WHERE id = $1 AND tenant_id = $2`, [created.conversationId, created.tenantId]);

  const resumedJob = await enqueueFixtureJob(`visual-after-return-${suffix}`);
  const resumed = await processOneVisualAiGenerationJob({
    database,
    storage,
    visualProvider: createDeterministicMockVisualProvider(),
    deliverWhatsAppMedia: async () => ({ providerMessageId: `wamid.after-return-${resumedJob.id}` }),
  });
  assert.equal(resumed.status, 'COMPLETED');
});
