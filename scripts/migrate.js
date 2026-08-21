import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
    const migrationPath = path.join(
        __dirname,
        '../migrations/001_multitenant_foundation.sql'
    );

    try {
        console.log('Starting database migration...');
        console.log(`Migration file: ${migrationPath}`);

        const sql = fs.readFileSync(migrationPath, 'utf8');

        await pool.query(sql);

        console.log('Database migration completed successfully.');
    } catch (error) {
        console.error('Database migration failed:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

migrate();
