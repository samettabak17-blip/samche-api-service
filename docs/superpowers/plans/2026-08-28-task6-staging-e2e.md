# Task 6 Staging E2E Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run one secure staging-only harness that proves Task 6 ingestion, retrieval, lifecycle, channel, dashboard, isolation, and cleanup behavior against real staging services.

**Architecture:** A manual GitHub Actions workflow invokes a Node orchestration script against the deployed staging API and a strict-TLS PostgreSQL evidence connection. Small focused modules own fixture documents, safe reporting/polling, fixture state, and cleanup; no product provider/routing/storage behavior is duplicated.

**Tech Stack:** Node.js 24, GitHub Actions, Express staging API, PostgreSQL/pgvector through `pg`, private R2/S3 through the deployed API, Gemini/OpenAI through deployed runtime integrations, Vitest/Node test, Playwright-compatible dashboard browser checks.

**Spec:** `docs/superpowers/specs/2026-08-28-task6-staging-e2e-design.md`

## Global Constraints

- Workflow is `workflow_dispatch` only and refuses refs other than `refs/heads/staging`.
- Permissions are exactly `contents: read`; no production secret or endpoint is referenced.
- Database connections parse `STAGING_DATABASE_URL` into separate fields and require `rejectUnauthorized: true`, TLS `servername`, `encrypted === true`, and `authorized === true`.
- Secrets, recipient values, signed sessions, object contents, connection fields, and raw embeddings are never logged or persisted as artifacts.
- All fixture names contain the exact run marker and cleanup deletes only recorded IDs after ownership verification.
- Product operations use the real staging API unless the spec explicitly permits DB fixture setup or the existing gap-signal service.
- Runtime provider selection, WhatsApp routing/handoff/delivery, AI Guide, Web Chat, legacy Knowledge Base, and production remain unchanged.

---

### Task 1: Harness foundations and contract tests

**Files:**
- Create: `scripts/staging-task6-e2e-support.js`
- Create: `tests/staging-task6-e2e-support.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `createRunMarker(env)`, `safePass(gate, fields)`, `safeFail(gate, code)`, `pollUntil(options)`, `strictTlsConfig(rawUrl)`, `assertVerifiedTls(client)`, `writeFixtureState(path, state)`, `readFixtureState(path)`.
- Produces: `createPdfFixture(marker)`, `createDocxFixture(marker)`, `createTxtFixture(marker)` returning `{ filename, mimeType, bytes, semanticMarker }`.

- [ ] Write tests proving markers contain only safe run identifiers, logging rejects secret-like fields, polling stops at the deadline, TLS config never uses a connection string or disabled verification, fixture state uses mode `0600`, and all three documents contain distinct semantic markers.
- [ ] Run `node --test tests/staging-task6-e2e-support.test.js`; expect RED because the support module does not exist.
- [ ] Implement the smallest support module using Node built-ins plus `jszip` for the DOCX OPC package; generate a minimal valid PDF content stream and UTF-8 TXT buffer in memory.
- [ ] Add `jszip` to `devDependencies`; do not add a permanent document fixture.
- [ ] Run the focused test and `git diff --check`; expect GREEN.
- [ ] Commit with `test(task6): add staging E2E harness foundations`.

### Task 2: Strictly scoped fixture state and cleanup

**Files:**
- Create: `scripts/cleanup_staging_task6_e2e.js`
- Create: `tests/staging-task6-e2e-cleanup.test.js`

**Interfaces:**
- Consumes: `strictTlsConfig`, `assertVerifiedTls`, and `readFixtureState`.
- State shape: `{ marker, tenantIds, assistantIds, channelIds, integrationIds, sourceIds, conversationIds, userIds, storageObjects: [{ key, tenantId }] }`.
- Produces: exit code 0 only after ownership validation, transactional DB cleanup, private-object cleanup, and zero-remnant verification.

- [ ] Write tests with a query-recording fake proving cleanup refuses a mismatched tenant/name marker, never emits broad unparameterized deletes, deletes recorded IDs in FK-safe order, rolls back on failure, and does not log connection/storage secrets.
- [ ] Run the cleanup test; expect RED because cleanup does not exist.
- [ ] Implement strict TLS connect and ownership queries for every recorded tenant/source/integration. Delete candidate evidence, gap signals/gaps, candidates, configuration/recommendation/profile generation rows, assignments/chunks/jobs/sources, conversation resources/messages/events/conversations, integrations/channels/assistants, tenant membership/users created by the run, and tenants using recorded IDs only.
- [ ] Delete recorded objects through the existing private storage adapter only after the storage key is verified to begin with the fixture tenant namespace and contain the marker-owned source path.
- [ ] Commit/rollback as one cleanup transaction, then run read-only zero-remnant queries.
- [ ] Run focused tests and commit `test(task6): add marker-owned staging cleanup`.

### Task 3: API client, fixture bootstrap, and evidence reader

**Files:**
- Create: `scripts/staging-task6-e2e.js`
- Create: `tests/staging-task6-e2e-contract.test.js`

**Interfaces:**
- Consumes: support document/TLS/state functions.
- Produces: bounded `request`, `uploadSource`, `waitForSource`, `retrievalPreview`, `bootstrapFixture`, and `queryEvidence` functions.

- [ ] Write tests using a local HTTP server and query fake to prove Authorization is attached but never logged, multipart upload fields match the real route, transient Render 502/503/504 responses retry, other failures fail fast, and DB evidence selects vector presence/count rather than vector values.
- [ ] Run tests and verify RED.
- [ ] Implement the client for `https://samche-api-staging.onrender.com`, using OWNER/ADMIN tokens only from environment and validating the host exactly.
- [ ] Bootstrap two marker-owned tenants, three Assistants, generic channels, required integrations, and ADMIN membership using existing authenticated APIs where available and parameterized fixture DB writes otherwise. Persist state after every created resource.
- [ ] Verify runtime generation configuration only through safe provider/model provenance returned by generated records; never read or print provider secrets.
- [ ] Run tests and commit `test(task6): bootstrap isolated staging acceptance fixtures`.

