# Knowledge Authority Epoch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent revoked tenant/Assistant knowledge from re-entering provider context through stored or process-memory conversation history while preserving the complete Live Inbox transcript.

**Architecture:** PostgreSQL owns one monotonically increasing epoch per tenant-scoped Assistant. Restart-safe triggers bump the epoch atomically when runtime knowledge authority changes; messages and memory entries carry the captured epoch; provider history accepts only the current epoch. Existing messages remain null-provenance and fail closed.

**Tech Stack:** Node.js 24, PostgreSQL 16/18, node:test, GitHub Actions, Render staging.

**Spec:** `docs/superpowers/specs/2026-08-28-knowledge-authority-epoch-design.md`

## Global Constraints

- Work only on `staging`; do not touch production.
- Preserve provider, routing, handoff, delivery, semantic retrieval, and dashboard API contracts.
- Existing conversation messages remain visible and are never deleted or rewritten.
- `APPROVED != ACTIVE`; only ACTIVE pointer changes bump authority.
- Every SQL migration statement must be safe when rerun by the ledger-free migration runner.
- Manual dashboard and WhatsApp acceptance remains required; automated GREEN is not Task 6 GREEN.

---

### Task 1: Real PostgreSQL epoch contract

**Files:**
- Create: `tests/knowledge-authority-epoch.test.js`
- Create: `migrations/024_knowledge_authority_epoch.sql`
- Modify: `.github/workflows/staging-whatsapp-handoff-verification.yml`

**Interfaces:**
- Produces DB columns `ai_assistants.knowledge_authority_version`, `conversation_messages.authority_assistant_id`, and `conversation_messages.knowledge_authority_version`.
- Produces trigger-enforced epoch changes consumed by Tasks 2–4.

- [ ] Write PostgreSQL integration tests that create two tenants/two Assistants and assert literal epoch values for assignment, duplicate assignment, unassignment, rollback, re-assignment, READY transitions, archive, ACTIVE configuration/profile changes, APPROVED-only no-op, legacy rows, and cross-tenant isolation.
- [ ] Run the focused file against the current PostgreSQL CI service and verify failure because the columns/triggers do not exist.
- [ ] Add idempotent migration columns, constraints, index, trigger functions, and triggers. Trigger functions update by both tenant and Assistant; source state UPDATE produces one bump per affected Assistant per statement.
- [ ] Run migration twice and rerun the focused file; expect all tests PASS with zero skips.
- [ ] Add the focused file to the protected PostgreSQL workflow.

### Task 2: Shared authority snapshot and message provenance

**Files:**
- Create: `services/knowledge-authority-service.js`
- Create: `test/knowledgeAuthorityService.test.js`
- Modify: `services/whatsapp-live-inbox-service.js`
- Modify: `services/live-inbox-service.js`
- Modify: `services/human-support-service.js`

**Interfaces:**
- Produces `resolveConversationKnowledgeAuthority(client, { tenantId, conversationId }) -> { assistantId, version } | null`.
- Produces `loadCurrentProviderHistory(client, { tenantId, conversationId, assistantId, version, limit }) -> Message[]`.
- Message insert paths accept optional `{ authorityAssistantId, knowledgeAuthorityVersion }`.

- [ ] Write failing unit boundary tests for tenant/Assistant resolution, null/multiple mapping fail-closed behavior, current-epoch filtering, old CUSTOMER/ASSISTANT/AGENT/SYSTEM exclusion, and complete unfiltered Live Inbox listing.
- [ ] Run focused tests and verify failures name missing shared primitive/provenance behavior.
- [ ] Implement the two shared queries and stamp WhatsApp CUSTOMER/ASSISTANT, mapped AI Guide messages, AGENT messages, and lifecycle messages in their existing transactions.
- [ ] Carry the inbound authority snapshot to assistant persistence and reject a stale provider result if the epoch changed before persistence/delivery.
- [ ] Rerun focused tests; expect PASS.

### Task 3: WhatsApp provider history boundary

**Files:**
- Modify: `services/whatsapp-live-inbox-service.js`
- Modify: `services/whatsapp-tenant-context-service.js`
- Modify: `app.js`
- Modify: `test/whatsappSupplementaryKnowledgeAssignment.test.js`
- Create: `test/whatsappKnowledgeAuthorityHistory.test.js`

**Interfaces:**
- Consumes Task 2 authority snapshot/history loader.
- `persistWhatsAppInbound` returns the captured authority snapshot with current-epoch history only.

- [ ] Write failing tests for same-conversation revoke, old CUSTOMER marker, fresh history, re-assignment non-revival, archive, different Assistant/tenant, and current message non-duplication.
- [ ] Verify RED against the existing unfiltered `conversation_messages` query.
- [ ] Replace only the provider-history load with the shared current-epoch query; preserve display/audit queries and supplementary/semantic retrieval.
- [ ] Ensure `buildWhatsAppTenantModelContext` receives only eligible history and the current message once.
- [ ] Rerun focused WhatsApp tests; expect PASS.

### Task 4: Bounded AI Guide and signed Web Chat memory enforcement

**Files:**
- Modify: `app.js`
- Modify: `services/live-inbox-service.js`
- Create: `test/channelKnowledgeAuthorityMemory.test.js`

**Interfaces:**
- Consumes the same `{ assistantId, version }` snapshot; no channel-specific authority counter.

- [ ] Write failing tests proving mapped AI Guide/Web Chat old memory is excluded after an epoch change and unmapped legacy sessions preserve existing behavior.
- [ ] Add authority metadata to mapped process-memory entries and filter before provider calls; do not change Gemini/OpenAI selection or response contracts.
- [ ] Rerun channel focused tests; expect PASS.

### Task 5: Verification, commit, staging deploy

**Files:**
- Review every changed file from Tasks 1–4.

- [ ] Run new authority suites with PostgreSQL and confirm zero skips.
- [ ] Run Task 6 backend suite, protected WhatsApp suite, legacy Knowledge Base, Human Take Over/Return to AI, media/attachments/voice/delivery, dashboard tests, TypeScript, and production dashboard build.
- [ ] Run migration twice and `git diff --check`; inspect the exact diff for production/provider/routing changes.
- [ ] Commit logical implementation changes, push only `staging:staging`, and verify `HEAD == origin/staging`.
- [ ] Verify Render `samche-api-staging` is live on the exact SHA and both health endpoints are GREEN.
- [ ] Report the accepted Assistant-level continuity-reset trade-off and provide the manual ASSIGN/UNASSIGN/REASSIGN/ARCHIVE checklist without claiming Task 6 GREEN.
