# Visual AI Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete, durable WhatsApp-only Visual AI generation lifecycle without paid provider calls or regressions to multimodal understanding.

**Architecture:** Extend Phase 1's job table only with durable output-message and delivery-correlation state. A WhatsApp-only orchestration service runs after the existing AI/human ownership gate; a lease-based worker invokes the capability-checked provider, converges generated resource/message/delivery state, and reuses canonical Live Inbox and WhatsApp media delivery services.

**Tech Stack:** Node.js ESM, PostgreSQL, existing object-storage abstraction, Meta WhatsApp delivery adapter, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-visual-ai-phase3-design.md`

## Global Constraints

- `REAL_VISUAL_PROVIDER_CALLS = 0`; never call a paid provider.
- WhatsApp only may generate; Web Chat and AI Guide remain understanding-only.
- `MOCK` is explicit staging/test configuration only; default production behavior is fail-closed provider unavailable.
- Preserve tenant/conversation/resource isolation, canonical human ownership, handling-version protection, existing resources, and Live Inbox.
- Do not add tenant-specific source code, provider credentials, plan pricing, or a public generation endpoint.

## Review Focus

- A duplicate delivery retry after Meta accepts media must reuse its stored WAMID and never send a second image; test in Task 3.
- A cross-tenant resource ID with a valid UUID must be rejected before storage/provider access; test in Task 2.
- A generated result whose resource is persisted before a worker restart must converge the existing resource/message rather than create another; test in Task 3.
- A HUMAN-owned conversation must not enqueue even if the inbound image and prompt are valid; test in Task 4.
- Production configuration without an explicit provider must expose unavailable capability rather than return deterministic media; test in Task 1.

---

### Task 1: Provider capability and explicit mock configuration

**Files:**
- Modify: `services/visual-ai-provider-adapter.js`
- Test: `tests/visual-ai-provider-adapter.test.js`

**Interfaces:**
- Produces: `getCapabilities(): { textToImage: boolean, imageConditionedGeneration: boolean, referenceImages: boolean }` and fail-closed `createVisualAIProvider` behavior.

- [ ] **Step 1: Write failing tests** for explicit mock capability and default unavailable provider.
- [ ] **Step 2: Run** `node --test tests/visual-ai-provider-adapter.test.js` and confirm failure.
- [ ] **Step 3: Implement** capability reporting, an unavailable provider, and explicit-only mock selection without any network implementation.
- [ ] **Step 4: Run** `node --test tests/visual-ai-provider-adapter.test.js` and confirm pass.

### Task 2: Intent/context safety and durable job schema

**Files:**
- Modify: `services/visual-intelligence-intent-service.js`
- Create: `migrations/088_visual_ai_phase3_delivery_orchestration.sql`
- Modify: `services/visual-ai-job-service.js`
- Test: `tests/whatsapp-visual-ai-intent.test.js`, `tests/visual-ai-job-service.test.js`, `tests/visual-ai-migration.test.js`

**Interfaces:**
- Produces: complete intent classifications, same-conversation resource resolver, job output/delivery state, and tenant-scoped idempotent resource/message preparation methods.

- [ ] **Step 1: Write failing tests** for intent separation, Arabic/Turkish context, missing references, tenant isolation, and migration constraints.
- [ ] **Step 2: Run** the focused test files and confirm failures.
- [ ] **Step 3: Implement** deterministic resolution and narrow durable columns/indexes; preserve Phase 1 job authority and `SKIP LOCKED` claim.
- [ ] **Step 4: Run** the focused test files and confirm pass.

### Task 3: Worker convergence and WhatsApp media delivery

**Files:**
- Modify: `services/visual-ai-job-service.js`
- Create: `services/visual-ai-generation-worker.js`
- Modify: `services/whatsapp-assistant-response-service.js` or create a narrowly-scoped delivery companion
- Test: `tests/visual-ai-job-service.test.js`, `tests/visual-ai-generation-worker.test.js`

**Interfaces:**
- Consumes: a claimed job, visual provider, storage, and `deliverWhatsAppMedia` boundary.
- Produces: `processOneVisualAiGenerationJob` and idempotent generated resource/message/media delivery state.

- [ ] **Step 1: Write failing tests** for one resource/message/delivery across duplicate/restart paths, retryable/permanent failures, and multi-worker claim behavior.
- [ ] **Step 2: Run** `node --test tests/visual-ai-job-service.test.js tests/visual-ai-generation-worker.test.js` and confirm failures.
- [ ] **Step 3: Implement** claimed-job conditional updates, output resource/message convergence, media delivery WAMID correlation, and bounded worker loop.
- [ ] **Step 4: Run** focused worker tests and confirm pass.

### Task 4: WhatsApp runtime integration and channel boundaries

**Files:**
- Modify: `app.js`
- Modify: `services/whatsapp-live-inbox-service.js` only if a direct, scoped runtime value is needed
- Test: `tests/whatsapp-visual-ai-runtime.test.js`, existing WhatsApp/Web Chat/Guide multimodal tests

**Interfaces:**
- Consumes: persisted WhatsApp inbound record and existing `shouldInvokeAi`/handling version values.
- Produces: durable enqueue/acknowledgement or safe missing-context response; no Web Chat/Guide generation hook.

- [ ] **Step 1: Write failing runtime tests** for explicit WhatsApp generation, HUMAN suppression, return-to-AI eligibility, and absent Web/Guide invocation.
- [ ] **Step 2: Run** focused runtime and channel regression tests and confirm failures.
- [ ] **Step 3: Implement** WhatsApp-only branch after the human-ownership gate and start the worker with explicit configuration.
- [ ] **Step 4: Run** runtime/channel tests and confirm pass.

### Task 5: Release verification and staging deployment

**Files:**
- Modify only files produced by Tasks 1-4.

- [ ] **Step 1: Run** all focused Visual AI, WhatsApp, Live Inbox, Web Chat, and Guide regression tests plus available PostgreSQL/golden-path gates.
- [ ] **Step 2: Run** `git diff --check` and inspect the final scoped diff.
- [ ] **Step 3: Commit** only Phase 3 files, refresh `origin/staging`, push without force, and verify local/remote hashes match.
- [ ] **Step 4: Verify** Render staging revision and health endpoint using explicit mock staging configuration; report any unavailable external deployment authority.
