# Task 6 Staging E2E Acceptance Design

## Purpose

Provide one repeatable, staging-only acceptance run that proves the deployed Task 6 product against the real staging API, PostgreSQL/pgvector database, private object storage, generation providers, and channel runtimes. The harness must not introduce product behavior, customer-specific runtime branches, permanent demo data, or any production dependency.

## Scope

The run covers:

- PDF, DOCX, and TXT upload through the authenticated Knowledge Intelligence API.
- Private-storage persistence, extraction, chunking, embeddings, pgvector persistence, and READY state.
- Source assignment, semantic retrieval, unassignment/reassignment, tenant isolation, Assistant isolation, archive exclusion, non-ready exclusion, and re-index idempotency.
- Attributable Knowledge Gap signals, deduplication, suggested Candidate review gate, approval, canonical ingestion, PII redaction, and provenance.
- Business Profile generation, review, approval, activation, supersession, and rollback.
- Assistant recommendation/configuration generation, review, approval, activation, supersession, and rollback.
- The same approved/ACTIVE intelligence through the existing WhatsApp, AI Guide, and signed Web Chat runtimes.
- Human Take Over suppression and Return to AI restoration.
- Authenticated dashboard routes, lifecycle controls, legacy compatibility, and desktop/tablet/mobile widths.

## Non-goals

- No production access or deployment.
- No provider, routing, storage, authentication, or lifecycle refactor.
- No new public API or dashboard-only business logic.
- No permanent fixture files, demo tenants, customer data, or artifacts.
- No exposure of secrets, database connection details, raw embeddings, private object contents, or customer identifiers.

## Components

### Manual workflow

`.github/workflows/staging-task6-e2e.yml` is enabled only by `workflow_dispatch` on `refs/heads/staging`, has `permissions: contents: read`, and consumes only staging repository secrets. It runs the API/DB/channel acceptance script and an independent cleanup step guarded by `if: always()`. Dashboard route/responsive verification is a separate job using the same run marker and authenticated staging deployment.

### Acceptance orchestrator

`scripts/staging-task6-e2e.js` creates a unique marker from `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT`. It generates minimal PDF, DOCX, and TXT buffers in memory, calls the real staging API, polls bounded asynchronous states, and performs read-only DB evidence queries through a strict-TLS client. Fixture-only DB writes are allowed solely when no product API exists for creating the isolated tenant/channel provenance needed by an acceptance step.

The script emits structured PASS/FAIL lines containing only gate names, safe statuses, counts, provider/model names, fixture IDs, and marker fingerprints. It never logs request authorization, signed sessions, webhook signatures, recipient values, database connection fields, storage credentials, object contents, or embeddings.

### Cleanup

`scripts/cleanup_staging_task6_e2e.js` reads an ephemeral runner state file written with owner-only permissions. Before deletion it verifies that the tenant name, integration keys, source titles, and fixture emails carry the exact current run marker. It then deletes only recorded fixture IDs in foreign-key-safe order inside a transaction over strict TLS. Object deletion uses the existing private-storage adapter and only recorded tenant-safe storage keys. Any ownership mismatch aborts cleanup without broadening its scope.

### Contract tests

Focused tests exercise fixture generation, marker ownership, polling bounds, secret-safe reporting, strict-TLS configuration, cleanup scoping, workflow dispatch/ref guards, and channel payload construction. Tests use local fakes at external boundaries but assert the harness's real payload and state-transition contracts. Existing Task 6, dashboard, legacy, and protected WhatsApp suites remain authoritative regressions.

## Fixture model

Each run creates two temporary tenants and two Assistants in the primary tenant:

- Tenant A / Assistant A: owns uploaded sources and channel mappings.
- Tenant A / Assistant B: proves Assistant isolation.
- Tenant B / Assistant C: proves tenant isolation.

All names and integration keys contain `TASK6_E2E_<run-id>`. The workflow uses the existing staging OWNER identity for authenticated platform operations and links the existing staging ADMIN identity only when required by tenant-scoped authorization. No passwords or new persistent login credentials are created.

Channel fixtures use generic product labels and existing integration types: `WHATSAPP`, `SAMCHEGUIDE`, and `WEB_CHAT`. The WhatsApp recipient comes only from `STAGING_WHATSAPP_E2E_RECIPIENT`; inbound webhook signatures are generated only from `STAGING_WHATSAPP_APP_SECRET`. The staging runtime retains its existing Gemini/OpenAI provider selection.

