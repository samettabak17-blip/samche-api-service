# WhatsApp Channel Ownership Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one canonical, auditable, platform-authorized WhatsApp external-channel transfer lifecycle without moving historical conversations.

**Architecture:** `tenant_channels` is the active ownership authority and `channel_integrations` is its transport projection. A focused service owns normalized create/update/transfer operations under PostgreSQL locks; Dashboard routes and UI call that service and never perform cross-tenant convergence themselves.

**Tech Stack:** Node.js ES modules, Express, PostgreSQL, React, TypeScript, TanStack Query, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-whatsapp-channel-typing-auth-acceptance-repair-design.md`

## Global Constraints

- Only `system_role === 'OWNER'` may transfer across tenants.
- CUSTOMER tenant administrators may configure only their own tenant and may not receive source-tenant identity.
- Historical conversations and messages never change tenant or channel ownership.
- External IDs are normalized generically; no tenant name, tenant ID, phone ID, or customer branch is hardcoded.
- `package.json` is protected pre-existing work and is excluded from this task.

---

### Task 1: Database ownership and audit contract

**Files:**
- Create: `migrations/072_whatsapp_channel_ownership_transfer.sql`
- Create: `test/whatsappChannelOwnershipMigration.test.js`

**Interfaces:**
- Produces: one normalized-active-owner unique index and immutable `whatsapp_channel_ownership_events` rows.

- [ ] **Step 1: Write the failing migration contract test**

Assert that migration 072 drops only the obsolete raw WhatsApp index, creates a normalized partial unique index for active WhatsApp ownership, creates an append-only ownership event table with source and target tenant/channel references, and adds no update/delete behavior.

- [ ] **Step 2: Run the focused test and confirm RED**

Run `node --test test/whatsappChannelOwnershipMigration.test.js`; expect failure because migration 072 does not exist.

- [ ] **Step 3: Add the non-destructive migration**

Use the canonical SQL expression `lower(regexp_replace(btrim(external_channel_id), '^whatsapp:', '', 'i'))` for active WhatsApp uniqueness. Create event types `CREATED`, `UPDATED`, and `TRANSFERRED`; store actor, normalized external ID, source/target ownership references, and timestamp.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run `node --test test/whatsappChannelOwnershipMigration.test.js`.

### Task 2: Canonical ownership service

**Files:**
- Create: `services/whatsapp-channel-ownership-service.js`
- Create: `test/whatsappChannelOwnershipService.test.js`
- Create: `tests/whatsapp-channel-ownership-postgres.test.js`

**Interfaces:**
- Produces: `normalizeWhatsAppExternalChannelId(value)`, `createOrUpdateWhatsAppChannel(input)`, `transferWhatsAppChannelOwnership(input)`, and `WhatsAppChannelOwnershipError`.

- [ ] **Step 1: Write failing service tests**

Cover normalized identity, same-tenant create/update, structured cross-tenant conflict, CUSTOMER transfer denial before mutation, active target-assistant validation, explicit confirmation, expected-owner compare-and-swap, retired source ownership, projection synchronization, immutable audit insertion, and rollback on ambiguity.

- [ ] **Step 2: Run the focused service test and confirm RED**

Run `node --test test/whatsappChannelOwnershipService.test.js`.

- [ ] **Step 3: Implement the minimal transactional service**

Use `pg_advisory_xact_lock(hashtext('whatsapp-channel-owner:' || $1))`, `SELECT ... FOR UPDATE`, target-tenant assistant validation, source retirement, target activation/creation, one integration upsert, and one audit insert. Return structured conflict data separately for platform and tenant callers.

- [ ] **Step 4: Run service tests and confirm GREEN**

Run `node --test test/whatsappChannelOwnershipService.test.js`.

- [ ] **Step 5: Add and run disposable PostgreSQL coverage**

Prove concurrent uniqueness, source conversation preservation, target conversation creation, audit durability, and full rollback on invalid assistant. Run `node --test tests/whatsapp-channel-ownership-postgres.test.js` when the disposable PostgreSQL prerequisite is available.

### Task 3: Routes and platform authorization

**Files:**
- Modify: `routes/dashboardRoutes.js`
- Modify: `middleware/auth.js` only if a named platform-authority helper is required without changing semantics.
- Create: `test/dashboardWhatsAppChannelOwnershipRoutes.test.js`

**Interfaces:**
- Consumes: ownership service APIs.
- Produces: structured create/update conflict response and `POST /api/v1/tenants/:tenantId/channels/transfer-whatsapp` protected by `requireOwner`.

- [ ] **Step 1: Write failing route tests**

Exercise CUSTOMER ADMIN same-tenant mutation, CUSTOMER ADMIN cross-tenant denial, platform OWNER transfer, missing confirmation, stale expected owner, and sanitized conflict responses.

- [ ] **Step 2: Run route tests and confirm RED**

Run `node --test test/dashboardWhatsAppChannelOwnershipRoutes.test.js`.

- [ ] **Step 3: Replace inline WhatsApp route SQL with the service**

Keep WEB_CHAT and SAMCHEGUIDE behavior unchanged. Map ownership error codes to stable HTTP 400/403/409 responses and never swallow integration errors.

- [ ] **Step 4: Run route tests and confirm GREEN**

Run `node --test test/dashboardWhatsAppChannelOwnershipRoutes.test.js`.

### Task 4: Dashboard conflict and transfer UI

**Files:**
- Modify: `dashboard/src/types/api.ts`
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`
- Modify: `dashboard/src/features/channels/channels-page.tsx`
- Modify: `dashboard/src/features/channels/channels-page.test.tsx`
- Modify: `dashboard/src/features/dashboard/dashboard-api.test.ts`

**Interfaces:**
- Produces: typed ownership conflict, platform transfer call, and active-assistant default selection.

- [ ] **Step 1: Write failing UI/API tests**

Assert active same-tenant assistant filtering/defaulting, tenant-admin non-transfer conflict copy, platform-owner confirmation, exact transfer request, and list refresh.

- [ ] **Step 2: Run focused Vitest tests and confirm RED**

Run `npm test -- channels-page.test.tsx dashboard-api.test.ts` from `dashboard`.

- [ ] **Step 3: Implement the minimal typed UI**

Use existing Dashboard controls and confirmation dialog. Never expose a source tenant name to CUSTOMER users. Require explicit platform confirmation before calling transfer.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same focused Vitest command.

### Task 5: Canonical resolver and conversation isolation

**Files:**
- Modify: `services/whatsapp-live-inbox-service.js`
- Modify: `test/whatsappRuntimeResolver.test.js`
- Modify: `test/whatsappTenantResolutionConvergence.test.js`
- Create: `test/whatsappConversationOwnershipSafety.test.js`

**Interfaces:**
- Produces: unique canonical active resolution, safe projection convergence, and fail-closed conversation conflict behavior.

- [ ] **Step 1: Write failing resolver/conversation tests**

Prove inactive historical rows do not own routing, multiple active candidates fail, projection repair requires one proven owner, runtime never changes channel ownership, and cross-tenant conversation conflict cannot update `tenant_id`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run the four focused Node test files.

- [ ] **Step 3: Implement canonical resolution and guarded upsert**

Return `external_channel_id` from the canonical channel, require integration agreement after bounded convergence, and replace `SET tenant_id = EXCLUDED.tenant_id` with same-owner activity-only convergence plus an explicit ownership error when no row is returned.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the four focused Node test files again.