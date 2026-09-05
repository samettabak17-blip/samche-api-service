# Fresh Tenant Platform Release Gate Design

## Goal

Make cumulative Tasks 1–7 platform behavior independent of tenant age by
establishing one machine-readable capability manifest, one idempotent tenant
provisioning/repair entry point, truthful durable generation state, and one
release-blocking golden-path command.

## Evidence and root causes

- Both normal tenant creation paths insert a tenant without invoking a shared
  capability provisioning service.
- Human-support escalation defaults are supplied by a database trigger and a
  migration backfill instead of the same application ensure operation used by
  tenant creation.
- Fixed human-support lifecycle copy has competing authorities in assistant
  JSON, active persona data, and a repository JSON fallback.
- Business Identity analysis and Business Profile generation run provider work
  synchronously in HTTP requests, while adjacent Knowledge generation flows use
  durable `knowledge_processing_jobs`. A request timeout therefore has no
  durable profile-generation lifecycle for the UI to resume.
- Knowledge Overview counts extraction-ready sources, while the Business
  Profile selector requires extraction and indexing readiness. The shared word
  `READY` therefore communicates different eligibility semantics.
- Guide repair exists, but startup repair and migrations are not a substitute
  for the normal tenant provisioning entry point.

## Architecture

`platform-capability-registry.js` is the engineering manifest for every shared
Task 1–7 capability. It identifies the canonical owner, authority, entitlement
boundary, ensure operation, repair path, runtime dependencies, and golden-path
coverage. It contains no customer data and validates unique stable keys and a
single authority per capability.

`tenant-platform-provisioning-service.js` is the sole application entry point.
It runs against a caller-owned transaction for new tenants and against a
transaction per tenant for repair. It invokes an idempotent database ensure
function, records the applied manifest version, and returns available versus
enabled capability state without creating feature rows for disabled channels.
Both direct owner tenant creation and owner customer onboarding call it before
commit. A repair command calls the same service for existing tenants.

The database ensure function owns only durable baseline state that every tenant
requires. Feature-specific entities such as assistants, sources, Guide domains,
and channels remain absent until enabled through their normal public service
paths. Human-support escalation policy is baseline platform state and is
ensured idempotently. The former tenant-insert trigger is removed after the
shared ensure function backfills every historical tenant.

Fixed lifecycle messages move to one global, localized database authority.
Runtime code loads the exact template key and falls back to English for an
unsupported locale. Only the approved `{TOPIC}` variable is interpolated.
Assistant/persona JSON is not an authority for these fixed messages.

Business Profile generation becomes a durable job. The POST route validates and
enqueues work, returns `202`, and never performs provider calls inline. A scoped
GET route returns safe job state. The existing Knowledge worker claims the job,
runs identity analysis and profile generation, persists one result, retries only
transient provider failures, and recovers expired leases. The Dashboard stores
only the opaque job identity as advisory state, polls the API authority, resumes
after refresh, and renders pending/processing/retryable/terminal states without
inventing a timeout.

Source summaries expose distinct extraction readiness, indexing readiness, and
Business Profile eligibility. The Business Profile selector uses the server's
eligibility result and displays a bounded exclusion reason; it does not infer a
different definition of READY in the browser.

## Golden-path gate

The release gate provisions an existing-style fixture and two fresh synthetic
tenants through the normal provisioning service. It exercises or asserts the
canonical boundaries for foundation/RBAC, assistant and channel ownership, CRM,
deals, conversations, fallback, follow-up, Human Support, Live Inbox,
escalation, Knowledge sources and identity/profile lifecycle, retrieval, Guide,
durability, white-label behavior, and cross-tenant rejection. Database-backed
checks fail closed when no isolated test database is supplied; they never skip
and never target production.

The cumulative command is `npm run test:fresh-tenant-golden-path`. It is the
single CI entry point and may invoke focused subordinate test groups, but future
tasks append behavior rather than replace prior coverage.

## Compatibility and safety

- Existing tenant data, approved/active separation, and historical records are
  preserved.
- No production credentials, customer names, tenant IDs, or copied customer
  rows appear in code or fixtures.
- Provider failures remain separate from provisioning failures.
- Durable jobs, messages, sessions, outbox rows, and database configuration are
  authoritative; process memory is never authoritative.
- Physical employee-phone delivery remains externally blocked until a transport
  is configured; the durable outbox domain remains testable.
