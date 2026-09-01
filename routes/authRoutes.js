import express from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import pool, { query } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { isValidEmail, isValidPassword, normalizeEmail } from '../middleware/validators.js';
import { acceptInvitation, InvitationAcceptanceError, validateInvitation, validatePublicInvitationBody } from '../services/customer-invitation-acceptance-service.js';
import { allowPublicInvitationAttempt } from '../services/public-invitation-rate-limit.js';
import { changePassword, consumePasswordReset, requestPasswordReset, validatePasswordReset } from '../services/password-reset-service.js';

const router = express.Router();

function readPublicInvitationBody(req) {
    if (!validatePublicInvitationBody(req.body)) return null;
    try {
        const body = JSON.parse(req.body.toString('utf8'));
        return body && typeof body === 'object' ? body : null;
    } catch {
        return null;
    }
}

router.post('/invitations/validate', async (req, res) => {
    const body = readPublicInvitationBody(req);
    if (!body || !allowPublicInvitationAttempt({ kind: 'validate', ip: req.ip, token: body.token })) {
        return res.status(400).json({ error: 'Invitation is unavailable' });
    }
    try {
        const invitation = await validateInvitation({ database: pool, token: body.token });
        return res.json({
            status: 'VALID',
            company_name: invitation.companyName,
            email: invitation.email
        });
    } catch {
        return res.status(400).json({ error: 'Invitation is unavailable' });
    }
});

router.post('/invitations/accept', async (req, res) => {
    const body = readPublicInvitationBody(req);
    if (!body || !allowPublicInvitationAttempt({ kind: 'accept', ip: req.ip, token: body.token })) {
        return res.status(400).json({ error: 'Invitation is unavailable' });
    }
    try {
        await acceptInvitation({ database: pool, token: body.token, password: body.password, confirmPassword: body.confirm_password });
        return res.json({ status: 'ACCOUNT_ACTIVATED' });
    } catch (error) {
        if (error instanceof InvitationAcceptanceError && error.code === 'PASSWORD_INVALID') {
            return res.status(400).json({ error: 'Password does not meet requirements' });
        }
        return res.status(400).json({ error: 'Invitation is unavailable' });
    }
});

function readPublicResetBody(req) { return readPublicInvitationBody(req); }
router.post('/forgot-password', async (req, res) => {
    const body = readPublicResetBody(req);
    if (!body || !allowPublicInvitationAttempt({ kind: 'forgot-password', ip: req.ip, token: body.email ?? '' })) return res.json({ status: 'REQUEST_ACCEPTED' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await requestPasswordReset({ client, email: body.email, envelopeKey: process.env.INVITATION_ENVELOPE_ENCRYPTION_KEY });
        await client.query('COMMIT');
    } catch { await client.query('ROLLBACK').catch(() => {}); }
    finally { client.release(); }
    return res.json({ status: 'REQUEST_ACCEPTED' });
});
router.post('/password-resets/validate', async (req, res) => {
    const body = readPublicResetBody(req);
    if (!body || !allowPublicInvitationAttempt({ kind: 'reset-validate', ip: req.ip, token: body.token })) return res.status(400).json({ error: 'Reset link is unavailable' });
    try { const reset = await validatePasswordReset({ database: pool, token: body.token }); return res.json({ status: 'VALID', email: reset.email }); }
    catch { return res.status(400).json({ error: 'Reset link is unavailable' }); }
});
router.post('/password-resets/consume', async (req, res) => {
    const body = readPublicResetBody(req);
    if (!body || !allowPublicInvitationAttempt({ kind: 'reset-consume', ip: req.ip, token: body.token })) return res.status(400).json({ error: 'Reset link is unavailable' });
    try { await consumePasswordReset({ database: pool, token: body.token, password: body.password, confirmPassword: body.confirm_password }); return res.json({ status: 'PASSWORD_RESET' }); }
    catch { return res.status(400).json({ error: 'Reset link is unavailable' }); }
});

router.post('/register', async (req, res) => {
    const { email, password } = req.body;
    const canonicalEmail = normalizeEmail(email);
    
    if (!canonicalEmail || !isValidEmail(canonicalEmail)) return res.status(400).json({ error: 'Valid email is required' });
    if (!password || !isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    
    const role = 'CUSTOMER'; // Enforce CUSTOMER role
    
    try {
        const hashedPassword = await argon2.hash(password, { type: argon2.argon2id });
        const result = await query(
            'INSERT INTO users (email, email_normalized, password_hash, system_role, status) VALUES ($1, $1, $2, $3, $4) RETURNING id, email, system_role',
            [canonicalEmail, hashedPassword, role, 'ACTIVE']
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
    const canonicalEmail = normalizeEmail(email);
    
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
        const result = await query('SELECT id, email, password_hash, system_role FROM users WHERE email_normalized = $1 AND status = $2', [canonicalEmail, 'ACTIVE']);
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

router.post('/change-password', authenticateToken, async (req, res) => {
    if (!allowPublicInvitationAttempt({ kind: 'change-password', ip: req.ip, token: req.user.user_id })) {
        return res.status(429).json({ error: 'Password change temporarily unavailable' });
    }
    try {
        await changePassword({ database: pool, userId: req.user.user_id, currentPassword: req.body?.current_password, newPassword: req.body?.new_password, confirmPassword: req.body?.confirm_password });
        return res.json({ status: 'PASSWORD_CHANGED' });
    } catch { return res.status(400).json({ error: 'Password could not be changed' }); }
});

export default router;