### Task 4: Real document ingestion, storage, retrieval, and isolation

**Files:**
- Modify: `scripts/staging-task6-e2e.js`
- Modify: `tests/staging-task6-e2e-contract.test.js`

**Interfaces:**
- Produces safe evidence per source: `{ format, status, chunkCount, vectorCount, storagePresent, tenantSafeStorageKey, processedAt, indexedAt }`.

- [ ] Add failing tests for PDF/DOCX/TXT upload sequencing, READY polling, pre-READY exclusion, Assistant A success, Assistant B/Tenant B exclusion, unassignment/reassignment, archive exclusion, and re-index stable active chunk count/content hashes.
- [ ] Run focused tests and verify the expected failures.
- [ ] Implement three real uploads with distinct markers, poll source API to READY, and query strict-TLS evidence for storage-key presence, extraction hash/text presence, active chunks, and non-null vectors without selecting embeddings.
- [ ] Execute semantic Retrieval Preview for positive and negative scopes; assert returned metadata contains only safe source/chunk fields.
- [ ] Exercise unassignment/reassignment, archive one dedicated source, and re-index another; compare source identity and active chunk hash/count sets.
- [ ] Run tests and commit `test(task6): cover real staging ingestion and retrieval`.

### Task 5: Gap, Candidate, PII, and provenance lifecycle

**Files:**
- Modify: `scripts/staging-task6-e2e.js`
- Modify: `tests/staging-task6-e2e-contract.test.js`

**Interfaces:**
- Uses `recordAttributedKnowledgeGapSignal` from `services/knowledge-gap-signal-service.js` against the strict-TLS staging pool for the one lifecycle without an API ingress.

- [ ] Add failing tests proving the signal input uses fixture conversation/message IDs, includes synthetic PII that must be redacted, repeats the identical attribution for dedupe, and blocks retrieval before approval.
- [ ] Implement attributable fixture conversation/message creation and call the existing signal service twice. Assert one signal identity/gap dedupe semantics, redacted question, safe provenance, and NEEDS_REVIEW.
- [ ] Use deployed Gap/Candidate APIs to create the suggested Candidate, verify NEEDS_REVIEW/non-retrieval, approve it, poll canonical source READY, and verify Tenant A / Assistant A-only retrieval.
- [ ] Assert a repeated suggestion request returns the existing guarded Candidate rather than creating an uncontrolled duplicate.
- [ ] Run tests and commit `test(task6): exercise staging gap candidate gate`.

### Task 6: Business Profile and configuration lifecycles

**Files:**
- Modify: `scripts/staging-task6-e2e.js`
- Modify: `tests/staging-task6-e2e-contract.test.js`
- Modify only if contract audit proves missing: `routes/knowledgeIntelligenceRoutes.js`, `services/knowledge-profile-lifecycle.js`, `services/knowledge-configuration-service.js`
- Add route/service tests only for any missing edit endpoint.

**Interfaces:**
- Produces pointer snapshots before approval, after approval, after activation, after second approval, after second activation, and after rollback.

