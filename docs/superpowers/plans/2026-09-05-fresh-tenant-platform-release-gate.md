# Fresh Tenant Platform Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce cumulative Tasks 1–7 behavior for legacy and normally provisioned fresh tenants through one canonical service and one release gate.

**Architecture:** A validated code manifest describes shared capabilities, while one transaction-aware service invokes a database ensure function for baseline tenant state and existing-tenant repair. Long-running Business Profile work uses the existing durable Knowledge job queue, and the cumulative gate proves normal provisioning, durability, and isolation.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, node:test, React, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-fresh-tenant-platform-release-gate-design.md`

## Global Constraints

- Preserve historical data and every previously valid shared capability.
- Never hardcode a customer name, tenant ID, customer prompt, or production credential.
- Distinguish capability availability from feature enablement; do not create disabled feature entities.
- Use the same idempotent ensure semantics for new tenants and historical repair.
- Keep fixed lifecycle messages deterministic, localized, database-backed, and LLM-free.
- Keep all critical state durable and tenant-scoped.
- Do not commit or push until every repository-verifiable mandatory gate passes.

---

### Task 1: Canonical capability manifest and tenant ensure service

**Files:**
- Create: `services/platform-capability-registry.js`
- Create: `services/tenant-platform-provisioning-service.js`
- Create: `migrations/065_canonical_tenant_platform_provisioning.sql`
- Create: `tests/platform-capability-registry.test.js`
- Create: `tests/tenant-platform-provisioning-service.test.js`
- Modify: `services/customer-onboarding-service.js`
- Modify: `routes/tenantRoutes.js`
- Modify: `test/customerOnboardingService.test.js`

**Interfaces:**
- Produces: `PLATFORM_CAPABILITY_MANIFEST`, `validatePlatformCapabilityManifest()`, `provisionTenantPlatformCapabilities()`, and `repairTenantPlatformCapabilities()`.
- Consumes: caller-owned PostgreSQL clients and existing tenant plan/channel/assistant data.

- [ ] Write tests proving unique stable keys, complete manifest metadata, no customer identifiers, available/enabled separation, idempotent baseline ensure, and identical new/repair calls.
- [ ] Run the focused tests and confirm they fail because the manifest and service do not exist.
- [ ] Add the additive migration, drop the competing tenant trigger, backfill through one database ensure function, and record provisioning manifest version.
- [ ] Implement the minimal registry and transaction-aware provisioning service.
- [ ] Wire both tenant creation paths to the service before commit and correct the onboarding fixture's explicit plan.
- [ ] Run focused provisioning and onboarding tests to green.

### Task 2: Canonical fixed lifecycle message authority

**Files:**
- Create: `services/platform-lifecycle-message-service.js`
- Modify: `migrations/065_canonical_tenant_platform_provisioning.sql`
- Modify: `services/whatsapp-human-support-policy-service.js`
- Modify: `services/human-support-service.js`
- Modify: `app.js`
- Create: `tests/platform-lifecycle-message-service.test.js`
- Modify: `test/whatsappHumanSupportPolicy.test.js`
- Modify: `test/humanSupportService.test.js`

**Interfaces:**
- Produces: `loadPlatformLifecycleMessages()` and `renderPlatformLifecycleMessage()` for `human_support_request`, `human_session_warning`, `human_takeover`, and `return_to_ai`.
- Consumes: global localized database template rows and `{TOPIC}` only.

- [ ] Write failing tests for TR/EN/AR, unsupported-locale English fallback, `{TOPIC}` interpolation, unknown variables, and DB authority over assistant JSON.
- [ ] Run the focused tests and confirm the expected authority failures.
- [ ] Seed immutable canonical template keys idempotently in the migration.
- [ ] Route request, takeover, warning, and return-to-AI messages through the shared service without provider calls.
- [ ] Run Human Support, escalation, follow-up, and deterministic message regressions.

### Task 3: Durable Business Profile generation lifecycle

**Files:**
- Create: `migrations/066_business_profile_generation_jobs.sql`
- Modify: `services/knowledge-profile-lifecycle.js`
- Modify: `services/knowledge-semantic-generation-job-service.js`
- Modify: `routes/knowledgeIntelligenceRoutes.js`
- Modify: `app.js`
- Create: `tests/knowledge-business-profile-generation-job.test.js`
- Modify: `test/knowledgeGenerationPostgres.test.js`
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`
- Modify: `dashboard/src/types/api.ts`
- Modify: `dashboard/src/features/knowledge-intelligence/recommendation-generation-state.ts`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.tsx`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.test.tsx`

