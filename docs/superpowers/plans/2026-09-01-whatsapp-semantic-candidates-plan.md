# WhatsApp Semantic Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate only canonical, reviewable durable business facts from image conversation segments.

**Architecture:** A SamChe-owned semantic adapter classifies extracted BUSINESS segments before candidate persistence. The candidate service persists canonical durable facts and their redacted raw evidence transactionally, while all non-durable categories are retained only as safe semantic results and cannot feed runtime knowledge automatically.

**Tech Stack:** Node.js ESM, PostgreSQL migrations, existing Knowledge Intelligence services/routes, React Query Dashboard, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-whatsapp-semantic-candidates-design.md`

## Global Constraints

- No tenant-specific phrases, prompts, or production rules.
- No automatic approval, Business Profile update, configuration activation, or runtime mutation.
- Preserve tenant isolation, PII redaction, provenance, deterministic idempotency, and existing document flows.
- Use no live OpenAI, Gemini, or other provider calls for implementation tests or verification.

---

### Task 1: Semantic classification contract

**Files:**
- Create: `services/image-knowledge-semantic-service.js`
- Test: `tests/image-knowledge-semantic-service.test.js`

**Interfaces:**
- Produces `classifyImageKnowledgeSegments({ segments, tenantName? })` returning `{ category, canonicalText, confidence, evidenceSegmentIds }[]`.
- Categories are `DURABLE_BUSINESS_FACT`, `ASSISTANT_BEHAVIOR_OR_QUALIFICATION`, `CUSTOMER_SPECIFIC_CONTEXT`, `TRANSIENT_CONVERSATION`, `DURABLE_POLICY_OR_COMMITMENT_CANDIDATE`, and `UNSAFE_OR_AMBIGUOUS`.

- [ ] Write failing tests for durable service facts, transient appointments, customer context echoed by BUSINESS, qualification questions, unverified promises, PII/timestamp removal, and CUSTOMER/UNKNOWN exclusion.
- [ ] Run `node --test tests/image-knowledge-semantic-service.test.js` and confirm the missing module/contract fails.
- [ ] Implement the bounded adapter contract and deterministic fake classifier used by tests; do not add provider-specific domain types.
- [ ] Re-run `node --test tests/image-knowledge-semantic-service.test.js` and confirm all cases pass.

### Task 2: Durable candidate persistence and regeneration

**Files:**
- Modify: `services/knowledge-candidate-service.js`
- Modify: `migrations/034_knowledge_image_candidates.sql` only if migration ordering requires a new additive migration; otherwise create `migrations/041_knowledge_image_candidate_semantics.sql`
- Test: `tests/knowledge-image-candidate-service.test.js`

**Interfaces:**
- Consumes Task 1 classifications.
- Persists only `DURABLE_BUSINESS_FACT` as `knowledge_candidates.status = 'NEEDS_REVIEW'` with canonical content and redacted image evidence.

- [ ] Write failing tests for canonical durable insertion, dedupe with multiple evidence records, non-durable exclusion, approved-candidate preservation, and unapproved regeneration replacement.
- [ ] Run `node --test tests/knowledge-image-candidate-service.test.js` and confirm failure reflects raw BUSINESS persistence.
- [ ] Add the smallest additive schema and transactional persistence change; retain raw redacted evidence and never overwrite APPROVED rows.
- [ ] Re-run the service tests and confirm canonical candidate generation passes.

### Task 3: Route and Dashboard truthfulness

**Files:**
- Modify: `routes/knowledgeIntelligenceRoutes.js`
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.tsx`
- Test: `tests/knowledge-image-candidate-route.test.js`
- Test: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.test.tsx`

**Interfaces:**
- Existing generate endpoint returns canonical candidates and safe result counts.
- Dashboard displays canonical text, semantic category, review state, and a safe no-durable-facts message.

- [ ] Write failing route/UI tests for semantic metadata, canonical candidate rendering, and no stale success message on an excluded-only result.
- [ ] Run the focused Node and Vitest tests and confirm failures.
- [ ] Implement safe DTO mapping and Dashboard presentation using existing shared primitives.
- [ ] Re-run focused tests and confirm route/UI behavior passes.

### Task 4: Regression and delivery verification

**Files:**
- Modify: relevant tests only.

- [ ] Run the semantic, image candidate, approval, source processing, profile, configuration, runtime, and document regression suites.
- [ ] Run `npm test -- --run` and `npm run build` in `dashboard`.
- [ ] Run `git diff --check`, commit only Task 6 semantic files, push `staging`, and verify staging API/Dashboard HTTP health.
