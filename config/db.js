import pkg from 'pg';
import dotenv from 'dotenv';
import { resolvePostgresSsl } from './postgres-ssl.js';

// Explicitly load environment variables at the module level
dotenv.config();

// Environment Validation
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    console.error('FATAL ERROR: DATABASE_URL environment variable is missing.');
    process.exit(1);
}

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    console.error('FATAL ERROR: JWT_SECRET environment variable is missing.');
    process.exit(1);
}

const connectionString = process.env.DATABASE_URL || 'postgres://samche_dummy:samche_dummy@127.0.0.1:5432/samche_test';

const { Pool } = pkg;

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? resolvePostgresSsl({ connectionString }) : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

export const query = async (text, params) => {
  return await pool.query(text, params);
};

export default pool;
