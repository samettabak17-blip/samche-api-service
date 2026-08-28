# Tenant Persona Isolation and Automatic Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every mapped channel derive its business persona and behavior exclusively from reviewed ACTIVE tenant data, while preserving SamChe as an ordinary tenant and automatically generating reviewable Profile/Configuration V2 artifacts from approved knowledge.

**Architecture:** Add versioned JSONB contracts and a channel-neutral persona assembler. Mapped channel adapters use its resolved ACTIVE persona or fail closed; deterministic, follow-up and scheduled paths consume tenant configuration rather than embedded SamChe wording. Existing provider, routing, delivery, handoff, knowledge retrieval and authority-epoch primitives remain intact.

**Tech Stack:** Node.js ESM, PostgreSQL JSONB and idempotent SQL migrations, Gemini/OpenAI adapters, Node test runner, React/TypeScript, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-tenant-persona-isolation-design.md`

## Global Constraints

- Production must not be touched; deploy only `staging -> origin/staging`.
- No customer-specific code branches or prompt files.
- Mapped runtimes must never use SamChe as a fallback persona.
- Existing WhatsApp provider/routing/delivery/handoff/media behavior must remain unchanged.
- Live Inbox history remains complete while stale persona epochs are excluded from provider context.
- Automated tests are regression guards, not final acceptance; Task 6 remains BLOCKED until user manual acceptance.

## Future platform dependencies (recorded, not part of this Task 6 fix)

- **Provider-Agnostic AI Architecture** precedes **AI Provider / Model Governance**; provider/model selection remains centrally governed rather than embedded in tenant code.
- **AI Provider / Model Governance** precedes **Cost Telemetry & Provider Pricing Metadata**, which records provider/model pricing metadata and attributable usage without changing runtime routing implicitly.
- **Shared Tenant Brand Profile** is a tenant-scoped platform capability built on the reviewed Business Identity/Profile boundary. AI Guide consumes it first; Web Chatbot and **SamChe Voice AI Layer** reuse the same capability later instead of creating channel-specific brand stores.
- **Tenant-Driven AI Guide** consumes Shared Tenant Brand Profile, ACTIVE Assistant Configuration, approved knowledge, and shared authority state.
- **White-Label Branding** consumes Shared Tenant Brand Profile and must keep platform branding separate from tenant business identity.
- **Reusable Guide Component Architecture** precedes **Standard AI Guide vs Custom AI Experience** so standard and custom experiences compose the same tenant-aware components and API contracts.
- **Page-Aware Shared Context** is a shared client/runtime contract used by reusable guide experiences; it must remain tenant- and Assistant-scoped and must not become a dashboard-only business-logic layer.
- **SamChe Voice AI Layer** follows provider governance and Shared Tenant Brand Profile, and reuses the same tenant persona/authority contracts rather than introducing a SamChe-wide persona.

These dependencies are backlog placement only. They do not alter completed task numbering, current Task 6 runtime behavior, provider selection, or this PostgreSQL locking fix.

---

### Task 1: V2 profile and configuration contracts

**Files:**
- Create: `migrations/026_tenant_persona_v2.sql`
- Modify: `services/knowledge-generation-provider.js`
- Modify: `services/knowledge-profile-lifecycle.js`
- Modify: `services/knowledge-assistant-lifecycle.js`
- Test: `tests/knowledge-generation-provider.test.js`
- Test: `tests/knowledge-profile-lifecycle.test.js`
- Test: `tests/knowledge-assistant-lifecycle.test.js`

**Interfaces:**
- Produces validated `schema_version: 2` Business Profile and Assistant Recommendation/Configuration data.
- Preserves existing generation-run provenance and lifecycle statuses.

- [ ] Write failing tests proving V2 required/allowed fields, source-only prompt boundaries, unknown evidence behavior, recommendation/configuration semantic separation, and cross-tenant/SamChe-default prohibition.
- [ ] Run the focused generation tests and confirm failures are caused by missing V2 contracts.
- [ ] Add an idempotent additive migration for explicit schema-version columns/defaults without rewriting existing JSON or ACTIVE pointers.
- [ ] Implement V2 validators and generic generation prompts with provenance-preserving inputs.
- [ ] Run focused generation/lifecycle tests and commit `feat(knowledge): add tenant persona v2 generation contracts`.

### Task 2: Shared runtime persona assembler

**Files:**
- Create: `services/tenant-runtime-persona-service.js`
- Modify: `services/knowledge-runtime-context-service.js`
- Test: `tests/tenant-runtime-persona-service.test.js`
- Test: `tests/knowledge-runtime-context-service.test.js`

**Interfaces:**
- Produces `resolveTenantRuntimePersona({ database, tenantId, assistantId })`.
- Produces `buildTenantRuntimeSystemInstruction({ persona, knowledgeContext, channelRules })`.
- Returns `{ available: false, code: 'TENANT_PERSONA_NOT_ACTIVE' }` unless both ACTIVE artifacts are valid V2 data.

- [ ] Write failing behavior tests for non-SamChe identity, cross-tenant service/price isolation, neutral missing-persona failure, and SamChe-as-data compatibility.
- [ ] Run tests and verify RED.
- [ ] Implement strict tenant+Assistant resolution and safety/business instruction separation.
- [ ] Integrate current approved knowledge without changing semantic retrieval.
- [ ] Run tests and commit `feat(runtime): assemble active tenant persona safely`.

### Task 3: WhatsApp mapped persona integration

**Files:**
- Modify: `services/whatsapp-tenant-context-service.js`
- Modify: `services/whatsapp-live-inbox-service.js`
- Modify: `app.js`
- Test: `test/whatsappTenantContext.test.js`
- Test: `test/whatsappAuthoritativePolicy.test.js`
- Create: `test/whatsappTenantPersonaIsolation.test.js`

**Interfaces:**
- Consumes the shared persona assembler after existing handoff and authority gates.
- Leaves Gemini, delivery and supplementary/semantic retrieval unchanged.

- [ ] Write failing tests for non-SamChe identity, missing ACTIVE fail-closed, Tenant A/B isolation, SamChe tenant compatibility, and old-persona epoch exclusion.
- [ ] Run the focused tests and verify RED.
- [ ] Replace mapped business-policy authority with resolved ACTIVE persona; preserve an explicit SamChe compatibility input rather than a default.
- [ ] Add neutral localized unavailable response without invoking the provider.
- [ ] Run focused and protected WhatsApp suites and commit `fix(whatsapp): enforce active tenant persona isolation`.

### Task 4: Signed Web Chat integration

**Files:**
- Modify: `app.js`
- Test: `tests/knowledge-runtime-web-chat-integration.test.js`
- Create: `tests/web-chat-tenant-persona.test.js`

**Interfaces:**
- Signed mapped sessions consume shared persona and authority memory.
- Unsigned legacy behavior remains outside the mapped multi-tenant contract.

- [ ] Write failing signed-session tests showing SamChe base text cannot enter Tenant B and missing ACTIVE persona fails closed.
- [ ] Run tests and verify RED.
- [ ] Use the shared persona system instruction for mapped signed sessions and retain server-resolved identity.
- [ ] Run signed Web Chat and isolation regressions; commit `fix(web-chat): isolate mapped tenant persona`.

### Task 5: AI Guide chat and plan integration

**Files:**
- Modify: `app.js`
- Modify: `services/live-inbox-service.js` only if mapped plan resolution needs an existing safe resolver.
- Test: `tests/knowledge-runtime-samcheguide-integration.test.js`
- Create: `tests/ai-guide-tenant-persona.test.js`

**Interfaces:**
- `/chat` and `/plan` resolve the same mapped Assistant persona.
- Mapped missing-persona requests return a neutral unavailable result.

- [ ] Write failing tests for Tenant B chat, `/plan`, missing ACTIVE fail-closed and SamChe-as-data compatibility.
- [ ] Run tests and verify RED.
- [ ] Replace mapped `SAMCHEGUIDE_SYSTEM_PROMPT` use with the shared persona and tenant-neutral planning instruction.
- [ ] Preserve Gemini and HTML formatting adapter behavior.
- [ ] Run AI Guide regressions; commit `fix(ai-guide): use active tenant persona`.

### Task 6: Deterministic greeting, fallback and handoff

**Files:**
- Modify: `services/whatsapp-deterministic-social-response-service.js`
- Create: `services/tenant-runtime-message-template-service.js`
- Modify: `services/human-support-service.js`
- Modify: `app.js`
- Test: `test/whatsappGreetingOnlyPolicy.test.js`
- Test: `test/whatsappHumanSupport*.test.js`
- Create: `test/tenantRuntimeMessageTemplates.test.js`

**Interfaces:**
- Generic templates accept resolved identity/behavior data and never embed business capabilities.

- [ ] Write failing tests for non-SamChe greetings, fallback and takeover/return messages in each supported language.
- [ ] Run tests and verify RED.
- [ ] Implement structural generic templates and configuration-derived business wording.
- [ ] Keep handoff state/delivery unchanged.
- [ ] Run deterministic and handoff suites; commit `fix(runtime): derive deterministic messaging from tenant data`.

### Task 7: Tenant-aware follow-up behavior

**Files:**
- Create: `services/tenant-follow-up-service.js`
- Modify: `app.js`
- Test: `test/tenantFollowUpService.test.js`
- Test: relevant existing follow-up routing tests.

**Interfaces:**
- Produces `planTenantFollowUp({ persona, conversation, crmContext, elapsed })` returning suppression or a tenant-grounded message request.

- [ ] Write failing tests for Tenant A/B wording isolation, disabled behavior, timing, allowed topics, CTA and opt-out suppression.
- [ ] Run tests and verify RED.
- [ ] Implement configuration-driven planning with no embedded company/geography content.
- [ ] Replace mapped runtime ping/follow-up selection while preserving legacy explicit boundary.
- [ ] Run follow-up regressions; commit `feat(runtime): isolate tenant follow-up behavior`.

### Task 8: Tenant-aware scheduled orchestration

**Files:**
- Create: `services/tenant-scheduled-message-service.js`
- Modify: `app.js`
- Test: `test/tenantScheduledMessageService.test.js`

**Interfaces:**
- Scheduler input carries tenant ID, Assistant ID, conversation ID and current ACTIVE persona.
- Business wording is generated by the service from configuration; cron only claims/delivers.

- [ ] Write failing tests for tenant/Assistant mapping, stale/missing persona suppression and cross-tenant isolation.
- [ ] Run tests and verify RED.
- [ ] Introduce the smallest database-backed authoritative lookup compatible with current cron and retain existing delivery APIs.
- [ ] Run cron, delivery and handoff regressions; commit `feat(runtime): schedule tenant-scoped messages`.

### Task 9: Structured dashboard persona UI and preview

**Files:**
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.tsx`
- Modify: `dashboard/src/features/knowledge-intelligence/knowledge-intelligence-page.test.tsx`
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`
- Modify: `dashboard/src/types/api.ts`
- Modify: `routes/knowledgeIntelligenceRoutes.js`
- Test: relevant route/service tests.

**Interfaces:**
- Shows structured V2 fields and safe provenance labels.
- Runtime preview returns only resolved summaries, never raw system/safety prompts.

- [ ] Write failing component and API tests for structured Profile/Configuration fields, provenance labels and safe preview redaction.
- [ ] Run tests and verify RED.
- [ ] Implement structured editors with raw JSON as an advanced fallback.
- [ ] Add a read-only runtime behavior preview endpoint and panel.
- [ ] Verify responsive action access and commit `feat(dashboard): expose tenant persona lifecycle`.

### Task 10: Staging acceptance harness and release verification

**Files:**
- Modify: `scripts/staging-task6-e2e.js`
- Modify: `.github/workflows/staging-task6-e2e.yml`
- Test: workflow security and harness tests.

**Interfaces:**
- Creates marker-owned tenant fixtures, verifies channel persona isolation, and always cleans them.

- [ ] Write failing harness tests for Meridian profile/config generation, cross-tenant contamination, channel fail-closed behavior and cleanup ownership.
- [ ] Run tests and verify RED.
- [ ] Add staging-only persona gates without production secrets or shared ACTIVE pointer changes.
- [ ] Run backend Task 6, protected WhatsApp, Live Inbox, dashboard, TypeScript and build suites.
- [ ] Review exact diff, commit harness changes, push only staging, wait for Render staging deploy, and run workflows.
- [ ] Supply the Turkish manual acceptance checklist and keep `TASK 6 BLOCKED` pending user results.
