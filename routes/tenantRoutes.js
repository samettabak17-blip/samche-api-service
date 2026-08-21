import express from 'express';
import { query } from '../config/db.js';
import {
    authenticateToken,
    requireTenantAccess,
    requireOwner,
    requireTenantAdmin
} from '../middleware/auth.js';
import {
    isValidUUID,
    isValidTenantRole
} from '../middleware/validators.js';

const router = express.Router();

router.use(authenticateToken);

// ==========================================
// TENANT BASE ROUTES
// ==========================================

// GET /api/v1/tenants
router.get('/', async (req, res) => {
    try {
        if (req.user.system_role === 'OWNER') {
            const result = await query(`
                SELECT id, name, status, created_at
                FROM tenants
                ORDER BY created_at DESC
            `);

            return res.json(result.rows);
        }

        if (req.user.system_role === 'CUSTOMER') {
            const result = await query(`
                SELECT
                    t.id,
                    t.name,
                    t.status,
                    t.created_at,
                    tu.tenant_role
                FROM tenants t
                INNER JOIN tenant_users tu
                    ON t.id = tu.tenant_id
                WHERE tu.user_id = $1
                ORDER BY t.created_at DESC
            `, [req.user.user_id]);

            return res.json(result.rows);
        }

        return res.status(403).json({
            error: 'Invalid system role'
        });

    } catch (err) {
        console.error('Fetch tenants error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});

// POST /api/v1/tenants
router.post('/', requireOwner, async (req, res) => {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
            error: 'Tenant name is required'
        });
    }

    try {
        const result = await query(`
            INSERT INTO tenants (name)
            VALUES ($1)
            RETURNING id, name, status, created_at
        `, [name.trim()]);

        return res.status(201).json(result.rows[0]);

    } catch (err) {
        console.error('Create tenant error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==========================================
// OWNER-ONLY TENANT USER MANAGEMENT
// IMPORTANT:
// These routes are intentionally BEFORE /:tenantId
// ==========================================

// GET /api/v1/tenants/:tenantId/users
router.get('/:tenantId/users', requireOwner, async (req, res) => {
    const { tenantId } = req.params;

    if (!isValidUUID(tenantId)) {
        return res.status(400).json({
            error: 'Invalid tenant ID'
        });
    }

    try {
        // First make sure tenant exists
        const tenantCheck = await query(
            'SELECT id, name FROM tenants WHERE id = $1',
            [tenantId]
        );

        if (tenantCheck.rowCount === 0) {
            return res.status(404).json({
                error: 'Tenant not found'
            });
        }

        const result = await query(`
            SELECT
                u.id,
                u.email,
                u.system_role,
                tu.tenant_role,
                tu.created_at
            FROM tenant_users tu
            INNER JOIN users u
                ON tu.user_id = u.id
            WHERE tu.tenant_id = $1
            ORDER BY tu.created_at ASC
        `, [tenantId]);

        return res.json(result.rows);

    } catch (err) {
        console.error('Fetch tenant users error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});

// POST /api/v1/tenants/:tenantId/users
router.post('/:tenantId/users', requireOwner, async (req, res) => {
    const { tenantId } = req.params;
    const { user_id, tenant_role } = req.body;

    // ------------------------------
    // Validate tenant ID
    // ------------------------------
    if (!isValidUUID(tenantId)) {
        return res.status(400).json({
            error: 'Invalid tenant ID'
        });
    }

    // ------------------------------
    // Validate user ID
    // ------------------------------
    if (!user_id || !isValidUUID(user_id)) {
        return res.status(400).json({
            error: 'Invalid user ID'
        });
    }

    // ------------------------------
    // Validate tenant role
    // ------------------------------
    if (!tenant_role || !isValidTenantRole(tenant_role)) {
        return res.status(400).json({
            error: 'Invalid tenant role. Allowed roles: ADMIN or AGENT'
        });
    }

    try {
        // ------------------------------
        // Check tenant
        // ------------------------------
        const tenantCheck = await query(
            'SELECT id, name FROM tenants WHERE id = $1',
            [tenantId]
        );

        if (tenantCheck.rowCount === 0) {
            return res.status(404).json({
                error: 'Tenant not found'
            });
        }

        // ------------------------------
        // Check user
        // ------------------------------
        const userCheck = await query(`
            SELECT id, email, system_role
            FROM users
            WHERE id = $1
        `, [user_id]);

        if (userCheck.rowCount === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Only CUSTOMER users can be assigned
        if (userCheck.rows[0].system_role !== 'CUSTOMER') {
            return res.status(400).json({
                error: 'Target must be an existing CUSTOMER user'
            });
        }

        // ------------------------------
        // Check if already assigned
        // ------------------------------
        const existingMapping = await query(`
            SELECT tenant_id, user_id
            FROM tenant_users
            WHERE tenant_id = $1
              AND user_id = $2
        `, [tenantId, user_id]);

        if (existingMapping.rowCount > 0) {
            return res.status(400).json({
                error: 'User is already assigned to this tenant'
            });
        }

        // ------------------------------
        // Create tenant assignment
        // ------------------------------
        const result = await query(`
            INSERT INTO tenant_users (
                tenant_id,
                user_id,
                tenant_role
            )
            VALUES ($1, $2, $3)
            RETURNING
                tenant_id,
                user_id,
                tenant_role
        `, [
            tenantId,
            user_id,
            tenant_role
        ]);

        return res.status(201).json({
            message: 'User assigned to tenant successfully',
            assignment: result.rows[0]
        });

    } catch (err) {
        console.error('Assign user error:', err);

        if (err.code === '23505') {
            return res.status(400).json({
                error: 'User is already assigned to this tenant'
            });
        }

        return res.status(500).json({
            error: 'Server error'
        });
    }
});

// DELETE /api/v1/tenants/:tenantId/users/:userId
router.delete('/:tenantId/users/:userId', requireOwner, async (req, res) => {
    const { tenantId, userId } = req.params;

    if (!isValidUUID(tenantId)) {
        return res.status(400).json({
            error: 'Invalid tenant ID'
        });
    }

    if (!isValidUUID(userId)) {
        return res.status(400).json({
            error: 'Invalid user ID'
        });
    }

    try {
        const result = await query(`
            DELETE FROM tenant_users
            WHERE tenant_id = $1
              AND user_id = $2
            RETURNING tenant_id, user_id, tenant_role
        `, [tenantId, userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'User assignment not found in this tenant'
            });
        }

        return res.json({
            message: 'User removed from tenant successfully',
            assignment: result.rows[0]
        });

    } catch (err) {
        console.error('Delete tenant user error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==========================================
// SINGLE TENANT
// IMPORTANT:
// This route comes AFTER /:tenantId/users
// ==========================================

// GET /api/v1/tenants/:tenantId
router.get('/:tenantId', requireTenantAccess, async (req, res) => {
    try {
        const result = await query(`
            SELECT id, name, status, created_at
            FROM tenants
            WHERE id = $1
        `, [req.verified_tenant_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'Tenant not found'
            });
        }

        return res.json(result.rows[0]);

    } catch (err) {
        console.error('Fetch tenant error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==========================================
// ASSISTANT MANAGEMENT
// TENANT ISOLATED
// ==========================================

// GET /api/v1/tenants/:tenantId/assistants
router.get('/:tenantId/assistants', requireTenantAccess, async (req, res) => {
    try {
        const result = await query(`
            SELECT
                id,
                name,
                model,
                status,
                created_at
            FROM ai_assistants
            WHERE tenant_id = $1
            ORDER BY created_at DESC
        `, [req.verified_tenant_id]);

        return res.json(result.rows);

    } catch (err) {
        console.error('Fetch assistants error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});

// POST /api/v1/tenants/:tenantId/assistants
router.post(
    '/:tenantId/assistants',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {
        const { name, system_prompt, model } = req.body;

        if (
            !name ||
            typeof name !== 'string' ||
            name.trim().length === 0
        ) {
            return res.status(400).json({
                error: 'Assistant name is required'
            });
        }

        try {
            const result = await query(`
                INSERT INTO ai_assistants (
                    tenant_id,
                    name,
                    system_prompt,
                    model
                )
                VALUES ($1, $2, $3, $4)
                RETURNING
                    id,
                    name,
                    model,
                    status,
                    created_at
            `, [
                req.verified_tenant_id,
                name.trim(),
                system_prompt || null,
                model || 'gpt-4o-mini'
            ]);

            return res.status(201).json(result.rows[0]);

        } catch (err) {
            console.error('Create assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);

// GET /api/v1/tenants/:tenantId/assistants/:assistantId
router.get(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    async (req, res) => {
        const { assistantId } = req.params;

        if (!isValidUUID(assistantId)) {
            return res.status(400).json({
                error: 'Invalid Assistant ID format'
            });
        }

        try {
            const result = await query(`
                SELECT *
                FROM ai_assistants
                WHERE id = $1
                  AND tenant_id = $2
            `, [
                assistantId,
                req.verified_tenant_id
            ]);

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: 'Assistant not found'
                });
            }

            return res.json(result.rows[0]);

        } catch (err) {
            console.error('Fetch assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);

// PUT /api/v1/tenants/:tenantId/assistants/:assistantId
router.put(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {
        const { assistantId } = req.params;
        const {
            name,
            system_prompt,
            model,
            status
        } = req.body;

        if (!isValidUUID(assistantId)) {
            return res.status(400).json({
                error: 'Invalid Assistant ID format'
            });
        }

        try {
            const result = await query(`
                UPDATE ai_assistants
                SET
                    name = COALESCE($1, name),
                    system_prompt = COALESCE($2, system_prompt),
                    model = COALESCE($3, model),
                    status = COALESCE($4, status),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
                  AND tenant_id = $6
                RETURNING *
            `, [
                name,
                system_prompt,
                model,
                status,
                assistantId,
                req.verified_tenant_id
            ]);

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: 'Assistant not found'
                });
            }

            return res.json(result.rows[0]);

        } catch (err) {
            console.error('Update assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);

// DELETE /api/v1/tenants/:tenantId/assistants/:assistantId
router.delete(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {
        const { assistantId } = req.params;

        if (!isValidUUID(assistantId)) {
            return res.status(400).json({
                error: 'Invalid Assistant ID format'
            });
        }

        try {
            const result = await query(`
                DELETE FROM ai_assistants
                WHERE id = $1
                  AND tenant_id = $2
                RETURNING id
            `, [
                assistantId,
                req.verified_tenant_id
            ]);

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: 'Assistant not found'
                });
            }

            return res.json({
                message: 'Assistant deleted successfully'
            });

        } catch (err) {
            console.error('Delete assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);

export default router;
