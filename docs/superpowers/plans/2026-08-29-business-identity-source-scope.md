# Business Identity Source Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent mixed-company Business Profiles by requiring an explicit tenant-scoped business identity and exact eligible source set.

**Architecture:** Add an additive identity/source-evidence model, analyze each selected source before generation, fail closed on conflicts, persist exact provenance, and carry that boundary through recommendation/configuration generation. Expose the boundary through the existing Knowledge Intelligence dashboard.

**Tech Stack:** PostgreSQL, Node.js/Express, Gemini/OpenAI provider adapter, React, TanStack Query, Vitest/node:test.

**Spec:** `docs/superpowers/specs/2026-08-29-business-identity-source-scope-design.md`

## Global Constraints

- Staging only; production is untouched.
- Assistant assignment is not a business identity boundary.
- No customer-specific identity or prompt logic.
- Generation remains source-only and starts at `NEEDS_REVIEW`.
- Unresolved conflicts cannot be approved or activated.
- Automated tests do not replace manual staging acceptance.

---

### Task 1: Additive identity schema

**Files:** Create `migrations/027_business_identity_source_scope.sql`; create `tests/business-identity-migration.test.js`.

**Interfaces:** Produces tenant-scoped identities, source links/evidence, profile identity FK, exact source scope, and resolution status.

- [ ] Write migration contract tests for tables, composite tenant FKs, indexes, idempotent guards, and profile columns.
- [ ] Run the test and verify RED because migration 027 is absent.
- [ ] Implement the restart-safe additive migration.
- [ ] Run the focused migration test and verify GREEN.
- [ ] Commit schema and tests.

### Task 2: Identity analysis and scoped generation

**Files:** Create `services/business-identity-service.js`; modify `services/knowledge-generation-provider.js`, `services/knowledge-profile-lifecycle.js`; modify `tests/knowledge-generation-provider.test.js`; modify `tests/knowledge-profile-lifecycle.test.js`.

**Interfaces:** Produces `list/createBusinessIdentity`, `analyzeBusinessProfileSourceScope`, and `generateBusinessProfileVersion({ businessIdentityId, sourceIds })`.

- [ ] Write failing tests for matching identities, conflicting identities, cross-tenant/disabled/non-ready source rejection, Nova/Meridian exclusion, and exact provenance.
- [ ] Run focused tests and verify each RED failure represents missing scope behavior.
- [ ] Implement provider-independent normalized comparison and provider identity-analysis output validation.
- [ ] Implement exact source query and conflict gate before profile generation.
- [ ] Persist analysis evidence and exact selected source provenance.
- [ ] Run focused tests and verify GREEN.
- [ ] Commit scoped generation.

### Task 3: Lifecycle and configuration boundary

**Files:** Modify `services/knowledge-configuration-service.js`, `services/knowledge-assistant-lifecycle.js`; modify corresponding tests.

**Interfaces:** Approval/activation consume resolved scoped versions; recommendation/configuration provenance carries `business_identity_id` and `source_scope`.

- [ ] Write failing tests for unresolved approval and activation blocks.
- [ ] Write failing tests proving recommendation/configuration use only the active profile scope.
- [ ] Implement minimal backend predicates and provenance propagation.
- [ ] Run focused lifecycle tests and verify GREEN.
- [ ] Commit lifecycle safety.

### Task 4: API and dashboard scope UX

**Files:** Modify `routes/knowledgeIntelligenceRoutes.js`, `dashboard/src/types/api.ts`, `dashboard/src/features/dashboard/dashboard-api.ts`, `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.tsx`, and focused dashboard tests.

**Interfaces:** Adds list/create identities, analyze scope, and scoped profile generation endpoints and client methods.

- [ ] Write failing route and component tests for identity creation/selection, source selection, visible conflict evidence, and blocked generation.
- [ ] Verify tests RED.
- [ ] Add tenant-admin endpoints and safe conflict responses.
- [ ] Add responsive scope form and provenance display using existing dashboard tokens.
- [ ] Verify focused tests GREEN.
- [ ] Commit API/dashboard UX.

### Task 5: Regression and staging evidence

**Files:** Modify staging contract/preflight coverage only where required.

- [ ] Run Task 6 backend tests, legacy Knowledge Base, protected WhatsApp, Human Take Over/Return to AI, media/attachments/delivery, dashboard tests, TypeScript, and production dashboard build.
- [ ] Review exact diff and verify clean logical commit boundaries.
- [ ] Push only `staging -> origin/staging` without force.
- [ ] Verify Render staging migrations, API/dashboard deploy, and strict-TLS schema preflight.
- [ ] Report the manual Meridian/Nova checklist and keep Task 6 BLOCKED pending user acceptance.

