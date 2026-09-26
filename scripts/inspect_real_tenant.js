import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.STAGING_DATABASE_URL;
const pool = new Pool({
  connectionString: databaseUrl,
});

const tenantId = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';

async function main() {
  console.log('--- INSPECTING REAL STAGING TENANT:', tenantId, '---');
  
  const tenant = await pool.query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
  console.log('TENANT ROW:', tenant.rows);

  const bp = await pool.query('SELECT * FROM business_profiles WHERE tenant_id = $1', [tenantId]);
  console.log('BUSINESS PROFILES:', bp.rows);

  const bpv = await pool.query(
    `SELECT id, profile_id, schema_version, status, identity_resolution_status, created_at,
            profile_data->>'company_identity' as company_identity,
            profile_data->>'industry' as industry,
            profile_data->'packages' as packages,
            profile_data->'policies' as policies
       FROM business_profile_versions
      WHERE tenant_id = $1
      ORDER BY created_at DESC`,
    [tenantId]
  );
  console.log('BUSINESS PROFILE VERSIONS COUNT:', bpv.rows.length);
  bpv.rows.forEach((r, idx) => {
    console.log(`[BPV ${idx + 1}] id=${r.id} schema=${r.schema_version} status=${r.status} identity=${r.company_identity} industry=${r.industry}`);
    console.log('   packages:', JSON.stringify(r.packages));
    console.log('   policies:', JSON.stringify(r.policies));
  });

  const assistants = await pool.query(
    'SELECT id, name, model, status, active_configuration_version_id FROM ai_assistants WHERE tenant_id = $1',
    [tenantId]
  );
  console.log('ASSISTANTS:', assistants.rows);

  const acv = await pool.query(
    `SELECT id, assistant_id, schema_version, status, source_profile_version_id, created_at,
            configuration_data->>'assistant_identity' as assistant_identity
       FROM assistant_configuration_versions
      WHERE tenant_id = $1
      ORDER BY created_at DESC`,
    [tenantId]
  );
  console.log('ASSISTANT CONFIG VERSIONS COUNT:', acv.rows.length);
  acv.rows.forEach((r, idx) => {
    console.log(`[ACV ${idx + 1}] id=${r.id} assistant=${r.assistant_id} schema=${r.schema_version} status=${r.status} identity=${r.assistant_identity} sourceProfileId=${r.source_profile_version_id}`);
  });

  const docs = await pool.query(
    `SELECT id, title, content_hash, status, processing_status, indexing_status, source_type, created_at
       FROM knowledge_base_documents
      WHERE tenant_id = $1
      ORDER BY created_at DESC`,
    [tenantId]
  );
  console.log('KNOWLEDGE BASE DOCUMENTS COUNT:', docs.rows.length);
  docs.rows.forEach((d, idx) => {
    console.log(`[DOC ${idx + 1}] id=${d.id} title="${d.title}" type=${d.source_type} status=${d.status} proc=${d.processing_status} idx=${d.indexing_status}`);
  });

  const channels = await pool.query(
    'SELECT id, channel_type, status, external_channel_id, assistant_id FROM tenant_channels WHERE tenant_id = $1',
    [tenantId]
  );
  console.log('CHANNELS:', channels.rows);

  const integrations = await pool.query(
    'SELECT id, integration_type, integration_key, channel_id, assistant_id, enabled, config FROM channel_integrations WHERE tenant_id = $1',
    [tenantId]
  );
  console.log('CHANNEL INTEGRATIONS:', integrations.rows);
}

main().catch(console.error).finally(() => pool.end());
