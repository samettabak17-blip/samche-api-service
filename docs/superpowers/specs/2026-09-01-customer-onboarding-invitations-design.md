# Customer Onboarding Invitations Design

## Goal

Let a platform OWNER create a company and invite its initial CUSTOMER administrator without handling a password, while preserving the existing distinction between platform system roles and tenant memberships.

## Scope and constraints

- Staging implementation only; never deploy or run cleanup against production.
- A CUSTOMER remains `system_role = CUSTOMER`; their tenant membership is `ADMIN` or `AGENT`.
- Invitation links are one-time credentials, not login JWTs. Only token hashes are stored.
- SMTP is behind a SamChe-owned mail interface. Credentials, invitation tokens, and passwords are never logged.
- The visible sender is configured by `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME`; staging values are `support@samchecompany.com` and `SamChe Support`.

## Data model

Add `customer_invitations` with an opaque UUID id, `user_id`, `tenant_id`, `tenant_role`, `token_hash`, `expires_at`, `consumed_at`, `revoked_at`, `delivery_status`, `delivery_attempted_at`, timestamps, and tenant/user foreign keys. Index active lookups by token hash and tenant/user status. A partial unique constraint prevents concurrent active invitations for the same user, tenant, and role.

Add explicit `is_test_fixture BOOLEAN NOT NULL DEFAULT FALSE` to users. Runtime customer discovery excludes this flag. It is not inferred from names or email patterns.

The invitation token is generated with cryptographically secure random bytes, encoded URL-safely, and hashed with SHA-256 before persistence. It expires after a bounded configurable duration (default 72 hours). The raw token exists only long enough to build the outgoing email URL.

## Domain services

`customer-onboarding-service` owns the transaction:

1. Normalize and validate the company and administrator details.
2. Create the tenant.
3. Find a CUSTOMER by normalized email, or create an invited CUSTOMER account with no usable password until acceptance.
4. Create/reuse a tenant ADMIN membership without changing `system_role`.
5. Create/revoke/reissue invitation rows idempotently.
6. Commit the database onboarding state before external email delivery.

`customer-invitation-mailer` is a SamChe-owned interface. `smtp-customer-invitation-mailer` is its first adapter. The adapter validates `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and `SMTP_FROM_NAME` at use time, sends authenticated SMTP mail, and returns only safe delivery outcomes. SMTP failures leave the committed invitation recoverable for resend.

The endpoint layer exposes OWNER-only onboarding, resend, revoke, and safe invitation-status responses; an unauthenticated acceptance endpoint validates only the opaque token and a password-setup endpoint atomically hashes with existing Argon2id, marks the user active, and consumes the invitation. Used, revoked, expired, malformed, and replayed invitations fail closed.

## Dashboard UX

Replace the company-name popover with a portal-based modal using the existing Dashboard dialog styling. It contains company name, administrator first name, last name, and email. Its primary action is `Create company & invite administrator`; loading disables duplicates, field errors are visible, and safe delivery/onboarding status is shown.

The selected-company OWNER surface keeps `Assign existing customer` as a secondary action. Eligible-user search excludes `is_test_fixture` users and permits only ADMIN/AGENT tenant roles. OWNER sees all tenants; CUSTOMER sees membership-only tenants. Role presentation is independent of selected tenant: Platform Owner, Administrator, or Agent.

Add an invitation acceptance route/page with company and email context, password and confirmation fields, safe terminal errors, and a login redirect after success.

All owner overlays use one portal/z-index hierarchy above header and page cards, have accessible labels/focus behavior, and work at narrow desktop/tablet widths without clipping.

## Fixture cleanup

Provide a staging-only script guarded by an explicit staging environment check and a required dry-run mode. It targets only `is_test_fixture = TRUE` users and associated test-only memberships/invitations. It reports safe identifiers/counts and performs transactional deletion only after a reviewed dry run. Ambiguous users are not marked and are retained. Test setup must explicitly mark fixtures, so normal customer discovery never presents them.

## Verification

Focused tests cover OWNER onboarding, existing CUSTOMER assignment, CUSTOMER isolation, invitation generation/expiry/consumption/revocation/resend, Argon2 password setup, SMTP configuration and safe failure, fixture filtering and dry-run cleanup, modal layering, role labels, and acceptance-page errors. Existing tenant, Knowledge Intelligence, runtime, and language regressions remain green. A real staging email acceptance requires configured SMTP environment variables and a human recipient; no production data is used.
