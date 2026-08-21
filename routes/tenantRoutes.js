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

/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
*/

router.use(authenticateToken);


/*
|--------------------------------------------------------------------------
| TENANT BASE ROUTES
|--------------------------------------------------------------------------
*/

/**
 * GET /api/v1/tenants
 *
 * OWNER:
 *   Returns all tenants.
 *
 * CUSTOMER:
 *   Returns only tenants assigned to the current user.
 */
router.get('/', async (req, res) => {
    try {
        if (req.user.system_role === 'OWNER') {
            const result = await query(`
                SELECT
                    id,
                    name,
                    status,
                    created_at
                FROM tenants
                ORDER BY created_at DESC
            `);

            return res.status(200).json(result.rows);
        }

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

        return res.status(200).json(result.rows);

    } catch (err) {
        console.error('GET /tenants error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/**
 * POST /api/v1/tenants
 *
 * OWNER ONLY
 */
router.post('/', requireOwner, async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                error: 'Tenant name is required'
            });
        }

        const tenantName = name.trim();

        const result = await query(`
            INSERT INTO tenants (name)
            VALUES ($1)
            RETURNING
                id,
                name,
                status,
                created_at
        `, [tenantName]);

        return res.status(201).json(result.rows[0]);

    } catch (err) {
        console.error('POST /tenants error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/**
 * GET /api/v1/tenants/:tenantId
 */
router.get('/:tenantId', requireTenantAccess, async (req, res) => {
    try {
        const tenantId = req.verified_tenant_id;

        const result = await query(`
            SELECT
                id,
                name,
                status,
                created_at
            FROM tenants
            WHERE id = $1
        `, [tenantId]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'Tenant not found'
            });
        }

        return res.status(200).json(result.rows[0]);

    } catch (err) {
        console.error('GET /tenants/:tenantId error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| TENANT USER MANAGEMENT
|--------------------------------------------------------------------------
|
| OWNER ONLY
|
*/


/**
 * GET /api/v1/tenants/:tenantId/users
 *
 * Returns users assigned to a tenant.
 */
router.get('/:tenantId/users', requireOwner, async (req, res) => {
    const { tenantId } = req.params;

    if (!isValidUUID(tenantId)) {
        return res.status(400).json({
            error: 'Invalid tenant ID'
        });
    }

    try {
        // First verify tenant exists
        const tenantResult = await query(`
            SELECT id
            FROM tenants
            WHERE id = $1
        `, [tenantId]);

        if (tenantResult.rowCount === 0) {
            return res.status(404).json({
                error: 'Tenant not found'
            });
        }

        // Get assigned users
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
            ORDER BY tu.created_at DESC
        `, [tenantId]);

        return res.status(200).json(result.rows);

    } catch (err) {
        console.error('GET tenant users error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/**
 * POST /api/v1/tenants/:tenantId/users
 *
 * OWNER ONLY
 *
 * Body:
 * {
 *   "user_id": "...",
 *   "tenant_role": "ADMIN"
 * }
 */
router.post('/:tenantId/users', requireOwner, async (req, res) => {
    const { tenantId } = req.params;
    const { user_id, tenant_role } = req.body;

    console.log('==========================================');
    console.log('ASSIGN USER TO TENANT');
    console.log('tenantId:', tenantId);
    console.log('user_id:', user_id);
    console.log('tenant_role:', tenant_role);
    console.log('request user:', req.user);
    console.log('==========================================');

    /*
    |--------------------------------------------------------------------------
    | VALIDATION
    |--------------------------------------------------------------------------
    */

    if (!isValidUUID(tenantId)) {
        return res.status(400).json({
            error: 'Invalid tenant ID'
        });
    }

    if (!user_id || !isValidUUID(user_id)) {
        return res.status(400).json({
            error: 'Invalid user ID'
        });
    }

    if (!isValidTenantRole(tenant_role)) {
        return res.status(400).json({
            error: 'Invalid tenant role. Allowed roles: ADMIN or AGENT'
        });
    }

    try {

        /*
        |--------------------------------------------------------------------------
        | CHECK TENANT
        |--------------------------------------------------------------------------
        */

        const tenantResult = await query(`
            SELECT
                id,
                name,
                status
            FROM tenants
            WHERE id = $1
        `, [tenantId]);

        if (tenantResult.rowCount === 0) {
            console.error('Tenant not found:', tenantId);

            return res.status(404).json({
                error: 'Tenant not found',
                tenant_id: tenantId
            });
        }


        /*
        |--------------------------------------------------------------------------
        | CHECK USER
        |--------------------------------------------------------------------------
        */

        const userResult = await query(`
            SELECT
                id,
                email,
                system_role,
                status
            FROM users
            WHERE id = $1
        `, [user_id]);

        console.log('User lookup result:', userResult.rows);

        if (userResult.rowCount === 0) {
            console.error('USER NOT FOUND');
            console.error('Requested user_id:', user_id);

            return res.status(404).json({
                error: 'User not found',
                user_id: user_id
            });
        }

        const targetUser = userResult.rows[0];


        /*
        |--------------------------------------------------------------------------
        | USER MUST BE CUSTOMER
        |--------------------------------------------------------------------------
        */

        if (targetUser.system_role !== 'CUSTOMER') {
            return res.status(400).json({
                error: 'Target user must have CUSTOMER system role',
                user_id: targetUser.id,
                system_role: targetUser.system_role
            });
        }


        /*
        |--------------------------------------------------------------------------
        | USER STATUS
        |--------------------------------------------------------------------------
        */

        if (targetUser.status && targetUser.status !== 'active') {
            return res.status(400).json({
                error: 'User account is not active',
                user_id: targetUser.id,
                status: targetUser.status
            });
        }


        /*
        |--------------------------------------------------------------------------
        | CHECK EXISTING ASSIGNMENT
        |--------------------------------------------------------------------------
        */

        const existingAssignment = await query(`
            SELECT
                tenant_id,
                user_id,
                tenant_role
            FROM tenant_users
            WHERE tenant_id = $1
              AND user_id = $2
        `, [tenantId, user_id]);

        if (existingAssignment.rowCount > 0) {
            return res.status(409).json({
                error: 'User is already assigned to this tenant',
                assignment: existingAssignment.rows[0]
            });
        }


        /*
        |--------------------------------------------------------------------------
        | CREATE ASSIGNMENT
        |--------------------------------------------------------------------------
        */

        const insertResult = await query(`
            INSERT INTO tenant_users (
                tenant_id,
                user_id,
                tenant_role
            )
            VALUES ($1, $2, $3)
            RETURNING
                tenant_id,
                user_id,
                tenant_role,
                created_at
        `, [
            tenantId,
            user_id,
            tenant_role
        ]);


        /*
        |--------------------------------------------------------------------------
        | SUCCESS
        |--------------------------------------------------------------------------
        */

        return res.status(201).json({
            message: 'User assigned to tenant successfully',
            assignment: insertResult.rows[0],
            user: {
                id: targetUser.id,
                email: targetUser.email,
                system_role: targetUser.system_role
            },
            tenant: {
                id: tenantResult.rows[0].id,
                name: tenantResult.rows[0].name
            }
        });

    } catch (err) {

        console.error('POST tenant user error:', err);

        /*
        | UNIQUE CONSTRAINT
        */
        if (err.code === '23505') {
            return res.status(409).json({
                error: 'User is already assigned to this tenant'
            });
        }

        /*
        | FOREIGN KEY
        */
        if (err.code === '23503') {
            return res.status(400).json({
                error: 'Invalid tenant or user reference'
            });
        }

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/**
 * DELETE /api/v1/tenants/:tenantId/users/:userId
 */
router.delete('/:tenantId/users/:userId', requireOwner, async (req, res) => {
    const { tenantId, userId } = req.params;

    if (!isValidUUID(tenantId) || !isValidUUID(userId)) {
        return res.status(400).json({
            error: 'Invalid UUID format'
        });
    }

    try {
        const result = await query(`
            DELETE FROM tenant_users
            WHERE tenant_id = $1
              AND user_id = $2
            RETURNING
                tenant_id,
                user_id,
                tenant_role
        `, [tenantId, userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                error: 'User assignment not found in this tenant'
            });
        }

        return res.status(200).json({
            message: 'User removed from tenant successfully',
            assignment: result.rows[0]
        });

    } catch (err) {
        console.error('DELETE tenant user error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| ASSISTANT MANAGEMENT
|--------------------------------------------------------------------------
|
| TENANT ISOLATED
|
*/


/**
 * GET /api/v1/tenants/:tenantId/assistants
 */
router.get('/:tenantId/assistants', requireTenantAccess, async (req, res) => {
    try {
        const tenantId = req.verified_tenant_id;

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
        `, [tenantId]);

        return res.status(200).json(result.rows);

    } catch (err) {
        console.error('GET assistants error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/**
 * POST /api/v1/tenants/:tenantId/assistants
 */
router.post(
    '/:tenantId/assistants',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        const { name, system_prompt, model } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
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
                    tenant_id,
                    name,
                    system_prompt,
                    model,
                    status,
                    created_at
            `, [
                req.verified_tenant_id,
                name.trim(),
                system_prompt || '',
                model || 'gpt-4o-mini'
            ]);

            return res.status(201).json(result.rows[0]);

        } catch (err) {
            console.error('POST assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/**
 * GET /api/v1/tenants/:tenantId/assistants/:assistantId
 */
router.get(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    async (req, res) => {

        const { assistantId } = req.params;

        if (!isValidUUID(assistantId)) {
            return res.status(400).json({
                error: 'Invalid assistant ID format'
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

            return res.status(200).json(result.rows[0]);

        } catch (err) {
            console.error('GET assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/**
 * PUT /api/v1/tenants/:tenantId/assistants/:assistantId
 */
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
                error: 'Invalid assistant ID format'
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

            return res.status(200).json(result.rows[0]);

        } catch (err) {
            console.error('PUT assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/**
 * DELETE /api/v1/tenants/:tenantId/assistants/:assistantId
 */
router.delete(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        const { assistantId } = req.params;

        if (!isValidUUID(assistantId)) {
            return res.status(400).json({
                error: 'Invalid assistant ID format'
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

            return res.status(200).json({
                message: 'Assistant deleted successfully',
                id: result.rows[0].id
            });

        } catch (err) {
            console.error('DELETE assistant error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


export default router;
