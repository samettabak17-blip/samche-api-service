# Task 7 Conversational Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure conversational-first Guide with progressive responses and durable shared session memory.

**Architecture:** The API owns canonical Guide response events and server-side opaque-session persistence. The shared Guide renderer consumes canonical events for both Roadmap and Assistant, with safe progressive fallback where a provider does not stream.

**Tech Stack:** Node.js/Express, PostgreSQL migrations, browser JavaScript/CSS, Vitest/node:test.

**Spec:** `docs/superpowers/specs/2026-09-03-task7-conversational-guide-design.md`

## Global Constraints

- Staging only; never publish, restore, archive, or directly mutate V7/V10.
- Never modify production, DNS, domain ownership, or Render topology.
- No tenant-specific runtime branches, executable tenant code, `eval`, `Function`, provider UI controls, or unsafe model HTML.
- Preserve signed preview authorization, published-only public resolution, tenant/assistant/domain isolation, and `QUOTE_REQUIRED` behavior.

---

### Task 1: Canonical Guide responses and durable session service

**Files:**
- Create: `services/guide-conversation-service.js`
- Create: versioned Guide-session migration
- Modify: `server.js` and Guide session routes
- Test: `test/guideConversationService.test.js`

- [ ] Write failing tests for canonical event validation, opaque scoped resume, preview/public partition and expired/cross-tenant rejection.
- [ ] Run the focused test and confirm missing service failure.
- [ ] Implement validated event generation, bounded server-state persistence and opaque resume resolution.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Conversational Roadmap and Assistant API contracts

**Files:**
- Modify: `server.js`, `services/guide-session-service.js`, `services/guide-conversation-service.js`
- Test: `test/guideConversationRoute.test.js`, `test/guide-session-handoff-route.test.js`

- [ ] Write failing route tests for roadmap intent/follow-up, assistant events, safe provider fallback and context/tool prefilling.
- [ ] Run them and confirm expected route failures.
- [ ] Implement host-scoped route resolution and canonical event responses without a provider-specific UI contract.
- [ ] Re-run tests and confirm pass.

### Task 3: Shared progressive Guide renderer

**Files:**
- Modify: `public-guide/guide.js`, `public-guide/guide.css`
- Test: `test/publicGuideRuntime.test.js`

- [ ] Write failing runtime tests for immediate thinking, visible multi-chunk rendering, safe headings/lists, no raw partial Markdown, review/back and reminder state.
- [ ] Run the focused test and confirm failures.
- [ ] Implement one progressive renderer, conversational Roadmap composer, safe formatter, reminder bubble and reduced-motion behavior.
- [ ] Re-run test and confirm pass.

### Task 4: Current-asset integrity and configuration normalization

**Files:**
- Modify: `services/guide-experience-service.js`, `services/guide-experience-recommendation-service.js`, `services/guide-theme-service.js`
- Test: `test/guideExperienceRecommendation.test.js`, `test/publicGuideRuntime.test.js`

- [ ] Write failing tests for current-only asset precedence and configuration-driven intents.
- [ ] Run tests and confirm failures.
- [ ] Implement normalized optional conversation configuration and no-secondary-avatar rendering rule.
- [ ] Re-run tests and confirm pass.

### Task 5: Verification and staging delivery

- [ ] Run all focused Guide, session, domain and security tests.
- [ ] Run Dashboard tests/build if Dashboard changes.
- [ ] Run syntax checks and `git diff --check`.
- [ ] Commit only Task 7 files and push `staging`.
- [ ] Verify deployed revision, API/DB/Dashboard/Guide health and real-domain public semantics without publishing V10.
