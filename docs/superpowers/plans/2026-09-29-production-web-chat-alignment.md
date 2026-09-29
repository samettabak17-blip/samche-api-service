# Production Web Chat Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared localized public chat failure boundary, isolate canonical Support from legacy Guide sales behavior, remove verified stale links, and prepare—but do not publish—the Hostinger canonical Web Chat integration.

**Architecture:** A focused service resolves the latest-message locale, builds the safe public reply, and writes sanitized diagnostics. Both public chat routes consume it without sharing provider schemas; the canonical browser client supplies only transport-level localized fallback. Hostinger will later embed the existing signed-session Web Chat client instead of calling `/chat` directly.

**Tech Stack:** Node.js ESM, Express, node:test, existing SamChe language and Web Chat services, vanilla browser JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-29-production-web-chat-alignment-design.md`

## Global Constraints

- Preserve `/chat` AI Guide semantics; never turn it into Support.
- Latest customer message has language priority; fallback is bounded to `tr`, `en`, or `ar`, then English.
- Never expose or log through this boundary any raw provider payload, response body, prompt, secret, credential, stack trace, provider name, or infrastructure diagnostic.
- Do not change DNS, production hosting, production secrets, production infrastructure, Render production deployment, or Hostinger publication.
- Preserve canonical tenant behavior, historical/fresh tenant parity, tenant isolation, and existing signed-session authority.

## Review Focus

- An ambiguous latest message must use an allowed fallback locale and never an arbitrary browser value; covered in Task 1.
- A malicious error message containing multiline provider JSON or secrets must not reach either response or sanitized log; covered in Task 1.
- A malformed successful provider object must take the same safe path as a thrown provider failure; covered in Task 2.
- The legacy Guide route must retain validation and routing behavior while only its terminal failure changes; covered in Task 2.
- The browser must not render an upstream non-JSON error body when the server fails; covered in Task 3.

---

### Task 1: Shared public chat failure service

**Files:**
- Create: `services/public-chat-failure.js`
- Create: `tests/public-chat-failure.test.js`

**Interfaces:**
- Produces: `resolvePublicChatLanguage({ latestMessage, fallbackLocale }): 'tr' | 'en' | 'ar'`
- Produces: `buildPublicChatFailure({ latestMessage, fallbackLocale }): { error: 'TEMPORARY_RESPONSE_FAILURE', reply: string }`
- Produces: `logPublicChatFailure({ logger, route, stage, correlationId, error }): void`

- [ ] **Step 1: Write failing table-driven tests** for exact TR/EN/AR copy, latest-message precedence, ambiguous fallback, safe default, status/code normalization, and malicious raw error exclusion from both payload and captured log.
- [ ] **Step 2: Run `node --test tests/public-chat-failure.test.js`** and confirm failure because the service does not exist.
- [ ] **Step 3: Implement the three exported functions** using `inferConservativeCommunicationLanguage`, literal reply templates, strict allowlists, and one single-line structured diagnostic.
- [ ] **Step 4: Rerun the focused test** and confirm all cases pass.
- [ ] **Step 5: Commit the service and tests** as one task-scoped commit.

### Task 2: Server route containment and support isolation regression

**Files:**
- Modify: `app.js`
- Modify: `tests/google-gemini-provider.test.js`
- Create: `tests/public-chat-route-failure.test.js`
- Create or modify: `tests/web-chat-support-intelligence.test.js`

**Interfaces:**
- Consumes: Task 1 public failure service.
- Produces: `/chat` and `/api/chat` terminal failures that return only the safe localized payload while retaining existing route semantics.

- [ ] **Step 1: Write failing route tests** for quota/rate-limit, timeout, provider 5xx, malformed output, and unexpected exceptions; assert TR/EN/AR localization and absence of raw provider/debug fields.
- [ ] **Step 2: Write the failing Instagram two-turn canonical Support regression** asserting retained Instagram context and exclusion of Guide sales/visa behavior, dead links, internal terms, developer routes, tenant IDs, and invented transfer capability.
- [ ] **Step 3: Run both focused test files** and confirm failures at the current unsafe route boundary.
- [ ] **Step 4: Integrate the shared boundary** into `/api/chat` and `/chat`, add explicit provider-output shape validation, retain 400 Guide request validation, and remove full exception logging.
- [ ] **Step 5: Rerun focused tests and existing Guide/Web Chat regressions** until green.
- [ ] **Step 6: Commit route integration and regressions** as one task-scoped commit.

### Task 3: Canonical browser fallback and stale links

**Files:**
- Modify: `public/web-chat.js`
- Modify: `tests/web-chat-canonical-runtime-turn.test.js`
- Modify: `app.js`
- Create or modify: `tests/public-customer-link-contract.test.js`

**Interfaces:**
- Consumes: Task 1 exact localized copy and the server `{ error, reply }` contract.
- Produces: browser transport fallback selected from the latest message/current bounded locale; no rendering of raw failed response bodies.

- [ ] **Step 1: Write failing browser behavior tests** proving TR/EN/AR transport fallback and rejection of raw non-JSON failure bodies.
- [ ] **Step 2: Write failing link contract tests** for context-specific removal/replacement of every customer-facing dead hostname reference.
- [ ] **Step 3: Run the focused tests** and confirm the current Turkish-only/raw-text behavior fails.
- [ ] **Step 4: Implement minimal browser fallback handling** and context-specific stale-link edits using only `https://ai.samchecompany.com/#live-demo` where semantically correct.
- [ ] **Step 5: Rerun focused browser, link, formatting, and Guide tests** until green.
- [ ] **Step 6: Commit browser and stale-link changes** as one task-scoped commit.

### Task 4: Full verification and staging acceptance

**Files:**
- Modify only if a failing gate proves a defect in an already-authorized file.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: reproducible local and staging evidence plus exact Hostinger preparation data.

- [ ] **Step 1: Run targeted provider, route, language, Support, Guide, and browser tests.**
- [ ] **Step 2: Run the repository's complete test inventory, Fresh Tenant Golden Path, typecheck, lint, dashboard production build, syntax checks, and `git diff --check`; report unsupported scripts explicitly rather than inventing commands.**
- [ ] **Step 3: Refresh `origin/staging`, reconcile safely if it advanced, rerun affected gates, and push only after local verification if staging deployment requires the existing staging branch.**
- [ ] **Step 4: Verify the exact deployed staging revision and health, then exercise canonical signed-session Web Chat in TR/EN/AR with the two-turn Instagram case.**
- [ ] **Step 5: Exercise a controlled staging failure path without changing provider credentials and prove the browser receives only localized safe copy.**
- [ ] **Step 6: Inspect the production Hostinger artifact and backend configuration read-only to identify the exact public widget key, script URL, old block, replacement embed, CSP/CORS/domain needs, and rollback.**
- [ ] **Step 7: Stop before Render production deployment or Hostinger publication and report the required human actions.**
