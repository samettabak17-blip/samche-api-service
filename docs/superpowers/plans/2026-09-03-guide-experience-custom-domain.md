# Guide Experience + Custom Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every public Guide request through a tenant-owned hostname binding so published Guide Experience updates are visible without a redeploy and custom domains remain tenant-safe.

**Architecture:** Introduce an additive domain registry with normalized hostname uniqueness, a trusted-host runtime resolver, and Dashboard management APIs.  Public bootstrap, shell, sessions, conversations, and provider runtime will receive the resolved channel scope rather than the historical single `SAMCHEGUIDE:staging` key.

**Tech Stack:** Node.js/Express, PostgreSQL migrations, React/Vite Dashboard, Node test runner.

**Spec:** User request in this task thread: `TASK — COMPLETE GUIDE EXPERIENCE + CUSTOM DOMAIN PLATFORM END-TO-END`.

## Global Constraints

- Work on `staging`; never alter production.
- Preserve shared frontend/provider/runtime architecture; no tenant source branches.
- Do not stage `docs/engineering/dashboard-ui-ux-contract.md` or `docs/design-reference/`.
- Public scope is derived from trusted hostname only, never client-supplied tenant or assistant IDs.
- All functional changes start with a failing regression test.

---

### Task 1: Diagnose and lock public hostname resolution

**Files:**
- Modify: `test/samcheguideRuntimeResolver.test.js`
- Modify: `tests/guide-experience-public-runtime.test.js`
- Modify: `services/live-inbox-service.js`

- [ ] Add failing tests for normalized active hostname resolution, unknown/archived fail-closed results, and ownership consistency.
- [ ] Run the focused tests and observe the historical static integration-key behavior fail those tests.
- [ ] Implement a provider-neutral Guide domain runtime resolver that returns the channel’s verified tenant/assistant scope only.
- [ ] Re-run resolver tests.

### Task 2: Add persistent domain lifecycle

**Files:**
- Create: `migrations/058_guide_custom_domains.sql`
- Create: `services/guide-domain-service.js`
- Create: `test/guideDomainService.test.js`
- Modify: `tests/guide-experience-migration.test.js`

- [ ] Add failing service/migration tests for hostname normalization, unique active ownership, publish-safe lifecycle, archive, and fail-closed lookup.
- [ ] Run them and confirm the domain service/table are absent.
- [ ] Add an additive migration and service for PENDING/VERIFIED/ACTIVE/FAILED/ARCHIVED bindings, DNS verification metadata, and audit events.
- [ ] Re-run domain tests.

### Task 3: Wire canonical public renderer and runtime scope

**Files:**
- Modify: `app.js`
- Modify: `services/live-inbox-service.js`
- Modify: `services/public-conversation-session.js`
- Modify: `public-guide/index.html`
- Modify: `public-guide/guide.js`
- Create: `tests/guide-domain-public-runtime.test.js`

- [ ] Add failing public-runtime tests demonstrating that hostname selects the correct published experience and client query spoofing cannot affect scope.
- [ ] Run those tests and observe current static `SAMCHEGUIDE:staging` resolution fail.
- [ ] Make custom-domain root and `/guide/bootstrap`, public conversation, history, and chat use the one host-derived runtime scope; preserve neutral/no-leak error handling.
- [ ] Re-run public runtime tests.

### Task 4: Add Dashboard domain management

**Files:**
- Modify: `routes/guideExperienceRoutes.js`
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`
- Modify: `dashboard/src/types/api.ts`
- Modify: `dashboard/src/features/guide-experience/guide-experience-page.tsx`
- Create/Modify: focused Dashboard Guide Experience tests

- [ ] Add failing UI/API tests for adding, verifying, activating, and archiving a scoped domain with safe DNS instructions.
- [ ] Run focused Dashboard tests and confirm controls/client methods are absent.
- [ ] Implement minimal tenant-admin/OWNER guarded management flows and clear status copy without rendering provider controls.
- [ ] Re-run focused Dashboard tests.

### Task 5: Verify ingress, deployment, and controlled staging lifecycle

**Files:**
- Modify: `docs/engineering/ai-guide-white-label-platform.md`

- [ ] Inspect live staging host/Render domain configuration and identify the exact DNS target only from observed infrastructure.
- [ ] Run backend/domain/isolation tests, Dashboard suite, and production build.
- [ ] Deploy focused commits to `staging`, verify all service revisions and health endpoints.
- [ ] Use an authorized normal staging flow to prove draft isolation, preview, publish refresh, rollback refresh, scoped hostname resolution, and intact active profile/config/provider runtime; restore the intended Blue Dune experience.
