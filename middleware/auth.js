import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { isValidUUID } from './validators.js';

export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Authentication token required' });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid or expired token' });
        req.user = decoded; // Strictly contains { user_id, system_role }
        next();
    });
};

export const requireTenantAccess = async (req, res, next) => {
    try {
        const requestedTenantId = req.params.tenantId;

        if (!requestedTenantId || !isValidUUID(requestedTenantId)) {
            return res.status(400).json({ error: 'Valid Tenant ID is required' });
        }

        if (req.user.system_role === 'OWNER') {
            const tenantCheck = await query('SELECT id FROM tenants WHERE id = $1', [requestedTenantId]);
            if (tenantCheck.rowCount === 0) return res.status(404).json({ error: 'Tenant not found' });
            
            req.verified_tenant_id = requestedTenantId;
            return next();
        }

        if (req.user.system_role === 'CUSTOMER') {
            const mappingResult = await query(
                'SELECT tenant_role FROM tenant_users WHERE user_id = $1 AND tenant_id = $2',
                [req.user.user_id, requestedTenantId]
            );

            if (mappingResult.rowCount === 0) return res.status(403).json({ error: 'Tenant access denied' });

            req.verified_tenant_id = requestedTenantId;
            req.verified_tenant_role = mappingResult.rows[0].tenant_role;
            return next();
        }

        return res.status(403).json({ error: 'Invalid system role' });
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const requireOwner = (req, res, next) => {
    if (req.user.system_role !== 'OWNER') {
        return res.status(403).json({ error: 'OWNER access required' });
    }
    next();
};

export const requireTenantAdmin = (req, res, next) => {
    if (req.user.system_role === 'OWNER') {
        return next();
    }
    if (req.user.system_role === 'CUSTOMER' && req.verified_tenant_role === 'ADMIN') {
        return next();
    }
    return res.status(403).json({ error: 'Tenant ADMIN access required' });
};
