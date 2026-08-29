# Generation Attempt Observability and Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scoped Business Profile generation observable, duplicate-safe, and transactionally atomic without changing provider/model routing or timeout values.

**Architecture:** Extend the existing tenant-scoped `knowledge_generation_runs` ledger with an exact input fingerprint and safe stage telemetry. Reuse current resolved identity evidence only when Business Identity, source IDs, content hashes, schema version, provider, and model match; serialize duplicate attempts with a PostgreSQL transaction-scoped advisory lock and unique successful/active fingerprint constraints. Persist the profile, source relationships, profile version, and successful run state in one transaction.

**Tech Stack:** Node.js ESM, PostgreSQL/pg, idempotent SQL migrations, Node test runner, React Query/Vitest for dashboard error UX.

**Spec:** User-approved Task 6 observability, evidence reuse, idempotency, and transactional persistence contract in this task.

## Global Constraints

- Keep `KNOWLEDGE_GENERATION_TIMEOUT_MS` and provider/model routing unchanged.
- Preserve Business Identity, Source Scope, conflict resolution, tenant isolation, and `APPROVED != ACTIVE`.
- Never log prompts, document contents, credentials, or secret values.
- Production is out of scope; deploy only `staging -> origin/staging`, without force push.
- Dashboard Button/Tab shared primitives are a separate checkpoint and commit after this blocker.

---

### Task 1: Generation attempt schema and safe persistence API

**Files:**
- Create: `migrations/029_generation_attempt_observability.sql`
- Modify: `services/knowledge-generation-persistence.js`
- Modify: `tests/knowledge-generation-persistence.test.js`
- Create: `tests/generation-attempt-migration.test.js`

**Interfaces:**
- Produces: `beginKnowledgeGenerationRun(...)`, `advanceKnowledgeGenerationRun(...)`, `completeKnowledgeGenerationRun(...)`, and `failKnowledgeGenerationRun(...)` with fingerprint, stage, counts, elapsed time, and safe error metadata.

- [ ] Write failing tests proving exact fingerprint metadata, allowed stages, failed-run telemetry, and restart-safe schema.
- [ ] Run the focused tests and verify failure because the columns/API do not exist.
- [ ] Add idempotent columns/checks/indexes and the minimal persistence API.
- [ ] Run the focused tests and verify GREEN.
- [ ] Commit the independently reviewable schema/persistence increment.

### Task 2: Exact resolved-evidence reuse and timeout classification

**Files:**
- Modify: `services/knowledge-profile-lifecycle.js`
- Modify: `services/business-identity-service.js` only if evidence normalization needs a shared pure helper.
- Modify: `services/knowledge-generation-provider.js` only to expose safe elapsed/stage behavior; do not change timeout values.
- Modify: `tests/knowledge-profile-lifecycle.test.js`
- Modify: `tests/knowledge-generation-provider.test.js`

**Interfaces:**
- Consumes: generation attempt API from Task 1.
- Produces: exact-scope evidence reuse keyed by tenant, identity, source ID/hash, schema version, provider, and model; stage-specific timeout failure.

- [ ] Write failing tests for identity timeout, profile timeout, late response exclusion, evidence reuse, changed-hash reanalysis, and exact scope preservation.
- [ ] Run and verify the expected RED failures.
- [ ] Implement the smallest evidence lookup and stage transitions.
- [ ] Run and verify focused GREEN.
- [ ] Commit the evidence-reuse/observability increment.

### Task 3: PostgreSQL idempotency and atomic profile persistence

**Files:**
- Modify: `services/knowledge-profile-lifecycle.js`
- Create: `test/knowledgeGenerationPostgres.test.js`
- Modify: `.github/workflows/staging-whatsapp-handoff-verification.yml`

**Interfaces:**
- Consumes: exact request fingerprint and generation run schema.
- Produces: one successful profile version per exact fingerprint, one active attempt per fingerprint, failed-attempt retry, and atomic persistence.

- [ ] Write real PostgreSQL tests for successful scoped generation, timeout/no artifact, exact retry, parallel retry, failed retry, cross-tenant rejection, and rollback/no partial artifact.
- [ ] Run against disposable PostgreSQL and verify RED for duplicates/partial writes.
- [ ] Add transaction-scoped advisory locking and transactional persistence using a connected `pg` client.
- [ ] Run real PostgreSQL tests and focused suites to GREEN.
- [ ] Commit the idempotency/transaction increment.

### Task 4: Dashboard generation error UX

**Files:**
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.test.tsx`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.tsx`

**Interfaces:**
- Consumes: safe generation error response and optional platform-admin run ID.
- Produces: explicit Generating state, safe retry state, and no tenant-facing provider internals.

- [ ] Write failing component tests for pending generation, timeout retry, and duplicate-safe messaging.
- [ ] Verify RED.
- [ ] Implement minimal error/retry presentation without shared Button/Tab refactor.
- [ ] Verify focused dashboard GREEN.
- [ ] Commit the dashboard error UX increment separately.

### Task 5: Full verification, staging deploy, and evidence checkpoint

**Files:**
- Modify only if required by a proven regression: `.github/workflows/staging-kb-v2-preflight.yml`

- [ ] Review the exact diff for scope violations and secret leakage.
- [ ] Run focused generation, Business Identity, Task 6 backend, real PostgreSQL, protected WhatsApp, dashboard, TypeScript, and production dashboard build checks.
- [ ] Push only `staging -> origin/staging` without force.
- [ ] Verify strict-TLS schema preflight, relevant staging workflow, Render SHA, health endpoints, `HEAD == origin/staging`, and clean tree.
- [ ] Stop for the user’s real dashboard Generate action; do not claim Task 6 GREEN.

## Self-Review

- Spec coverage: all 15 requested automated contracts map to Tasks 1-4; real PostgreSQL and staging evidence map to Tasks 3 and 5.
- Scope boundary: timeout changes and provider routing are explicitly excluded; Button/Tab standardization remains a later independent checkpoint.
- Type consistency: all lifecycle tasks consume the same fingerprint/run API introduced in Task 1.
- Placeholder scan: no implementation placeholder or customer-specific Meridian/Nova branch is included.
