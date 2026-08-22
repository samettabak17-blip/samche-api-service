import pool from '../config/db.js';
import { runMigrations } from '../migrations/runMigrations.js';

try {
  console.log('Starting database migrations...');
  await runMigrations();
  console.log('Database migrations completed successfully.');
} catch (error) {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
