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
| GLOBAL AUTHENTICATION
|--------------------------------------------------------------------------
*/

router.use(authenticateToken);


/*
|--------------------------------------------------------------------------
| GET ALL TENANTS
|--------------------------------------------------------------------------
|
| OWNER:
|   Returns all tenants.
|
| CUSTOMER:
|   Returns only tenants assigned to the logged-in customer.
|
*/

router.get('/', async (req, res) => {
    try {

        /*
        |--------------------------------------------------------------------------
        | OWNER
        |--------------------------------------------------------------------------
        */

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


        /*
        |--------------------------------------------------------------------------
        | CUSTOMER
        |--------------------------------------------------------------------------
        */

        if (req.user.system_role === 'CUSTOMER') {

            const result = await query(`
                SELECT
                    t.id,
                    t.name,
                    t.status,
                    t.created_at,
                    tu.tenant_role
                FROM tenant_users tu
                INNER JOIN tenants t
                    ON t.id = tu.tenant_id
                WHERE tu.user_id = $1
                ORDER BY t.created_at DESC
            `, [
                req.user.user_id
            ]);

            return res.status(200).json(result.rows);
        }


        /*
        |--------------------------------------------------------------------------
        | INVALID ROLE
        |--------------------------------------------------------------------------
        */

        return res.status(403).json({
            error: 'Invalid system role'
        });

    } catch (error) {

        console.error('GET /tenants error:', error);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| CREATE TENANT
|--------------------------------------------------------------------------
|
| OWNER ONLY
|
*/

router.post('/', requireOwner, async (req, res) => {

    const { name } = req.body;

    if (
        !name ||
        typeof name !== 'string' ||
        name.trim().length === 0
    ) {
        return res.status(400).json({
            error: 'Tenant name is required'
        });
    }

    try {

        const result = await query(`
            INSERT INTO tenants (
                name
            )
            VALUES ($1)
            RETURNING
                id,
                name,
                status,
                created_at
        `, [
            name.trim()
        ]);

        return res.status(201).json(result.rows[0]);

    } catch (error) {

        console.error('POST /tenants error:', error);

        return res.status(500).json({
            error: 'Server error'
        });
    }
});


/*
|--------------------------------------------------------------------------
| OWNER - GET TENANT USERS
|--------------------------------------------------------------------------
|
| GET /api/v1/tenants/:tenantId/users
|
*/

router.get(
    '/:tenantId/users',
    requireOwner,
    async (req, res) => {

        const { tenantId } = req.params;

        if (!isValidUUID(tenantId)) {

            return res.status(400).json({
                error: 'Invalid tenant ID'
            });
        }

        try {

            /*
            |--------------------------------------------------------------------------
            | Check tenant
            |--------------------------------------------------------------------------
            */

            const tenantResult = await query(`
                SELECT
                    id,
                    name,
                    status
                FROM tenants
                WHERE id = $1
            `, [
                tenantId
            ]);

            if (tenantResult.rowCount === 0) {

                return res.status(404).json({
                    error: 'Tenant not found'
                });
            }


            /*
            |--------------------------------------------------------------------------
            | Get users
            |--------------------------------------------------------------------------
            */

            const result = await query(`
                SELECT
                    u.id,
                    u.email,
                    u.system_role,
                    tu.tenant_role,
                    tu.created_at
                FROM tenant_users tu
                INNER JOIN users u
                    ON u.id = tu.user_id
                WHERE tu.tenant_id = $1
                ORDER BY tu.created_at ASC
            `, [
                tenantId
            ]);

            return res.status(200).json(result.rows);

        } catch (error) {

            console.error(
                'GET /tenants/:tenantId/users error:',
                error
            );

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| OWNER - ASSIGN USER TO TENANT
|--------------------------------------------------------------------------
|
| POST /api/v1/tenants/:tenantId/users
|
| Body:
|
| {
|   "user_id": "...",
|   "tenant_role": "ADMIN"
| }
|
*/

router.post(
    '/:tenantId/users',
    requireOwner,
    async (req, res) => {

        const { tenantId } = req.params;
        const { user_id, tenant_role } = req.body;


        /*
        |--------------------------------------------------------------------------
        | Validate tenant ID
        |--------------------------------------------------------------------------
        */

        if (!isValidUUID(tenantId)) {

            return res.status(400).json({
                error: 'Invalid tenant ID'
            });
        }


        /*
        |--------------------------------------------------------------------------
        | Validate user ID
        |--------------------------------------------------------------------------
        */

        if (!user_id || !isValidUUID(user_id)) {

            return res.status(400).json({
                error: 'Invalid user ID'
            });
        }


        /*
        |--------------------------------------------------------------------------
        | Validate tenant role
        |--------------------------------------------------------------------------
        */

        if (
            !tenant_role ||
            !isValidTenantRole(tenant_role)
        ) {

            return res.status(400).json({
                error: 'Invalid tenant role. Allowed roles: ADMIN or AGENT'
            });
        }


        try {

            /*
            |--------------------------------------------------------------------------
            | 1. Verify tenant
            |--------------------------------------------------------------------------
            */

            const tenantResult = await query(`
                SELECT
                    id,
                    name,
                    status
                FROM tenants
                WHERE id = $1
            `, [
                tenantId
            ]);

            if (tenantResult.rowCount === 0) {

                return res.status(404).json({
                    error: 'Tenant not found'
                });
            }


            /*
            |--------------------------------------------------------------------------
            | 2. Verify CUSTOMER user
            |--------------------------------------------------------------------------
            |
            | IMPORTANT:
            | We deliberately query the same database used by the rest
            | of the application.
            |
            */

            const userResult = await query(`
                SELECT
                    id,
                    email,
                    system_role
                FROM users
                WHERE id = $1
            `, [
                user_id
            ]);

            if (userResult.rowCount === 0) {

                return res.status(404).json({
                    error: 'User not found',
                    user_id
                });
            }


            /*
            |--------------------------------------------------------------------------
            | 3. User must be CUSTOMER
            |--------------------------------------------------------------------------
            */

            if (
                userResult.rows[0].system_role !== 'CUSTOMER'
            ) {

                return res.status(400).json({
                    error: 'Only CUSTOMER users can be assigned to a tenant'
                });
            }


            /*
            |--------------------------------------------------------------------------
            | 4. Check existing assignment
            |--------------------------------------------------------------------------
            */

            const existingResult = await query(`
                SELECT
                    tenant_id,
                    user_id,
                    tenant_role
                FROM tenant_users
                WHERE tenant_id = $1
                  AND user_id = $2
            `, [
                tenantId,
                user_id
            ]);

            if (existingResult.rowCount > 0) {

                return res.status(409).json({
                    error: 'User is already assigned to this tenant',
                    assignment: existingResult.rows[0]
                });
            }


            /*
            |--------------------------------------------------------------------------
            | 5. Create assignment
            |--------------------------------------------------------------------------
            */

            const insertResult = await query(`
                INSERT INTO tenant_users (
                    tenant_id,
                    user_id,
                    tenant_role
                )
                VALUES (
                    $1,
                    $2,
                    $3
                )
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
                    id: userResult.rows[0].id,
                    email: userResult.rows[0].email,
                    system_role: userResult.rows[0].system_role
                }
            });

        } catch (error) {

            console.error(
                'POST /tenants/:tenantId/users error:',
                error
            );


            /*
            |--------------------------------------------------------------------------
            | PostgreSQL duplicate key
            |--------------------------------------------------------------------------
            */

            if (error.code === '23505') {

                return res.status(409).json({
                    error: 'User is already assigned to this tenant'
                });
            }


            /*
            |--------------------------------------------------------------------------
            | Foreign key error
            |--------------------------------------------------------------------------
            */

            if (error.code === '23503') {

                return res.status(400).json({
                    error: 'Invalid tenant or user reference'
                });
            }


            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| OWNER - REMOVE USER FROM TENANT
|--------------------------------------------------------------------------
|
| DELETE /api/v1/tenants/:tenantId/users/:userId
|
*/

router.delete(
    '/:tenantId/users/:userId',
    requireOwner,
    async (req, res) => {

        const {
            tenantId,
            userId
        } = req.params;


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
                RETURNING
                    tenant_id,
                    user_id,
                    tenant_role
            `, [
                tenantId,
                userId
            ]);


            if (result.rowCount === 0) {

                return res.status(404).json({
                    error: 'User assignment not found in this tenant'
                });
            }


            return res.status(200).json({
                message: 'User removed from tenant successfully',
                assignment: result.rows[0]
            });

        } catch (error) {

            console.error(
                'DELETE /tenants/:tenantId/users/:userId error:',
                error
            );

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| GET SINGLE TENANT
|--------------------------------------------------------------------------
|
| GET /api/v1/tenants/:tenantId
|
*/

router.get(
    '/:tenantId',
    requireTenantAccess,
    async (req, res) => {

        try {

            const result = await query(`
                SELECT
                    id,
                    name,
                    status,
                    created_at
                FROM tenants
                WHERE id = $1
            `, [
                req.verified_tenant_id
            ]);


            if (result.rowCount === 0) {

                return res.status(404).json({
                    error: 'Tenant not found'
                });
            }


            return res.status(200).json(
                result.rows[0]
            );

        } catch (error) {

            console.error(
                'GET /tenants/:tenantId error:',
                error
            );

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| ASSISTANTS - LIST
|--------------------------------------------------------------------------
|
| GET /api/v1/tenants/:tenantId/assistants
|
*/

router.get(
    '/:tenantId/assistants',
    requireTenantAccess,
    async (req, res) => {

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
            `, [
                req.verified_tenant_id
            ]);


            return res.status(200).json(
                result.rows
            );

        } catch (error) {

            console.error(
                'GET assistants error:',
                error
            );

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| ASSISTANTS - CREATE
|--------------------------------------------------------------------------
|
| POST /api/v1/tenants/:tenantId/assistants
|
*/

router.post(
    '/:tenantId/assistants',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        const {
            name,
            system_prompt,
            model
        } = req.body;


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
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4
                )
                RETURNING
                    id,
                    name,
                    system_prompt,
                    model,
                    status,
                    created_at
            `, [
                req.verified_tenant_id,
                name.trim(),
                system_prompt || null,
                model || 'gpt-4o-mini'
            ]);


            return res.status(201).json(
                result.rows[0]
            );

        } catch (error) {

            console.error(
                'POST assistant error:',
                error
            );

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| ASSISTANTS - GET ONE
|--------------------------------------------------------------------------
*/

router.get(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    async (req, res) => {

        const {
            assistantId
        } = req.params;


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


            return res.status(200).json(
                result.rows[0]
            );

        } catch (error) {

            console.error(
                'GET assistant error:',
                error
            );

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| ASSISTANTS - UPDATE
|--------------------------------------------------------------------------
*/

router.put(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        const {
            assistantId
        } = req.params;

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


            return res.status(200).json(
                result.rows[0]
            );

        } catch (error) {

            console.error(
                'PUT assistant error:',
                error
            );

            return res.status(500).json({
                error: 'Server error'
            });
        }
    }
);


/*
|--------------------------------------------------------------------------
| ASSISTANTS - DELETE
|--------------------------------------------------------------------------
*/

router.delete(
    '/:tenantId/assistants/:assistantId',
    requireTenantAccess,
    requireTenantAdmin,
    async (req, res) => {

        const {
            assistantId
        } = req.params;


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


            return res.status(200).json({
                message: 'Assistant deleted successfully'
            });

        } catch (error) {

            console.error(
                'DELETE assistant error:',
                error
            );

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
