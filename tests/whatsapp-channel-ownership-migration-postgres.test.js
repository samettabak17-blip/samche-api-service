process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ||= 'test-secret-value';

const { default: assert } = await import('node:assert/strict');
const { default: crypto } = await import('node:crypto');
const { default: test } = await import('node:test');
const { default: pg } = await import('pg');
const { resolvePostgresSsl } = await import('../config/postgres-ssl.js');
const { isSafeTestDatabaseUrl } = await import('../scripts/test-database-safety.js');
const { runMigrations } = await import('../migrations/runMigrations.js');

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) {
  throw new Error('TEST_DATABASE_URL_REQUIRED');
}

const database = new pg.Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 5,
});

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const phoneId = '948536645017374';
const createdTenantIds = [];
const createdUserIds = [];

test.after(async () => {
  try {
    if (createdTenantIds.length) {
      await database.query('DELETE FROM channel_integrations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_channels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalation_levels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalation_policies WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_platform_provisioning WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_pipeline_stages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM ai_assistants WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [createdTenantIds]);
    }
  } finally {
    await database.end();
  }
});

test('PostgreSQL migration: handles legacy constraint/index states, protects single active owner, and supports replay', async () => {
  const client = await database.connect();
  try {
    const t1Res = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Blue Dune ' + suffix]);
    const t2Res = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Yeşil Vadi ' + suffix]);
    const t3Res = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Third Tenant ' + suffix]);
    const t1Id = t1Res.rows[0].id;
    const t2Id = t2Res.rows[0].id;
    const t3Id = t3Res.rows[0].id;
    createdTenantIds.push(t1Id, t2Id, t3Id);

    const a1Res = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'A1', 'active') RETURNING id`, [t1Id]);
    const a2Res = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'A2', 'active') RETURNING id`, [t2Id]);
    const a3Res = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'A3', 'active') RETURNING id`, [t3Id]);
    const a1Id = a1Res.rows[0].id;
    const a2Id = a2Res.rows[0].id;
    const a3Id = a3Res.rows[0].id;

    // Insert historical inactive for Blue Dune
    const c1Res = await client.query(
      `INSERT INTO tenant_channels (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
       VALUES ($1, $2, 'WHATSAPP', 'Blue Dune WhatsApp', $3, 'inactive')
       RETURNING id`,
      [t1Id, a1Id, phoneId]
    );
    const c1Id = c1Res.rows[0].id;

    // Insert current active for Yeşil Vadi
    const c2Res = await client.query(
      `INSERT INTO tenant_channels (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
       VALUES ($1, $2, 'WHATSAPP', 'Yeşil Vadi WhatsApp', $3, 'active')
       RETURNING id`,
      [t2Id, a2Id, phoneId]
    );
    const c2Id = c2Res.rows[0].id;

    // 1. Run migrations
    await runMigrations();

    // 2. Verify catalog: old global uniqueness is removed
    const oldConstraint = await client.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'tenant_channels'::regclass
          AND conname = 'uq_tenant_channels_whatsapp_phone_number'`
    );
    assert.equal(oldConstraint.rowCount, 0, 'OLD_GLOBAL_UNIQUENESS_REMOVED (constraint)');

    const oldIndex = await client.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'tenant_channels'
          AND indexname = 'uq_tenant_channels_whatsapp_phone_number'`
    );
    assert.equal(oldIndex.rowCount, 0, 'OLD_GLOBAL_UNIQUENESS_REMOVED (index)');

    // 3. Verify active-only unique index exists
    const newIndex = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'tenant_channels'
          AND indexname = 'uq_tenant_channels_active_whatsapp_external_id'`
    );
    assert.equal(newIndex.rowCount, 1, 'ACTIVE_ONLY_UNIQUENESS_PRESENT');
    assert.ok(newIndex.rows[0].indexdef.includes('active'), 'Index covers active status');

    // 4. Verify data preservation
    const c1Check = await client.query('SELECT status, external_channel_id FROM tenant_channels WHERE id = $1', [c1Id]);
    assert.equal(c1Check.rows[0].status, 'inactive', 'HISTORICAL_INACTIVE_ROW_PRESERVED');
    assert.equal(c1Check.rows[0].external_channel_id, phoneId);

    const c2Check = await client.query('SELECT status, external_channel_id FROM tenant_channels WHERE id = $1', [c2Id]);
    assert.equal(c2Check.rows[0].status, 'active', 'CURRENT_ACTIVE_ROW_PRESERVED');
    assert.equal(c2Check.rows[0].external_channel_id, phoneId);

    // 5. Verify single active owner enforcement
    await assert.rejects(
      async () => {
        await client.query(
          `INSERT INTO tenant_channels (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
           VALUES ($1, $2, 'WHATSAPP', 'Third Active', $3, 'active')`,
          [t3Id, a3Id, phoneId]
        );
      },
      (err) => {
        assert.equal(err.code, '23505', 'Second active owner must fail with 23505');
        assert.ok(err.message.includes('uq_tenant_channels_active_whatsapp_external_id'));
        return true;
      },
      'ONE_ACTIVE_OWNER must be enforced'
    );

    // Inactive duplicate insert succeeds
    const c3Res = await client.query(
      `INSERT INTO tenant_channels (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
       VALUES ($1, $2, 'WHATSAPP', 'Third Inactive', $3, 'inactive')
       RETURNING id`,
      [t3Id, a3Id, phoneId]
    );
    assert.ok(c3Res.rows[0].id, 'Multiple inactive channels for same phone are allowed');
    await client.query('DELETE FROM tenant_channels WHERE id = $1', [c3Res.rows[0].id]);

    // 6. Verify replay safety across restarts
    await runMigrations(); // RESTART_1
    await runMigrations(); // RESTART_2
    await runMigrations(); // RESTART_3

    const finalCheck = await client.query('SELECT status FROM tenant_channels WHERE id = $1', [c2Id]);
    assert.equal(finalCheck.rows[0].status, 'active');
  } finally {
    client.release();
  }
});
