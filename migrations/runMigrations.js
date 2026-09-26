import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const migrationsDirectory = path.join(__dirname, '../migrations');
  const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(918246731)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const appliedRes = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(appliedRes.rows.map((r) => r.version));

    if (appliedSet.size === 0) {
      const tableCheck = await client.query(`
        SELECT table_name FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_name IN ('tenants', 'conversations', 'crm_contacts')
      `);
      if (tableCheck.rowCount >= 2) {
        for (const file of migrationFiles) {
          if (file <= '092_canonical_instagram_channel_type.sql') {
            await client.query(
              'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
              [file]
            );
            appliedSet.add(file);
          }
        }
      }
    }

    for (const file of migrationFiles) {
      if (appliedSet.has(file)) {
        if (file === '088_visual_ai_phase3_delivery_orchestration.sql') {
          console.info('MIGRATION_088_RUNTIME status=CURRENT');
        }
        continue;
      }

      const filePath = path.join(migrationsDirectory, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      try {
        await client.query('SAVEPOINT migration_sp');
        await client.query(sqlContent);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
          [file]
        );
        await client.query('RELEASE SAVEPOINT migration_sp');
        appliedSet.add(file);

        if (file === '088_visual_ai_phase3_delivery_orchestration.sql') {
          console.info('MIGRATION_088_RUNTIME status=CURRENT');
        }
      } catch (fileErr) {
        console.error(`MIGRATION_EXECUTION_FAILED file=${file} code=${fileErr.code}`, fileErr.message);
        await client.query('ROLLBACK TO SAVEPOINT migration_sp').catch(() => {});
        throw fileErr;
      }
    }
  } finally {
    try {
      await client.query('ROLLBACK').catch(() => {});
      await client.query('SELECT pg_advisory_unlock(918246731)');
    } catch (unlockErr) {
      console.warn('MIGRATION_UNLOCK_WARN', unlockErr.message);
    } finally {
      client.release();
    }
  }
}