- [ ] Add failing route/service tests for the currently missing NEEDS_REVIEW profile/configuration update endpoints; reject edits to APPROVED, ACTIVE, SUPERSEDED, and REJECTED versions.
- [ ] Add a failing configuration lifecycle test proving an explicitly selected SUPERSEDED version can be reactivated as rollback while the current ACTIVE version becomes SUPERSEDED; keep ordinary activation restricted to APPROVED, ACTIVE, or the explicit rollback target.
- [ ] Implement only the missing review update endpoints and bounded configuration rollback behavior. Business Profile rollback remains explicit activation of its older still-APPROVED version.
- [ ] Add harness tests for generate → NEEDS_REVIEW → edit → APPROVED with unchanged active pointer → activate → second approved version with unchanged pointer → activate/supersede → activate older approved version.
- [ ] Implement the real profile sequence and assert generation provider/model/run provenance.
- [ ] Implement recommendation approval followed by the equivalent Assistant configuration sequence and pointer assertions.
- [ ] Run focused backend tests and commit profile/config changes separately from harness orchestration if product endpoints were required.

### Task 7: WhatsApp, AI Guide, and signed Web Chat

**Files:**
- Modify: `scripts/staging-task6-e2e.js`
- Modify: `tests/staging-task6-e2e-contract.test.js`

**Interfaces:**
- Consumes `STAGING_WHATSAPP_APP_SECRET` and `STAGING_WHATSAPP_E2E_RECIPIENT` without logging them.
- Produces safe channel evidence containing channel type, HTTP status, scoped retrieval count, handling mode, and marker-match boolean.

- [ ] Add failing tests for Meta webhook payload/signature creation, recipient allow-list equality, signed AI Guide session continuation, Web Chat bootstrap/session headers, omission of browser tenant/Assistant identity, and cross-tenant widget denial.
- [ ] Implement a signed WhatsApp inbound payload carrying the marker and the secret recipient, then poll fixture conversation messages for scoped retrieval-backed response and provider delivery state.
- [ ] Exercise takeover through authenticated Live Inbox API, send another signed inbound turn and assert no Assistant message, then Return to AI and assert response resumes.
- [ ] Issue an AI Guide signed public session through `/chat`, query the marker, and verify fixture conversation/retrieval evidence.
- [ ] Bootstrap Web Chat with only the opaque widget key, send the signed-session query, and verify Tenant A result plus Tenant B denial.
- [ ] Run tests and commit `test(task6): exercise staging channel intelligence`.

### Task 8: Workflow and dashboard route/responsive job

**Files:**
- Create: `.github/workflows/staging-task6-e2e.yml`
- Create: `dashboard/e2e/task6-staging.spec.ts` if the existing dashboard browser framework supports staging execution; otherwise create `scripts/staging-task6-dashboard-e2e.js` using the repository's installed browser runner.
- Add focused workflow contract test under `tests/`.

**Interfaces:**
- API job writes only safe gate summary/state path in the runner workspace.
- Dashboard job consumes the fixture tenant ID through a non-secret job output and uses existing authenticated staging tokens without screenshots containing secrets.

- [ ] Write a failing workflow contract test that parses YAML and asserts manual-only trigger, staging-ref guards, `contents: read`, required secret names, no production names, main acceptance step, and `if: always()` cleanup.
- [ ] Implement API E2E job with Node 24, dependency install, focused tests, acceptance, and unconditional cleanup.
- [ ] Implement dashboard job for all direct/deep-link/legacy routes and `/knowledge?tab=...` at desktop 1440×900, tablet 1024×768, and mobile 390×844. Assert real API content, lifecycle controls, navigation readability, and refresh success.
- [ ] Run workflow/dashboard contract tests, full dashboard 82-test suite, TypeScript, and production build.
- [ ] Commit `ci(staging): add Task 6 E2E acceptance`.

### Task 9: Final verification and real staging run

**Files:**
- No new product files expected.

**Interfaces:**
- Produces one GitHub Actions run ID and final SHA for the acceptance report.

- [ ] Run focused Task 6 backend tests, cleanup/security tests, protected WhatsApp tests, dashboard tests, TypeScript, and production build locally/CI.
- [ ] Review exact diff and confirm no production endpoint/secret/workflow reference.
- [ ] Push only `staging → origin/staging`; confirm `HEAD == origin/staging` and clean working tree.
- [ ] Confirm both new staging secrets exist by name and updated timestamp without reading values.
- [ ] Dispatch `staging-task6-e2e.yml` on `staging` and wait for API, dashboard, and cleanup jobs.
- [ ] Inspect safe logs for every required gate, zero skips, cleanup zero-remnant evidence, and no secret exposure.
- [ ] Re-run strict-TLS schema preflight, protected WhatsApp workflow, Live Inbox acceptance, and dashboard integration on the final SHA.
- [ ] Report Task 6 GREEN only if every spec gate is evidenced; otherwise report exact remaining blockers.
