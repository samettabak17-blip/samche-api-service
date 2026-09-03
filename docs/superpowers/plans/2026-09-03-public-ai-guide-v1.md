# Public AI Guide V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shared public Guide into a tenant-configured three-module customer application: Roadmap, Interactive Tool, and AI Assistant.

**Architecture:** Keep `guide_experience_versions.experience` as the tenant-owned, versioned configuration source. Normalize all newly introduced roadmap/tool/module fields server-side, preserve valid legacy experiences with defaults, and validate browser session context against the published configuration before injecting a bounded structured summary into the existing scoped Guide runtime.

**Tech Stack:** Express, PostgreSQL JSONB Experience versions, vanilla public Guide JS/CSS, React/Vite Dashboard, Vertex-backed existing Guide runtime.

**Spec:** User-approved Task 7 Final — Public AI Guide Experience V1 request.

## Global Constraints

- Staging only; never modify production DNS, production data, or production environment.
- No tenant-specific frontend branches, prompts, executable calculator code, `eval`, or provider/model controls.
- Preserve exact hostname → tenant → assistant resolution, Draft/Preview/Publish/Restore, and current custom domain.
- Existing V4/V5 Experiences remain valid through generic defaults.
- Shared static Guide assets remain scope-independent; tenant data remains exact-host scoped.

---

### Task 1: Versioned Experience Configuration Contract

**Files:**
- Modify: `services/guide-experience-service.js`
- Modify: `dashboard/src/types/api.ts`
- Test: `test/guideExperienceService.test.js`

- [ ] Write failing tests for valid roadmap/tool configurations, legacy defaults, invalid calculation rules, unsafe labels, and module toggles.
- [ ] Add bounded data-only normalization for hero, roadmap, tool, assistant display, and actions.
- [ ] Verify only supported numeric/select/boolean fields and deterministic rule types are accepted.
- [ ] Run `node --test test/guideExperienceService.test.js`.

### Task 2: Scoped Guide Session Context

**Files:**
- Create: `services/guide-session-context-service.js`
- Modify: `app.js`
- Test: `test/guideSessionContextService.test.js`

- [ ] Write failing tests proving a client can only submit roadmap/tool values defined by its current published Experience and that context is partitioned by tenant, assistant, channel, session, and Experience version.
- [ ] Add a bounded server-side session context store and a context summary builder that never accepts browser tenant/assistant identifiers.
- [ ] Validate `/chat` context against the exact hostname’s published Experience and add only the server-validated summary to the existing runtime instruction.
- [ ] Run the focused session/runtime tests.

### Task 3: Public Three-Module Guide Renderer

**Files:**
- Modify: `public-guide/guide.js`
- Modify: `public-guide/guide.css`
- Test: `test/publicGuideRuntime.test.js`

- [ ] Write a failing public-runtime contract test for persistent Roadmap / Interactive Tool / AI Assistant navigation and safe bootstrap failure rendering.
- [ ] Implement a single mobile-first bounded canvas with tenant identity, hero, module navigation, roadmap progression, deterministic calculator, and integrated chat.
- [ ] Preserve draft/public separation by consuming bootstrap only; retain module state in the scoped browser session and submit validated context with chat requests.
- [ ] Run public Guide tests and `node --check public-guide/guide.js`.

### Task 4: Dashboard Editor and Private Preview

**Files:**
- Modify: `dashboard/src/features/guide-experience/guide-experience-page.tsx`
- Modify: `dashboard/src/features/guide-experience/guide-experience-page.test.tsx`
- Modify: `dashboard/src/types/api.ts`

- [ ] Write failing component tests for Roadmap and Tool editor sections and a three-module private preview.
- [ ] Add safe controlled editors for roadmap steps, tool fields/rules, labels, and module visibility; never expose raw JSON/provider/model controls.
- [ ] Make private preview show the same three-module structural experience from draft data.
- [ ] Run `npm test -- --run src/features/guide-experience/guide-experience-page.test.tsx` and `npm run build` in `dashboard`.

### Task 5: Health Signal, Integration Verification, and Deployment

**Files:**
- Modify: `app.js`
- Test: `test/publicGuideRuntime.test.js`, `test/guideDomainService.test.js`

- [ ] Add a safe public Guide bootstrap health signal with shell/bootstrap/module/runtime readiness metadata, without exposing secrets or private Experience data.
- [ ] Run complete affected backend/domain/runtime tests, Dashboard tests, Dashboard production build, and `git diff --check`.
- [ ] Commit only Task 7 files, push `staging`, wait for deployed revision, and verify real custom-host document, JS, CSS, bootstrap semantics, assets, CORS, and health.
