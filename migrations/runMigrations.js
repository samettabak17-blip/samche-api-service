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
      await client.query(fs.readFileSync(path.join(migrationsDirectory, file), 'utf8'));
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(918246731)');
    } finally {
      client.release();
    }
  }
}
