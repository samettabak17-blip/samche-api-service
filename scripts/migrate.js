import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
    const migrationsDirectory = path.join(__dirname, '../migrations');

    try {
        console.log('Starting database migrations...');

        const migrationFiles = fs.readdirSync(migrationsDirectory)
            .filter((file) => file.endsWith('.sql'))
            .sort();

        for (const file of migrationFiles) {
            const migrationPath = path.join(migrationsDirectory, file);
            console.log(`Migration file: ${migrationPath}`);
            await pool.query(fs.readFileSync(migrationPath, 'utf8'));
        }

        console.log('Database migrations completed successfully.');
    } catch (error) {
        console.error('Database migration failed:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

migrate();
