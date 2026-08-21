import express from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { isValidEmail, isValidPassword } from '../middleware/validators.js';

const router = express.Router();

router.post('/register', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!password || !isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    
    const role = 'CUSTOMER'; // Enforce CUSTOMER role
    
    try {
        const hashedPassword = await argon2.hash(password, { type: argon2.argon2id });
        const result = await query(
            'INSERT INTO users (email, password_hash, system_role) VALUES ($1, $2, $3) RETURNING id, email, system_role',
            [email, hashedPassword, role]
        );
        res.status(201).json({ user: { id: result.rows[0].id, email: result.rows[0].email, system_role: result.rows[0].system_role } });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'Registration failed' });
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const result = await query('SELECT id, email, password_hash, system_role FROM users WHERE email = $1 AND status = $2', [email, 'active']);
        if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = result.rows[0];
        const validPassword = await argon2.verify(user.password_hash, password);
        
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { user_id: user.id, system_role: user.system_role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, email: user.email, system_role: user.system_role } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await query('SELECT id, email, system_role FROM users WHERE id = $1', [req.user.user_id]);
        if (result.rowCount === 0) return res.status(401).json({ error: 'User not found' });
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Me endpoint error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;
