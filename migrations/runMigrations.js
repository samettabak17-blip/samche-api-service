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
    for (const file of migrationFiles) {
      try {
        await client.query(fs.readFileSync(path.join(migrationsDirectory, file), 'utf8'));
        if (file === '088_visual_ai_phase3_delivery_orchestration.sql') {
          console.info('MIGRATION_088_RUNTIME status=CURRENT');
        }
      } catch (fileErr) {
        console.error(`MIGRATION_EXECUTION_FAILED file=${file} code=${fileErr.code}`, fileErr.message);
        await client.query('ROLLBACK').catch(() => {});
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
