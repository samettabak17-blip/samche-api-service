# Canonical Tenant Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently prove canonical lifecycle parity across historical,
fresh, and isolation tenants without fabricating user-owned entities.

**Architecture:** Extend the existing capability registry and real PostgreSQL
Golden Path as a contract layer. Reuse existing canonical domain services and
runtime resolvers rather than adding parallel provisioning or channel truth.

**Tech Stack:** Node.js ESM, PostgreSQL/pgvector, node:test, React/Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-canonical-tenant-lifecycle-design.md`

## Global Constraints

- Provisioning creates platform baseline state only.
- All domain entities remain created through their existing normal operations.
- Historical repair and fresh provisioning share tenant-scoped idempotent paths.
- No customer data, tenant identifiers, credentials, or provider-specific truth appears in fixtures.
- Real PostgreSQL is mandatory for lifecycle relations, migrations, and retrieval.

---

### Task 1: Make lifecycle relationship ownership machine-verifiable

**Files:**
- Modify: `services/platform-capability-registry.js`
- Modify: `tests/platform-capability-registry.test.js`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces capability metadata with canonical owner, creator/ensure boundary,
  historical convergence path, and fresh path.
- Consumes existing tenant provisioning and domain service names.

- [x] Write failing registry tests requiring explicit ownership metadata and no
  hidden domain-entity creator in capability provisioning.
- [x] Run the focused test and confirm it fails because the metadata is absent.
- [x] Add only generic ownership metadata and validate it.
- [x] Add the generic AGENTS.md invariant without tenant names.
- [x] Run focused registry/provisioning tests.

### Task 2: Add real PostgreSQL normal-domain lifecycle Golden Path

**Files:**
- Modify: `tests/fresh-tenant-golden-path.test.js` or create
  `tests/platform-lifecycle-golden-path-postgres.test.js`
- Modify only direct domain-service tests proven necessary.

**Interfaces:**
- Consumes normal onboarding, identity, assistant, source, candidate approval,
  indexing, configuration activation, and runtime resolver interfaces.
- Produces a historical-equivalent/fresh/isolation parity verdict.

- [ ] Write a failing test that creates baseline tenants normally, then uses
  canonical domain services for on-demand identity, assistant, source and
  lifecycle relations.
- [ ] Verify the test fails on the first absent canonical relationship rather
  than seeding it directly.
- [ ] Fix only that proven owner/creator gap.
- [ ] Assert tenant C cannot resolve tenant B source, profile, configuration,
  retrieval or channel state.
- [ ] Run it twice against disposable PostgreSQL to prove idempotency.

### Task 3: Prove one Guide/Web/WhatsApp runtime brain

**Files:**
- Modify: `tests/knowledge-runtime-samcheguide-integration.test.js`
- Modify: `tests/knowledge-runtime-whatsapp-integration.test.js`
- Create/modify: focused shared-runtime behavior test

**Interfaces:**
- Consumes `resolveChannelAssistantRuntime`,
  `resolveAssistantRuntimeKnowledgeContext`, and `retrieveApprovedKnowledge`.
- Produces one tenant/assistant/configuration/retrieval contract for all three
  channels.

- [x] Write a behavioral contract for the same approved canonical fact
  through Guide, Web and WhatsApp resolvers.
- [x] Verify tenant/assistant/profile/configuration disagreement fails closed.
- [x] No shared-resolver correction was indicated by the contract.
- [x] Run focused runtime and cross-tenant tests.

### Task 4: Verify migration replay and historical convergence

**Files:**
- Modify only replayed migration/test files proven hazardous.
- Modify: `tests/knowledge-job-type-migration-postgres.test.js` or another
  focused real PostgreSQL migration contract.

- [ ] Run fresh first/second migration replay and historical upgrade fixtures.
- [ ] Search only migration forms that can narrow canonical lifecycle contracts.
- [ ] Add a real PostgreSQL regression for each demonstrated replay hazard.
- [ ] Confirm migration 067 and retrieval scope inheritance remain idempotent.

### Task 5: Release gates and Guide readiness

**Files:**
- No production file unless a failing gate proves a generic defect.

- [ ] Run focused capability, lifecycle, shared runtime, migration and retrieval tests.
- [ ] Run real PostgreSQL Golden Path, Fresh Tenant Golden Path, backend
  cumulative suite, Dashboard suite, build, syntax/static checks and diff check.
- [ ] Verify processes terminate naturally and prior capabilities remain green.
- [ ] Commit only completed lifecycle changes, push staging, and confirm remote match.
- [ ] Prepare Guide human acceptance; do not make PWA completion a prerequisite.
