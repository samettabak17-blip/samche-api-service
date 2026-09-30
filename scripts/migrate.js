import pool from '../config/db.js';
import { runMigrations } from '../migrations/runMigrations.js';
import { executeSamcheStagingKnowledgeMigration } from './migrate_samche_staging_knowledge.js';

try {
  console.log('Starting database migrations...');
  await runMigrations();
  console.log('Database migrations completed successfully.');

  try {
    const samcheTenants = await pool.query(
      `SELECT id, name FROM tenants WHERE id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'::uuid OR name ILIKE '%SamChe%'`
    );
    for (const tenant of samcheTenants.rows) {
      console.log(`Applying complete SamChe canonical knowledge migration for tenant ${tenant.id} (${tenant.name})...`);
      const result = await executeSamcheStagingKnowledgeMigration({
        database: pool,
        tenantId: tenant.id,
      });
      console.log(`SamChe knowledge migration applied successfully: ${result.knowledgeSourcesCount} sources active.`);
    }
  } catch (kErr) {
    console.warn('SAMCHE_KNOWLEDGE_MIGRATION_BOOTSTRAP_WARN', kErr.message);
  }
} catch (error) {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

