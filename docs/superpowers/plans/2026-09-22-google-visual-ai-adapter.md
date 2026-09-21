# Google Visual AI Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-isolated Google Visual AI adapter for `gemini-3.1-flash-image` with no real provider calls.

**Architecture:** A dedicated adapter translates canonical Visual AI requests to the Google SDK interaction schema and translates its response/errors back to the existing provider-neutral result and retry contract. The factory explicitly selects it only for `VISUAL_AI_PROVIDER=GOOGLE`; job and channel orchestration stay Google-agnostic.

**Tech Stack:** Node.js ESM, `@google/genai`, Node test runner, PostgreSQL-backed Visual AI job tests.

**Spec:** `docs/superpowers/specs/2026-09-22-google-visual-ai-adapter-design.md`

## Global Constraints

- `VISUAL_AI_PROVIDER` unset means unavailable; credentials alone must not select Google.
- `MOCK` is explicit and deterministic; no fallback to MOCK or Imagen is permitted.
- The Google Visual AI default model is `gemini-3.1-flash-image`.
- No migration, arbitrary external URL fetching, deployment configuration change, or real provider call is allowed.
- Canonical tenant, resource, conversation, security, retry, Live Inbox, WhatsApp, WebChat, and AI Guide behavior must remain compatible.
- `REAL_VISUAL_PROVIDER_CALLS = 0`.

## Review Focus

- An authenticated environment with no `VISUAL_AI_PROVIDER` still fails closed; test factory selection.
- A non-image SDK response cannot persist or deliver a generated resource; test terminal normalization failure.
- Multiple references preserve each image's MIME and ordering; test adapter request construction.
- Provider errors never leak raw messages or objects into the job layer; test canonical safe errors.
- WebChat and Guide image-generation boundaries remain disabled despite Visual AI Google support; run existing boundary regressions.

---

### Task 1: Define the Google Visual AI boundary and factory selection

**Files:**
- Create: `services/google-visual-ai-provider.js`
- Modify: `services/visual-ai-provider-adapter.js`
- Test: `tests/visual-ai-provider-adapter.test.js`

**Interfaces:**
- Consumes: canonical image request and `@google/genai` client factory.
- Produces: `createGoogleVisualAIProvider({ env, clientFactory })` with `generateConcept`, `getProviderIdentity`, and `getCapabilities`.

- [x] **Step 1: Write failing factory/model/capability tests**

```js
const provider = createVisualAIProvider({ providerType: 'GOOGLE', env: { GOOGLE_GENAI_MODE: 'developer', GEMINI_API_KEY: 'test', VISUAL_AI_PROVIDER: 'GOOGLE' }, googleClientFactory: () => fakeClient });
assert.deepEqual(provider.getProviderIdentity(), { provider: 'GOOGLE', model: 'gemini-3.1-flash-image' });
assert.equal(provider.getCapabilities().imageEditing, true);
```

- [x] **Step 2: Run the focused test and verify it fails because Google is still the Phase 1 placeholder.**

- [x] **Step 3: Implement only the explicit factory selection and dedicated adapter configuration.**

- [x] **Step 4: Run the focused test and verify that Google, MOCK, and unavailable selection are correct.**

### Task 2: Map canonical requests and normalize Google responses/errors

**Files:**
- Modify: `services/google-visual-ai-provider.js`
- Modify: `services/visual-ai-provider-adapter.js`
- Test: `tests/visual-ai-provider-adapter.test.js`

**Interfaces:**
- Consumes: `instruction`, source/reference image buffers, output options, safe metadata, and injected `interactions.create` stub.
- Produces: normalized visual result or canonical `VisualAIProviderError`/`VisualAISafetyError`.

- [x] **Step 1: Write failing tests for source/reference mapping, MIME ordering, output normalization, no-image response, and each canonical error category.**

- [x] **Step 2: Run the focused tests and verify each fails at the missing mapping or normalization behavior.**

- [x] **Step 3: Implement the smallest request mapper, response parser, and safe error mapper within the Google adapter.**

- [x] **Step 4: Run the focused test file and verify it passes with only injected SDK stubs.**

### Task 3: Preserve canonical job input and observability contracts

**Files:**
- Modify: `services/visual-ai-job-service.js`
- Modify: `services/visual-ai-runtime-observability-service.js`
- Test: `tests/visual-ai-job-service.test.js`
- Test: `tests/visual-ai-startup-observability.test.js`

**Interfaces:**
- Consumes: same-tenant/same-conversation resources and normalized provider result.
- Produces: canonical source/reference image arrays at the provider boundary and safe startup capability fields.

- [x] **Step 1: Write failing tests that assert job-provided target/reference resources become canonical image collections and Google startup reports image conditioning/reference support.**

- [x] **Step 2: Run those focused tests and verify the current singular request contract lacks the collection fields.**

- [x] **Step 3: Preserve ownership queries and storage loading while passing canonical source/reference collections; add the editing capability only to safe observability where already represented.**

- [x] **Step 4: Re-run the focused job and observability tests.**

### Task 4: Regression verification and staging release

**Files:**
- Test: `tests/visual-ai-generation-worker.test.js`
- Test: `tests/visual-ai-postgres-convergence.test.js`
- Test: `tests/whatsapp-visual-ai-intent.test.js`
- Test: `tests/whatsapp-multimodal-non-regression.test.js`
- Test: `tests/webchat-multimodal-understanding.test.js`
- Test: `tests/guide-multimodal-understanding.test.js`
- Test: `tests/web-chat-visual-consistency.test.js`
- Test: `tests/staging-live-inbox-acceptance-contract.test.js`

- [x] **Step 1: Run each focused adapter and Visual AI regression suite with network-free stubs.**
- [x] **Step 2: Run relevant syntax/build checks and `git diff --check`.**
- [ ] **Step 3: Review the task-only diff, commit it, refresh `origin/staging`, and push without force.**
- [ ] **Step 4: Verify local and remote staging heads match, then verify the deployed staging revision and `/api/v1/health` HTTP 200 without changing environment configuration.**
