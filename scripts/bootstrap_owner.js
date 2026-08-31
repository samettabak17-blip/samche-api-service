import argon2 from 'argon2';
import pool from '../config/db.js';
import { normalizeEmail } from '../middleware/validators.js';

async function bootstrapOwner() {
    const email = normalizeEmail(process.env.OWNER_EMAIL);
    const password = process.env.OWNER_PASSWORD;

    if (!email || !password || password.length < 8) {
        console.error('Valid OWNER_EMAIL and OWNER_PASSWORD (>= 8 chars) environment variables are required.');
        process.exit(1);
    }

    try {
        const hashedPassword = await argon2.hash(password, { type: argon2.argon2id });
        const result = await pool.query(
            'INSERT INTO users (email, email_normalized, password_hash, system_role, status) VALUES ($1, $1, $2, $3, $4) ON CONFLICT (email_normalized) DO NOTHING RETURNING id, email',
            [email, hashedPassword, 'OWNER', 'ACTIVE']
        );

        if (result.rowCount > 0) {
            console.log('Successfully created OWNER account:', result.rows[0].email);
        } else {
            console.log('OWNER account with this email already exists.');
        }
    } catch (error) {
        console.error('Error bootstrapping OWNER:', error);
    } finally {
        pool.end();
    }
}
bootstrapOwner();
