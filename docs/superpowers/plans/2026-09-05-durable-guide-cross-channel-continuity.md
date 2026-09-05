# Durable Guide Cross-Channel Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Guide preview/public sessions durable and server-authoritative, while preserving generic WhatsApp human handoff for existing and future tenants.

**Architecture:** A hashed Guide resume token becomes the durable continuation credential after either public or private-preview bootstrap. A session stores the authorized Experience identity and lifecycle mode, and state/message-thread persistence is database-backed. WhatsApp resolves tenant-scoped handoff policy before provider runtime; a non-destructive compatibility projection preserves legacy template behavior during migration.

**Tech Stack:** Node.js, Express, PostgreSQL, node:test.

**Spec:** Current user request, “SAMCHE — IMPLEMENT DURABLE GUIDE SESSION + CANONICAL CONVERSATION STATE”.

## Global Constraints

- No tenant, phone, domain, assistant, prompt, or workflow hardcoding.
- No destructive data operations, no history deletion, no production access.
- Do not commit, push, or deploy in this task.
- Public and private-preview authorization remain fail-closed.
- Existing sessions and WhatsApp templates remain readable during transition.

---

### Task 1: Durable session authorization and patch contract

**Files:**
- Modify: `migrations/060_guide_public_sessions.sql` only through a new versioned migration.
- Modify: `services/guide-conversation-service.js`
- Modify: `services/guide-domain-service.js`
- Modify: `app.js`
- Test: `test/guideConversationService.test.js`

- [ ] Write failing tests for session-first private continuation, expired-ticket bootstrap rejection, scope mismatch rejection, and partial state patches preserving unrelated state.
- [ ] Run the focused tests and confirm they fail for the current ticket-first/overwrite behavior.
- [ ] Add a non-destructive migration for durable authorization provenance and exact Experience identifiers.
- [ ] Resolve an existing opaque session before consuming a preview ticket; use the session’s server-stored authorization and exact Experience identity only when its scope, status, integration, domain and expiry remain valid.
- [ ] Replace whole-state writes with validated server-side patches.
- [ ] Re-run the focused tests.

### Task 2: Canonical Guide state and module thread persistence

**Files:**
- Modify: new versioned migration for message module metadata and safe indexes.
- Modify: `services/guide-session-context-service.js`
- Modify: `services/live-inbox-service.js`
- Modify: `app.js`
- Test: `test/guideSessionContextService.test.js`, new `test/guideDurableSessionPersistence.test.js`

- [ ] Write failing tests for restart-safe Roadmap, Planning and Assistant recovery, provider-history reconstruction from canonical messages, and module-separated feeds.
- [ ] Run and observe expected failure because `Map` and `guideMemoryStore` are currently authoritative.
- [ ] Replace process-local context/history authority with database-backed canonical state and module-tagged messages.
- [ ] Keep provider-specific objects reconstructed at request time, never persisted as canonical state.
- [ ] Backfill only safe legacy message classification; preserve ambiguous historical records as legacy-visible rather than discarding them.
- [ ] Re-run focused tests.

### Task 3: Generic WhatsApp human-support policy continuity

**Files:**
- Modify: new versioned migration/backfill.
- Modify: `services/whatsapp-tenant-context-service.js` or new focused policy service.
- Modify: `services/human-support-service.js`
- Modify: `app.js`
- Test: `test/humanSupportService.test.js`, `test/whatsappTenantPersonaIsolation.test.js`, new handoff policy test.

- [ ] Write failing tests proving a human-support request is handled before provider resolution, legacy templates remain usable through the transition, and two tenant scopes cannot cross-control handoff.
- [ ] Run and observe expected failure.
- [ ] Introduce one tenant/assistant/channel-scoped policy resolver with active-configuration preference and validated legacy compatibility projection.
- [ ] Route inbound support intent through the existing `handling_mode`/human-attention state machine before runtime/provider work.
- [ ] Make the migration idempotent and preserve original template fields and handoff history.
- [ ] Re-run focused tests.

### Task 4: Compatibility and regression verification

**Files:**
- Modify: focused tests only as required by the preceding tasks.

- [ ] Add two synthetic-tenant matrix fixtures for public/preview Guide continuity, private/public isolation, WhatsApp handoff, Live Inbox ownership, and return-to-AI.
- [ ] Add old-record fixtures and assert migration/backfill idempotency and preserved counts.
- [ ] Run affected Guide, provider, WhatsApp, Live Inbox, tenant-isolation and syntax suites.
- [ ] Run `git diff --check` and inspect only task-related changed files.
