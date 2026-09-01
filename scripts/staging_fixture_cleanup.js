const execute = process.argv.includes('--execute');
const confirmation = process.env.STAGING_FIXTURE_CLEANUP_CONFIRMATION;

function assertStagingGuards() {
  if (process.env.STAGING_FIXTURE_CLEANUP_ENABLED !== 'true') throw new Error('Fixture cleanup is disabled');
  if (process.env.NODE_ENV !== 'staging') throw new Error('Fixture cleanup requires staging environment');
  const expectedDatabaseMarker = process.env.STAGING_FIXTURE_CLEANUP_DATABASE_ID;
  if (!expectedDatabaseMarker || !process.env.DATABASE_URL?.includes(expectedDatabaseMarker)) throw new Error('Fixture cleanup database identity guard failed');
  if (execute && confirmation !== 'DELETE_STAGING_FIXTURES') throw new Error('Fixture cleanup confirmation is invalid');
}

async function main() {
  assertStagingGuards();
  const { default: pool } = await import('../config/db.js');
  const client = await pool.connect();
  try {
    const report = await client.query(
      `SELECT u.id, u.email,
          EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.user_id = u.id) AS has_membership,
          EXISTS (SELECT 1 FROM customer_invitations ci WHERE ci.user_id = u.id) AS has_invitation
       FROM users u WHERE u.is_test_fixture = TRUE ORDER BY u.email`,
    );
    const unsafe = report.rows.filter((row) => row.has_membership || row.has_invitation);
    console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', fixture_count: report.rowCount, unsafe_count: unsafe.length }));
    if (!execute) return;
    if (unsafe.length) throw new Error('Fixture cleanup refused: fixture relationships require manual review');
    await client.query('BEGIN');
    await client.query(`DELETE FROM users WHERE is_test_fixture = TRUE AND NOT EXISTS (SELECT 1 FROM tenant_users tu WHERE tu.user_id = users.id) AND NOT EXISTS (SELECT 1 FROM customer_invitations ci WHERE ci.user_id = users.id)`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error('Staging fixture cleanup failed:', error.message); process.exitCode = 1; });
