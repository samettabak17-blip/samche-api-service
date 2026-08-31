# Customer Onboarding Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver secure OWNER-led company onboarding with customer-chosen passwords, tenant-scoped invitations, durable SMTP delivery, and Dashboard acceptance UX.

**Architecture:** Extend the existing users/tenant membership model with canonical email and explicit user status. New invited users receive no membership until their specific invitation is accepted; existing ACTIVE CUSTOMER assignment remains immediate. A SamChe-owned invitation/mail domain service writes transactional outbox records, while a replaceable SMTP adapter delivers messages.

**Tech Stack:** Node.js/Express, PostgreSQL migrations and transactions, existing Argon2id auth, React/TypeScript Dashboard, Vitest, Node test runner, SMTP adapter (Nodemailer or an already-approved equivalent).

**Spec:** `docs/superpowers/specs/2026-09-01-customer-onboarding-invitations-design.md`

## Global Constraints

- Staging only; never touch production or `main`.
- `OWNER` is platform-wide; `CUSTOMER` remains customer system role; tenant roles are only `ADMIN` and `AGENT`.
- New invited CUSTOMER membership is created only by acceptance of that tenant's invitation.
- Existing ACTIVE CUSTOMER password and system role are never changed by assignment.
- Invitation tokens are >=32 random bytes, hash-only at rest, one-time, bounded expiry, and never logged.
- SMTP sender is environment-configured (`support@samchecompany.com`, `SamChe Support`); onboarding/email/password flows make zero LLM calls.
- Use TDD: each production change starts with a focused failing test and ends with focused verification.

---

### Slice 1: User identity and canonical email schema

**Objective:** Make invited accounts representable without an authenticatable password and make email identity race-safe.

**Files:**
- Create: `migrations/035_customer_identity_and_email.sql`
- Modify: `routes/authRoutes.js`, `middleware/validators.js` (normalization helpers only if absent)
- Test: `tests/customer-identity-email-migration.test.js`, focused auth route tests

**Migration:** Add nullable `first_name`, `last_name`, `email_normalized`; normalize existing rows; detect case-variant duplicates and abort before uniqueness enforcement; then add unique index. Relax `password_hash` nullability only with a check requiring non-null for ACTIVE/DISABLED. Normalize status values to `INVITED`, `ACTIVE`, `DISABLED` and preserve legacy active users.

**RED → GREEN:**
- [ ] Add tests for invited null-hash, active hash requirement, name persistence, normalization, duplicate abort, and legacy-row compatibility.
- [ ] Run the migration/unit tests and observe the expected failures.
- [ ] Implement migration and shared email normalization.
- [ ] Run migration tests plus existing auth/registration tests.

**Security acceptance:** registration/login/onboarding all use trimmed lowercase canonical email; INVITED/DISABLED login returns generic invalid credentials; no sentinel password.

**Stop condition:** migration is restart-safe, duplicate-safe, and all existing auth tests pass. Roll back by not applying the new migration; never remove existing user rows.

**Verification:** `node --test tests/customer-identity-email-migration.test.js tests/auth*.test.js` (exact existing auth paths selected after discovery).

### Slice 2: Invitation schema, token service, and lifecycle primitives

**Objective:** Add tenant-specific one-time invitations with exact status/race semantics.

**Files:**
- Create: `migrations/036_customer_invitations.sql`
- Create: `services/customer-invitation-service.js`
- Test: `tests/customer-invitation-service.test.js`, `tests/customer-invitations-migration.test.js`

**Migration:** Add `customer_invitations` with user/tenant FKs, intended role, token hash, `PENDING|CONSUMED|REVOKED|EXPIRED`, expiry and lifecycle timestamps, delivery metadata, and partial unique `(user_id, tenant_id) WHERE status='PENDING'`. Add indexes for hash and tenant/user status.

