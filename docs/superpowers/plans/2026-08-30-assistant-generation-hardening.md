# Assistant Recommendation and Configuration Generation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan.

**Goal:** Harden Assistant Recommendation and Configuration V2 generation with scoped idempotency, stage-aware observability, atomic persistence, and explicit Dashboard terminal states so the valid ACTIVE profile can produce an explicitly activated runtime configuration.

**Architecture:** Extend the existing `knowledge_generation_runs` fingerprint contract rather than create a second generation subsystem. Recommendation and Configuration each derive a deterministic fingerprint from tenant, Assistant, current ACTIVE profile, Business Identity, immutable source scope/hashes, schema version, and provider policy; a PostgreSQL advisory lock plus partial unique indexes serialize equivalent attempts. Provider work remains outside the persistence transaction, while artifact insertion and run completion share one transaction and re-check that the run is still RUNNING.

**Tech Stack:** Node.js/Express, PostgreSQL, React, TanStack Query, Vitest/Node test runner.

**Spec:** User-approved Task 6 hardened Recommendation/Configuration contract in this thread; builds on `docs/superpowers/specs/2026-08-29-tenant-persona-isolation-design.md` and `docs/superpowers/plans/2026-08-29-generation-attempt-observability-idempotency.md`.

---

### Task 1: Define failing generation lifecycle contracts

**Files:**
- Modify: `tests/knowledge-assistant-lifecycle.test.js`
- Modify: `test/knowledgeGenerationPostgres.test.js`
- Modify: `test/knowledgeConfigurationPostgres.test.js`

1. Add failing tests for exact ACTIVE-profile/source-scope fingerprints, timeout classification, no artifact after failure, failed retry, active/parallel duplicate guards, successful reuse, NEEDS_REVIEW-only persistence, and cross-tenant rejection.
2. Add real PostgreSQL tests for uniqueness, transactional rollback, exact run-to-target relation, stale-profile configuration rejection, and APPROVED != ACTIVE.
3. Run the focused tests and retain the RED evidence before implementation.

### Task 2: Extend additive persistence schema and generation primitive

**Files:**
- Create: `migrations/031_assistant_generation_hardening.sql`
- Modify: `services/knowledge-generation-persistence.js`
- Modify: `tests/generation-attempt-migration.test.js`
- Modify: `tests/knowledge-generation-persistence.test.js`

1. Extend the restart-safe stage constraint for `PROFILE_CONTEXT`, `RECOMMENDATION_GENERATION`, and `CONFIGURATION_GENERATION`.
2. Add only additive indexes/constraints needed for run/artifact integrity and exact reuse.
3. Generalize safe run-stage metrics and transaction-client support without changing provider routing or timeout.
4. Verify migration idempotency and rollback behavior.

### Task 3: Harden Recommendation generation

**Files:**
- Modify: `services/knowledge-assistant-lifecycle.js`
- Modify: `routes/knowledgeIntelligenceRoutes.js`

1. Resolve the exact ACTIVE profile and immutable scope/hashes, rejecting stale/cross-tenant inputs.
2. Compute deterministic provider-policy fingerprint and serialize equivalent attempts.
3. Reuse exact successful artifacts, guard RUNNING attempts, and permit safe FAILED retries.
4. Record `PROFILE_CONTEXT`, `RECOMMENDATION_GENERATION`, and `PERSISTENCE` elapsed stages.
5. Persist Recommendation + successful run atomically and return `{ recommendation, reused, run_id }` with 201/200.

### Task 4: Harden Configuration generation

**Files:**
- Modify: `services/knowledge-assistant-lifecycle.js`
- Modify: `routes/knowledgeIntelligenceRoutes.js`

1. Require an APPROVED recommendation whose source profile is still the exact ACTIVE profile.
2. Fingerprint tenant, Assistant, profile identity/scope/hashes, recommendation, schema, and provider policy.
3. Apply the same active guard, reuse, retry, stage timing, and atomic persistence contract.
4. Preserve `source_profile_version_id`, NEEDS_REVIEW, APPROVED != ACTIVE, and activation validation.

### Task 5: Add explicit Dashboard terminal UX

**Files:**
- Modify: `dashboard/src/types/api.ts`
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.tsx`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.test.tsx`

1. Add response types for Recommendation and Configuration generation.
2. Add scope-bound terminal states: GENERATING, SUCCESS, REUSED, TIMEOUT, FAILED.
3. Surface short IDs, NEEDS_REVIEW / NOT ACTIVE, and exact Review actions; retain returned artifacts even if refetch fails.
4. Clear/hide stale terminal results when Assistant/profile/recommendation scope changes.
5. Add failing then passing component tests for every terminal state and no-silent-idle behavior.

### Task 6: Verify, commit, push, and deploy staging

**Files:**
- Review all changed files and generated lockfiles only if intentionally changed.

1. Run focused lifecycle and real PostgreSQL suites, migration tests, strict-TLS preflight contract, Dashboard focused/full tests, TypeScript, production-mode Dashboard build, Task 6 backend regression, and protected WhatsApp/handoff regression.
2. Review the exact diff and confirm no timeout/provider/persona/source-scope changes slipped in.
3. Commit in bounded logical commits, push only `staging -> origin/staging` without force, and verify `HEAD == origin/staging` plus clean tree.
4. Verify staging health/deployment and run the real Recommendation request once to collect stage timing. Do not change the 20-second timeout without repeated measured evidence.
5. Stop with Task 6 BLOCKED and hand off the explicit Dashboard Recommendation -> Configuration -> Activate -> WhatsApp manual checklist.