**Interfaces:**
- Produces: enqueue/get/claim/recover/process operations for `GENERATE_BUSINESS_PROFILE` jobs.
- Consumes: the existing scoped profile generation lifecycle and Knowledge worker.

- [ ] Write failing service tests proving enqueue idempotency, cross-tenant lookup rejection, lease recovery, result persistence, transient retry, terminal validation failure, and restart resume.
- [ ] Run focused tests and confirm the durable profile APIs are absent.
- [ ] Add the job type/index migration and minimal queue operations.
- [ ] Change profile generation POST to `202` enqueue and add tenant-scoped job GET.
- [ ] Extend the worker to process profile jobs and persist safe result metadata.
- [ ] Write failing Dashboard tests for accepted/poll/resume/ready/failed states and absence of false request-timeout UI.
- [ ] Implement condition-based polling through server job state and run focused backend/Dashboard tests.

### Task 4: Truthful multi-source eligibility

**Files:**
- Modify: `services/knowledge-overview-service.js`
- Modify: `routes/knowledgeIntelligenceRoutes.js`
- Modify: `dashboard/src/types/api.ts`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.tsx`
- Modify: `tests/knowledge-overview-service.test.js`
- Modify: `tests/knowledge-profile-lifecycle.test.js`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.test.tsx`

**Interfaces:**
- Produces: server-owned `business_profile_eligible` and bounded `business_profile_ineligibility_reason` source fields.
- Consumes: extraction, indexing, enabled, content hash, and active source state.

- [ ] Write failing tests distinguishing extraction READY, index READY, and profile eligibility for document and image sources.
- [ ] Run focused tests and confirm Overview and selector disagree.
- [ ] Implement one server eligibility projection and make Overview report separate counts.
- [ ] Render exact eligibility and exclusion reason in the Dashboard.
- [ ] Run source, image, identity, profile, and UI regressions.

### Task 5: Cumulative fresh-tenant release gate

**Files:**
- Create: `tests/fresh-tenant-golden-path.test.js`
- Create: `scripts/run-fresh-tenant-golden-path.js`
- Modify: `package.json`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: `npm run test:fresh-tenant-golden-path` with a non-production database guard and cumulative Task 1–7 assertions.
- Consumes: normal onboarding/provisioning services, public feature services, and two fresh plus one legacy-style isolated fixture.

- [ ] Write the failing golden-path contract with normal provisioning only, two-fresh-tenant isolation, legacy parity, restart reconstruction, and explicit production refusal.
- [ ] Run it without a test database and confirm it blocks rather than skips.
- [ ] Implement safe fixture lifecycle and cumulative capability assertions without customer-specific data.
- [ ] Add focused release-gate policy to `AGENTS.md` and one package command.
- [ ] Run the gate against an isolated test database; capture complete non-truncated output.

### Task 6: Regression repair and final verification

**Files:**
- Modify only files proven by failing relevant tests to violate the cumulative contract.

**Interfaces:**
- Consumes: full backend, Dashboard, migration, provisioning, Knowledge, Human Support, follow-up, escalation, CRM, and Guide suites.
- Produces: a clean intended diff eligible for the single staging commit.

- [ ] Run backend node tests with the repository's correct file set and classify environment-only failures separately.
- [ ] Run Dashboard Vitest and build with their native runner.
- [ ] Run migration and PostgreSQL contracts against the isolated test database.
- [ ] Run `npm run test:fresh-tenant-golden-path` with complete output.
- [ ] Run syntax checks and `git diff --check`.
- [ ] Review every changed file and preserve all pre-existing untracked items.
- [ ] Request an independent code review as required by the workflow, then fix Critical/Important findings.
- [ ] Stage explicit intended files only, commit once with `refactor: enforce fresh tenant platform release gate`, push only `origin staging`, and verify local HEAD equals `origin/staging` only if every mandatory repository-verifiable gate is proven.