**RED → GREEN:**
- [ ] Test >=32-byte random token generation, SHA-256 hash-only persistence, bounded 72-hour expiry, malformed token rejection, and status transitions.
- [ ] Test resend/revoke/consume with row locking and user+tenant uniqueness independent of role.
- [ ] Implement service transactions using `SELECT ... FOR UPDATE`; make accept/resend/revoke first-commit-wins.
- [ ] Test replay, expiry, concurrent accept/resend/revoke, and idempotent resend.

**Stop condition:** no raw token leaves the service except the single mail-template invocation; no operation can activate another tenant membership. Rollback is migration omission; existing tables remain untouched.

### Slice 3: Durable SMTP outbox and replaceable mail adapter

**Objective:** Persist recoverable delivery intent and send invitations through authenticated SMTP without coupling core onboarding to a provider.

**Files:**
- Create: `migrations/037_customer_invitation_outbox.sql`
- Create: `services/customer-invitation-mailer.js` (interface/template)
- Create: `services/smtp-customer-invitation-mailer.js`
- Create: `services/customer-invitation-outbox-service.js`
- Modify: `package.json`/lockfile only if an approved SMTP library is absent
- Test: `tests/customer-invitation-mailer.test.js`, `tests/customer-invitation-outbox.test.js`

**API/config:** Validate `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, and HTTPS `PUBLIC_DASHBOARD_URL` at readiness/use time. From values are configuration, with staging expected as `support@samchecompany.com` / `SamChe Support`.

**RED → GREEN:**
- [ ] Test missing/invalid configuration and verify safe non-secret errors.
- [ ] Test template contains company/email/expiry/link but no password, token in logs, or internal IDs.
- [ ] Test outbox `PENDING_DELIVERY → SENT|DELIVERY_FAILED`, dedupe, bounded retry/backoff, crash recovery, and unknown SMTP timeout recovery.
- [ ] Implement interface, SMTP adapter, transactional claim/update worker, and readiness preflight.
- [ ] Assert mocked OpenAI/Gemini/LLM call counts are zero.

**Stop condition:** database commit never depends on SMTP; failed delivery remains resendable. Rollback disables worker/configuration and leaves domain rows auditable.

### Slice 4: Owner onboarding domain/API and existing-customer branch

**Objective:** Provide one idempotent OWNER endpoint for creating a company and either inviting a new customer or assigning an existing account.

**Files:**
- Create: `migrations/038_owner_onboarding_idempotency.sql`
- Create: `services/customer-onboarding-service.js`
- Modify: `routes/tenantRoutes.js`, `middleware/auth.js` only for endpoint guard reuse
- Test: `tests/customer-onboarding-service.test.js`, `tests/tenant-onboarding-routes.test.js`

**API:** `POST /api/v1/tenants/onboard` (OWNER only) accepts company/name/email/ADMIN and requires `Idempotency-Key` 32–128 safe ASCII characters. Return safe tenant/user/invitation/delivery status, never token/password. Add OWNER-only `GET /api/v1/tenants/:tenantId/invitations`, `POST /api/v1/tenants/:tenantId/invitations/:invitationId/resend`, and `POST /api/v1/tenants/:tenantId/invitations/:invitationId/revoke`. Keep existing `POST /:tenantId/users` semantics.

**RED → GREEN:**
- [ ] Test new canonical email creates tenant + INVITED CUSTOMER + invitation/outbox and no membership.
- [ ] Test ACTIVE CUSTOMER creates/reuses only scoped ADMIN membership without password invite/reset.
- [ ] Test INVITED CUSTOMER gets tenant-specific invitation with no membership until acceptance.
- [ ] Test same key/fingerprint replay, same key/different payload conflict, concurrent duplicate keys, duplicate email/membership races, and SMTP failure recovery.
- [ ] Implement transaction and endpoint authorization.

**Stop condition:** Tenant A onboarding/acceptance cannot enable Tenant B; OWNER-only enforcement is proven; existing tenant route tests remain green.

### Slice 5: Public invitation acceptance and password setup API

**Objective:** Let an invitee validate a bounded link, choose a password, atomically activate their account and only that tenant membership.

**Files:**
- Modify: `routes/authRoutes.js`, `app.js` route registration/security headers
- Create: `services/customer-invitation-acceptance-service.js`
- Test: `tests/customer-invitation-acceptance.test.js`, auth regression tests

**API:** Public `POST /api/v1/auth/invitations/validate` and `POST /api/v1/auth/invitations/accept` with token 43–512 chars, body <=4 KiB, password 8–256 chars, rate limits 20/15m validation and 5/15m acceptance per IP+token hash. Generic invalid/expired/revoked/used responses avoid enumeration.

**RED → GREEN:**
- [ ] Test valid acceptance creates only intended `(tenant,user)` membership, hashes Argon2id, marks ACTIVE, consumes invitation.
- [ ] Test failed password validation leaves invitation pending; replay/expiry/revoke/malformed/race cases fail closed.
- [ ] Test Tenant A acceptance does not activate Tenant B invitation or membership.
- [ ] Implement atomic acceptance and preserve existing login behavior for active users.

**Stop condition:** no plaintext password/token in storage or logs; existing active login and registration regressions pass.

### Slice 6: Dashboard OWNER onboarding and public acceptance UX

**Objective:** Replace minimal company creation with an accessible, portal-based invite-admin flow and add public password setup.

**Files:**
- Modify: `dashboard/src/features/dashboard/dashboard-api.ts`, `dashboard/src/components/layout/app-shell.tsx`, `dashboard/src/components/layout/topbar.tsx`
- Create/modify: `dashboard/src/features/auth/accept-invitation-page.tsx`, router entry, existing dialog/overlay primitives
- Test: `dashboard/src/components/layout/topbar.test.tsx`, `dashboard/src/features/auth/accept-invitation-page.test.tsx`, focused API-client tests

**RED → GREEN:**
- [ ] Test OWNER-only fields (company, first, last, email), fixed ADMIN role, validation, idempotency header, loading/duplicate prevention, safe delivery status, resend/revoke.
- [ ] Test CUSTOMER sees none of the OWNER controls; role labels remain Platform Owner/Administrator/Agent.
- [ ] Test portal layering, focus trap/initial focus/restoration, Escape, backdrop, scroll lock, keyboard navigation, responsive internal scroll, and no clipping.
- [ ] Test public `/accept-invitation` invalid/expired/used/revoked/password mismatch/success states and URL/history token removal.
- [ ] Implement API wiring and UI using existing design primitives.

**Stop condition:** local Dashboard build and focused tests pass; no customer password field exists in OWNER UI.

### Slice 7: Fixture metadata and staging-only cleanup

**Objective:** Mark fixtures explicitly, exclude them from customer discovery, and provide safe reviewed cleanup.

**Files:**
- Create: `migrations/039_user_fixture_metadata.sql`
- Modify: OWNER customer search route/service and deterministic CI fixture setup
- Create: `scripts/staging_fixture_cleanup.js`
- Test: `tests/staging-fixture-cleanup.test.js`, customer-search tests

**RED → GREEN:**
- [ ] Test `is_test_fixture` exclusion and preservation of real/manual accounts.
- [ ] Test guard failure for production marker, non-allowlisted DB host/name, missing dry-run, missing `--execute`, or wrong exact confirmation.
- [ ] Test dependency report and fail-closed behavior for any non-fixture relationship.
- [ ] Implement dry-run default and transactional execute path with explicit delete ordering.

**Stop condition:** run dry-run only first; execute only after deterministic fixture classification review. Ambiguity always keeps data. Rollback is to stop script; no automatic cleanup retry.

### Slice 8: Cross-system regression and staging deploy

**Objective:** Prove onboarding does not regress tenant isolation, Knowledge Intelligence, runtime, image ingestion, or language behavior.

**Files:**
- Modify only tests/configuration needed for integration wiring
- Test: existing focused tenant/auth/KI/runtime/language suites plus new onboarding integration tests

**RED → GREEN:**
- [ ] Run auth/tenant/invitation/outbox/SMTP-mock tests.
- [ ] Run Dashboard onboarding/acceptance tests and production build.
- [ ] Run focused PDF/DOCX/TXT/JPG/JPEG/PNG, image extraction/candidates/approval, Business Profile, Recommendation, Configuration, WhatsApp runtime, and EN/TR/AR switching regressions.
- [ ] Verify no provider calls in onboarding suite and no secrets in logs.
- [ ] Commit relevant code/migrations, push only `staging`, verify `HEAD == origin/staging`, clean tree, API/Dashboard HTTP 200, and public bundle markers.

**Stop condition:** any security, isolation, migration, or focused regression failure blocks deployment; no production action.

### Slice 9: Human staging acceptance

**Objective:** Validate the complete real-user path without fixture accounts or developer tooling.

**Manual sequence:**
- [ ] Platform OWNER creates a genuinely new company and enters a real/manual test administrator name/email.
- [ ] Confirm invitation email arrives from `support@samchecompany.com`; customer opens HTTPS link and sets their own password.
- [ ] Confirm CUSTOMER login, `system_role=CUSTOMER`, tenant role ADMIN, and only assigned tenant visibility.
- [ ] Customer uploads a new PDF and a JPG/PNG WhatsApp screenshot; processing reaches READY; candidates require review.
- [ ] Customer reviews/redacts/approves screenshot BUSINESS candidates; verify CUSTOMER context is not authoritative and unique screenshot facts retrieve only after approval.
- [ ] Complete Business Profile → Recommendation → Configuration → explicit Activate.
- [ ] Test runtime Q&A, screenshot-only facts, EN/TR/AR cross-topic switching, no Meridian/SamChe leakage, and no cross-tenant leakage.

**Stop condition:** stop before approval/activation if any artifact is unexpected; Task 6 remains blocked until every manual gate passes.

## Migration order

`035_customer_identity_and_email.sql` → `036_customer_invitations.sql` → `037_customer_invitation_outbox.sql` → `038_owner_onboarding_idempotency.sql` → `039_user_fixture_metadata.sql`. Each migration must be idempotent under project migration conventions and tested on an empty and representative staging schema. The email duplicate preflight runs before its unique constraint.

## Global security gates

- No plaintext password, token, hash, SMTP secret, JWT, prompt, or provider body in logs.
- No OpenAI/Gemini/LLM calls in onboarding, password, invitation, or SMTP code/tests.
- Public invitation endpoints are HTTPS-only, bounded, rate-limited, generic in errors, and no-referrer.
- Every mutation is OWNER-guarded or invitation-token guarded and tenant scoped.
- New users cannot authenticate or access any tenant until their specific invitation is accepted.
- SMTP failures are durable/recoverable; domain transactions never depend on network delivery.
- Fixture deletion requires explicit metadata, staging identity, dry-run, execute flag, and exact confirmation.

## Verification command set

- Backend focused: `node --test <selected onboarding/auth/tenant tests>`
- Dashboard focused: `cd dashboard; npx vitest run --environment jsdom <selected onboarding tests> --reporter=dot`
- Dashboard build: `cd dashboard; npm run build`
- Diff/cleanliness: `git diff --check; git status --short; git rev-parse HEAD; git rev-parse origin/staging`
- Health: read-only staging API health and public Dashboard HTTP checks.

## Definition of done

All slices pass their stop conditions; migrations and outbox are deployed to staging; fixture dry-run is reviewed before any execute cleanup; focused tests/build pass; live Dashboard bundle contains onboarding and acceptance behavior; SMTP preflight is configured; and the human Company B-style acceptance completes without production changes, fixture accounts, plaintext passwords, LLM calls, or cross-tenant access.

IMPLEMENTATION PLAN READY
