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
| GET ALL TENANTS
|--------------------------------------------------------------------------
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
        `, [req.user.user_id]);

        return res.status(200).json(result.rows);

    } catch (err) {
        console.error('[GET /tenants] Error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| CREATE TENANT
|--------------------------------------------------------------------------
*/

router.post('/', requireOwner, async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                error: 'Tenant name is required'
            });
        }

        const result = await query(`
            INSERT INTO tenants (name)
            VALUES ($1)
            RETURNING
                id,
                name,
                status,
                created_at
        `, [name.trim()]);

        return res.status(201).json(result.rows[0]);

    } catch (err) {
        console.error('[POST /tenants] Error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| GET SINGLE TENANT
|--------------------------------------------------------------------------
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
        console.error('[GET /tenants/:tenantId] Error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| TENANT USERS - GET
|--------------------------------------------------------------------------
*/

router.get('/:tenantId/users', requireOwner, async (req, res) => {
    try {
        const { tenantId } = req.params;

        console.log('[TENANT USERS GET] tenantId:', tenantId);
        console.log('[TENANT USERS GET] user:', req.user);

        if (!isValidUUID(tenantId)) {
            return res.status(400).json({
                error: 'Invalid tenant ID'
            });
        }

        const tenantCheck = await query(
            'SELECT id FROM tenants WHERE id = $1',
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

        return res.status(200).json(result.rows);

    } catch (err) {
        console.error('[GET TENANT USERS] Error:', err);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| TENANT USERS - POST
|--------------------------------------------------------------------------
|
| OWNER assigns an existing CUSTOMER user to a tenant.
|
*/

router.post('/:tenantId/users', requireOwner, async (req, res) => {
    console.log('==========================================');
    console.log('[POST TENANT USER] ROUTE HIT');
    console.log('==========================================');

    try {
        const { tenantId } = req.params;
        const { user_id, tenant_role } = req.body;

        console.log('[POST TENANT USER] tenantId:', tenantId);
        console.log('[POST TENANT USER] user_id:', user_id);
        console.log('[POST TENANT USER] tenant_role:', tenant_role);
        console.log('[POST TENANT USER] authenticated user:', req.user);

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

        if (!isValidUUID(user_id)) {
            return res.status(400).json({
                error: 'Invalid user ID'
            });
        }

        if (!isValidTenantRole(tenant_role)) {
            return res.status(400).json({
                error: 'Invalid tenant role. Allowed values: ADMIN or AGENT'
            });
        }


        /*
        |--------------------------------------------------------------------------
        | CHECK TENANT
        |--------------------------------------------------------------------------
        */

        const tenantCheck = await query(
            `
            SELECT id, name, status
            FROM tenants
            WHERE id = $1
            `,
            [tenantId]
        );

        if (tenantCheck.rowCount === 0) {
            return res.status(404).json({
                error: 'Tenant not found'
            });
        }


        /*
        |--------------------------------------------------------------------------
        | CHECK USER
        |--------------------------------------------------------------------------
        */

        const userCheck = await query(
            `
            SELECT
                id,
                email,
                system_role
            FROM users
            WHERE id = $1
            `,
            [user_id]
        );

        if (userCheck.rowCount === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        const targetUser = userCheck.rows[0];

        console.log('[POST TENANT USER] Target user:', targetUser);


        /*
        |--------------------------------------------------------------------------
        | ONLY CUSTOMER USERS CAN BE ASSIGNED
        |--------------------------------------------------------------------------
        */

        if (targetUser.system_role !== 'CUSTOMER') {
            return res.status(400).json({
                error: 'Target user must have system_role CUSTOMER'
            });
        }


        /*
        |--------------------------------------------------------------------------
        | CHECK EXISTING ASSIGNMENT
        |--------------------------------------------------------------------------
        */

        const existingAssignment = await query(
            `
            SELECT
                tenant_id,
                user_id,
                tenant_role
            FROM tenant_users
            WHERE tenant_id = $1
              AND user_id = $2
            `,
            [tenantId, user_id]
        );

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

        const result = await query(
            `
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
            `,
            [
                tenantId,
                user_id,
                tenant_role
            ]
        );


        /*
        |--------------------------------------------------------------------------
        | SUCCESS
        |--------------------------------------------------------------------------
        */

        console.log(
            '[POST TENANT USER] Assignment created:',
            result.rows[0]
        );

        return res.status(201).json({
            message: 'User assigned to tenant successfully',
            assignment: result.rows[0]
        });

    } catch (err) {

        console.error('==========================================');
        console.error('[POST TENANT USER] ERROR');
        console.error(err);
        console.error('==========================================');

        /*
        |--------------------------------------------------------------------------
        | PostgreSQL UNIQUE VIOLATION
        |--------------------------------------------------------------------------
        */

        if (err.code === '23505') {
            return res.status(409).json({
                error: 'User is already assigned to this tenant'
            });
        }

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| REMOVE USER FROM TENANT
|--------------------------------------------------------------------------
*/

router.delete(
    '/:tenantId/users/:userId',
    requireOwner,
    async (req, res) => {

        try {
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

            const result = await query(
                `
                DELETE FROM tenant_users
                WHERE tenant_id = $1
                  AND user_id = $2
                RETURNING tenant_id, user_id
                `,
                [tenantId, userId]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: 'User assignment not found in this tenant'
                });
            }

            return res.status(200).json({
                message: 'User removed from tenant successfully'
            });

        } catch (err) {
            console.error('[DELETE TENANT USER] Error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| ASSISTANTS
|--------------------------------------------------------------------------
*/

router.get(
    '/:tenantId/assistants',
    requireTenantAccess,
    async (req, res) => {

        try {
            const result = await query(
                `
                SELECT
                    id,
                    name,
                    model,
                    status,
                    created_at
                FROM ai_assistants
                WHERE tenant_id = $1
                ORDER BY created_at DESC
                `,
                [req.verified_tenant_id]
            );

            return res.status(200).json(result.rows);

        } catch (err) {
            console.error('[GET ASSISTANTS] Error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


router.post(
    '/:tenantId/assistants',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        try {
            const {
                name,
                system_prompt,
                model
            } = req.body;

            if (!name || name.trim().length === 0) {
                return res.status(400).json({
                    error: 'Assistant name is required'
                });
            }

            const result = await query(
                `
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
                `,
                [
                    req.verified_tenant_id,
                    name.trim(),
                    system_prompt || null,
                    model || 'gpt-4o-mini'
                ]
            );

            return res.status(201).json(result.rows[0]);

        } catch (err) {
            console.error('[POST ASSISTANT] Error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


router.get(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    async (req, res) => {

        try {
            const { assistantId } = req.params;

            if (!isValidUUID(assistantId)) {
                return res.status(400).json({
                    error: 'Invalid Assistant ID format'
                });
            }

            const result = await query(
                `
                SELECT *
                FROM ai_assistants
                WHERE id = $1
                  AND tenant_id = $2
                `,
                [
                    assistantId,
                    req.verified_tenant_id
                ]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: 'Assistant not found'
                });
            }

            return res.status(200).json(result.rows[0]);

        } catch (err) {
            console.error('[GET ASSISTANT] Error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


router.put(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        try {
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

            const result = await query(
                `
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
                `,
                [
                    name,
                    system_prompt,
                    model,
                    status,
                    assistantId,
                    req.verified_tenant_id
                ]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: 'Assistant not found'
                });
            }

            return res.status(200).json(result.rows[0]);

        } catch (err) {
            console.error('[PUT ASSISTANT] Error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


router.delete(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        try {
            const { assistantId } = req.params;

            if (!isValidUUID(assistantId)) {
                return res.status(400).json({
                    error: 'Invalid Assistant ID format'
                });
            }

            const result = await query(
                `
                DELETE FROM ai_assistants
                WHERE id = $1
                  AND tenant_id = $2
                RETURNING id
                `,
                [
                    assistantId,
                    req.verified_tenant_id
                ]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: 'Assistant not found'
                });
            }

            return res.status(200).json({
                message: 'Assistant deleted successfully'
            });

        } catch (err) {
            console.error('[DELETE ASSISTANT] Error:', err);

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/

export default router;