## Ingestion and retrieval sequence

For each format, the harness uploads a document containing a format-specific semantic marker and assigns it to Assistant A. It polls the source API until READY or a bounded failure/timeout. DB evidence must show a tenant-safe private storage key, extracted content, at least one active chunk, at least one non-null vector, and READY/indexed timestamps. Raw vectors are never selected.

Retrieval Preview must return safe source/chunk metadata for Assistant A. It must not return the source for Assistant B or Tenant B. Unassignment removes the result; reassignment restores it. Archive removes an archived source. A deliberately observed non-ready state is queried before readiness and must not retrieve. Re-index records chunk/source counts before and after and requires stable source identity with no duplicate active chunk explosion.

## Gap and Candidate sequence

The harness creates an attributable conversation/message fixture carrying a redaction-safe question and invokes the repository's existing gap-signal service against the real staging schema because no authenticated signal-ingestion API exists. This is the only service-level lifecycle invocation; downstream Gap, Candidate, approval, and retrieval actions use the deployed API. Repeating the same signal must preserve one deduplicated signal/gap identity while updating the supported occurrence semantics. A suggested Candidate starts in NEEDS_REVIEW and is not retrievable. Approval creates canonical knowledge, which must become READY and retrievable only for Tenant A / Assistant A. Evidence output includes only IDs, statuses, counts, channel type, redaction state, and provenance links.

## Business Profile and Configuration sequence

Generation calls use the deployed configured knowledge-generation provider. DB evidence verifies provider/model provenance without credentials. Generated versions must be NEEDS_REVIEW and must not change runtime active pointers. Approval alone changes only approved pointers/status. Explicit activation changes the runtime pointer. A second approved version leaves the first active until activation; activating it supersedes the first. Rollback explicitly activates the older APPROVED version. The same pattern applies to recommendation/configuration versions scoped to Assistant A.

## Channel sequence

- WhatsApp: a correctly signed staging webhook uses the secret recipient and unique marker. DB/runtime evidence must show the inbound lifecycle, scoped retrieval context, and assistant response. Human Take Over suppresses AI; Return to AI restores it.
- AI Guide: the public signed conversation-session contract issues a session, sends a marker query, and verifies Tenant A / Assistant A retrieval and ACTIVE intelligence.
- Web Chat: an opaque fixture widget key is resolved server-side by `/api/chat/bootstrap`; the signed session is then used with `/api/chat`. Browser-supplied tenant or Assistant IDs are neither sent nor trusted. Tenant B's widget cannot retrieve Tenant A's marker.

## Dashboard acceptance

The dashboard job verifies direct navigation and refresh for all accepted Knowledge Intelligence routes plus `/app/:tenantId/knowledge-base` and backward-compatible `/knowledge?tab=...`. It checks real API-backed content, lifecycle action availability, readable active/inactive navigation, and no demo values at desktop, tablet, and mobile widths. Existing authenticated tokens are injected only as browser session state and are never printed or captured in artifacts.

## Failure and cleanup behavior

Every gate fails immediately with a stable safe code. Polling uses bounded intervals and deadlines. The workflow always executes cleanup, and cleanup failure makes the workflow fail even when acceptance passed. A failed acceptance may leave no fixture silently: cleanup reports counts by entity category and verifies zero remaining records/storage objects for the run marker.

## Required staging secrets

- `STAGING_OWNER_TOKEN`
- `STAGING_ADMIN_TOKEN`
- `STAGING_DATABASE_URL`
- `STAGING_WHATSAPP_APP_SECRET`
- `STAGING_WHATSAPP_E2E_RECIPIENT`

No production secret is referenced. Storage and provider credentials remain inside the deployed Render staging service; the harness reaches them through the real API/runtime rather than copying them into Actions.

## Green gate

Task 6 may be reported GREEN only when the E2E run, cleanup, dashboard route/responsive job, focused Task 6 tests, dashboard tests/build, strict-TLS schema preflight, Live Inbox acceptance, and protected WhatsApp workflow all complete successfully on the same final staging SHA, with no skipped required gate.
