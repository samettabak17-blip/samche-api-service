import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const tenantId = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';

async function testLiveTenantConvergence() {
  console.log('--- TESTING LIVE TENANT CONVERGENCE & CLEANUP FOR:', tenantId, '---');

  // 1. Ensure tenant exists
  await pool.query(
    'INSERT INTO tenants (id, name, status, plan_code) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
    [tenantId, 'SamChe Company LLC', 'active', 'ENTERPRISE']
  );

  // 2. Insert some legacy synthetic test data (simulating the dirty state)
  const legacyDoc = await pool.query(
    `INSERT INTO knowledge_base_documents (tenant_id, title, content, status, source_type)
     VALUES ($1, 'Legacy Technology Services', 'Foundation Launch Package: 18,900 AED and Silver Bridge Protocol.', 'active', 'MANUAL')
     RETURNING id`,
    [tenantId]
  );
  
  const legacyBp = await pool.query(
    `INSERT INTO business_profiles (id, tenant_id)
     VALUES (gen_random_uuid(), $1)
     RETURNING id`,
    [tenantId]
  );
  const bpId = legacyBp.rows[0].id;

  const legacyBpv = await pool.query(
    `INSERT INTO business_profile_versions (tenant_id, profile_id, schema_version, profile_data, status)
     VALUES ($1, $2, 1, jsonb_build_object('company_identity', 'Meridian Arc Technologies LLC', 'industry', 'Technology Consultancy', 'packages', jsonb_build_array('Foundation Launch Package: 18,900 AED')), 'APPROVED')
     RETURNING id`,
    [tenantId, bpId]
  );
  await pool.query('UPDATE business_profiles SET active_version_id = $1 WHERE id = $2', [legacyBpv.rows[0].id, bpId]);

  // 3. Run migration 094
  const sql = fs.readFileSync('migrations/094_samche_main_knowledge_migration_and_cleanup.sql', 'utf8');
  await pool.query(sql);

  // 4. Query the exact query used by GET /:tenantId/knowledge-intelligence/profiles (the Dashboard API)
  const result = await pool.query(
    `SELECT version.id, version.profile_id, version.schema_version, version.profile_data, version.evidence, version.source_scope,
             version.identity_resolution_status, version.status, profile.business_identity_id, identity.display_name AS business_identity_name,
             version.generated_by, version.reviewed_by, version.reviewed_at, version.activated_by,
             version.activated_at, version.superseded_by_version_id, version.created_at,
             profile.approved_version_id, profile.active_version_id
        FROM business_profile_versions version
        JOIN business_profiles profile ON profile.id = version.profile_id AND profile.tenant_id = version.tenant_id
        LEFT JOIN business_identities identity ON identity.id = profile.business_identity_id AND identity.tenant_id = profile.tenant_id
       WHERE version.tenant_id = $1
       ORDER BY version.created_at DESC`,
    [tenantId]
  );

  console.log('LIVE PROFILES RETURNED:', result.rows.length);
  const activeProfile = result.rows.find((r) => r.id === r.active_version_id);
  if (!activeProfile) throw new Error('NO ACTIVE PROFILE FOUND FOR TENANT');
  
  console.log('ACTIVE PROFILE ID:', activeProfile.id);
  console.log('ACTIVE PROFILE SCHEMA VERSION:', activeProfile.schema_version);
  console.log('ACTIVE PROFILE IDENTITY:', activeProfile.profile_data?.company_identity);
  console.log('ACTIVE PROFILE INDUSTRY:', activeProfile.profile_data?.industry);
  console.log('ACTIVE PROFILE PACKAGES:', JSON.stringify(activeProfile.profile_data?.packages));
  console.log('ACTIVE PROFILE SERVICES:', JSON.stringify(activeProfile.profile_data?.services));
  console.log('ACTIVE PROFILE POLICIES:', JSON.stringify(activeProfile.profile_data?.policies));
  console.log('ACTIVE PROFILE TERMINOLOGY:', JSON.stringify(activeProfile.profile_data?.terminology));

  // 5. Check knowledge documents
  const docs = await pool.query(
    'SELECT id, title, source_type, status FROM knowledge_base_documents WHERE tenant_id = $1 ORDER BY title',
    [tenantId]
  );
  console.log('KNOWLEDGE BASE DOCUMENTS COUNT:', docs.rows.length);
  docs.rows.forEach((d) => console.log('  -', d.title));

  // Verify zero legacy contamination
  const activeStr = JSON.stringify(activeProfile.profile_data);
  const prohibited = [
    'Meridian Arc',
    'Foundation Launch',
    'Growth Accelerator',
    'Silver Bridge',
    'Technology Consultancy',
    'Enterprise Architecture Review',
    'Project Atlas',
    'Project Harbor',
    'Project Vela',
    'Additional team member onboarding',
  ];

  let hasContamination = false;
  prohibited.forEach((p) => {
    if (activeStr.includes(p)) {
      console.error('FAIL: Legacy contaminated term found:', p);
      hasContamination = true;
    } else {
      console.log('CLEAN: Term not found:', p);
    }
  });

  if (hasContamination) {
    throw new Error('CONTAMINATION DETECTED IN ACTIVE PROFILE');
  }

  console.log('--- ALL LIVE TENANT CHECKS PASSED: TEST KNOWLEDGE CONTAMINATION = NO ---');
}

testLiveTenantConvergence().catch(console.error).finally(() => pool.end());
