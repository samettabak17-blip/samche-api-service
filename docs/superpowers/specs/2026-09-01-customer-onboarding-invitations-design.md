# Customer Onboarding Invitations Design

## Goal and invariants

An OWNER creates a tenant and invites its first customer administrator without ever seeing, choosing, storing, or emailing a password. The customer chooses their own password, remains `system_role = CUSTOMER`, and gains only the invited tenant membership. Platform role, selected company context, and tenant role remain separate concepts.

This work is staging-only. No onboarding, cleanup, mail, migration, or deploy action may target production. The onboarding, email, and password paths make zero OpenAI, Gemini, or other LLM calls.

## Authoritative membership model

The system uses **membership creation on invitation acceptance**, not a pending membership state.

- A new/invited CUSTOMER gets a tenant, an invited identity, and a tenant-specific invitation. No `tenant_users` row is created yet.
- Successful acceptance of that exact invitation atomically writes the password hash, marks the user ACTIVE, inserts that invitation's ADMIN/AGENT membership, and consumes the invitation.
- A second invitation for another tenant remains independently pending. Accepting Tenant A cannot create or activate a Tenant B membership.
- An existing ACTIVE CUSTOMER never receives a password-setup invitation. OWNER onboarding creates or reuses the requested membership immediately, preserving their existing password and `system_role`; a membership-notification email may be queued separately.
- An existing INVITED CUSTOMER receives a tenant-specific invitation; that membership is still created only when that invitation is accepted.

Customer authorization continues to require a real `tenant_users` membership. No middleware membership-state change is needed because a pending membership does not exist. OWNER remains platform-wide. Tenant ADMIN never implies OWNER.

## User, identity, and canonical email schema

The users migration is additive and backward compatible:

- `first_name TEXT NULL`, `last_name TEXT NULL`; required and normalized for new customer invitations, null-safe for legacy users.
- `email_normalized TEXT NOT NULL`; it is `lower(trim(email))` and has a database unique index. Application code treats this as the only lookup key.
- `password_hash` becomes nullable only for `INVITED` users. ACTIVE users must retain a valid Argon2id hash. No sentinel, generated, or plaintext password is allowed.
- `status` gains/validates `INVITED`, `ACTIVE`, and `DISABLED`. Existing `active` rows are normalized to `ACTIVE` by the migration before constraints are enforced.

The email migration first detects case-variant duplicates. If any exist, it aborts before creating the uniqueness constraint and produces a safe remediation report; it does not guess which account is canonical. Login, registration, owner onboarding, invitation lookup, and user discovery all trim/lowercase email before database access. Login rejects INVITED and DISABLED users with the same bounded invalid-credentials response used for other invalid login states.

Concurrent registration/onboarding uses the unique normalized-email constraint plus transaction retry on unique violation. The winner re-reads the canonical user row; the loser either follows the ACTIVE existing-customer path or issues/reuses the invited-user's tenant-specific invitation. Duplicate membership insertion uses the existing tenant/user uniqueness constraint and is idempotent.

## Invitation schema and lifecycle

`customer_invitations` is additive and tenant/user scoped. It contains opaque UUID id, user id, tenant id, intended tenant role, `token_hash`, status, expiry, consumed/revoked timestamps, delivery state, timestamps, and foreign keys. The only allowed invitation states are `PENDING`, `CONSUMED`, `REVOKED`, and `EXPIRED`; expiry is derived and materialized before lifecycle changes where needed.

Token contract:

- Generate at least 32 cryptographically random bytes locally, URL-safe encode it, and persist only SHA-256(token).
- Default expiry is 72 hours and must be configurable within a bounded server-side range.
- Only one current usable invitation exists for each `(user_id, tenant_id)`, irrespective of tenant role. A partial unique index enforces `status = PENDING` for that pair.
- Resend locks the current row (`SELECT ... FOR UPDATE`), revokes it, creates one replacement invitation, and queues one delivery operation. Revoke locks and marks the current invitation REVOKED. Consume locks the row and succeeds only when it is PENDING and unexpired.
- Acceptance versus resend/revoke is serialised by the row lock. The first committed transition wins; the later operation receives a bounded terminal result. Used/revoked/expired/replayed tokens fail closed.

## Onboarding idempotency and transaction boundary

OWNER onboarding requires an `Idempotency-Key` request header: 32–128 ASCII-safe characters. A persistent `owner_onboarding_idempotency` record is scoped to OWNER user id + key and stores a SHA-256 payload fingerprint, final response metadata, status, and bounded expiry (24 hours).

- The first transaction locks/creates the key record, creates the tenant/user or resolves an existing user, and writes the invitation/outbox intent.
- A same-key, same-fingerprint retry returns the original safe result and never creates another tenant.
- A same key with a different payload returns conflict.
- Concurrent duplicate keys wait on the record lock and replay the winning result.
- The UI supplies one key per submit attempt and disables duplicate submission, but server persistence is authoritative.

The database transaction commits domain state and an outbox entry together. SMTP is never part of the transaction.

## Password and public acceptance security

The public Dashboard route is `/accept-invitation`; it is explicitly excluded from authenticated-route guards. The link can carry an opaque token only over an HTTPS `PUBLIC_INVITATION_BASE_URL` configured and validated at startup. The server rejects non-HTTPS public URLs except an explicit local-development mode.

The page captures the token once, immediately replaces the browser URL/history with `/accept-invitation`, sets `Referrer-Policy: no-referrer`, and never sends the token to analytics, error reporting, or application logs. Public validation accepts only 43–512 character URL-safe tokens. Public acceptance bodies are limited to 4 KiB; passwords must be 8–256 characters. Validation is rate-limited to 20 requests per 15 minutes per IP and hashed-token key; acceptance is limited to 5 per 15 minutes per IP and hashed-token key. OWNER resend is limited to 10 per hour per invitation user/tenant. Responses do not return token hashes, internal ids, or account-existence details.

The customer supplies and confirms their password. The acceptance transaction validates the invitation, validates both password fields, hashes using existing Argon2id, sets the account ACTIVE, creates only that invitation's membership, marks the invitation CONSUMED, and records the result atomically. Failed validation does not consume the invitation. Plaintext passwords are never persisted, logged, or emailed. Existing ACTIVE CUSTOMER passwords are never modified by tenant assignment.

## SMTP delivery and mail boundary

`CustomerInvitationMailer` is SamChe-owned. `SmtpCustomerInvitationMailer` is the first adapter; core onboarding does not depend on Hostinger or any provider SDK. It validates before readiness/onboarding is advertised:

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, HTTPS `PUBLIC_INVITATION_BASE_URL`, and `INVITATION_ENVELOPE_ENCRYPTION_KEY`.

The adapter uses authenticated standard SMTP and sends from configurable `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME`; staging is configured as `support@samchecompany.com` / `SamChe Support`. It never logs credentials, headers, raw invitation URLs, or tokens.

`customer_invitation_outbox` is the durable delivery record. It has `PENDING_DELIVERY`, `SENT`, and `DELIVERY_FAILED` states, attempt count, next attempt time, safe provider code, and a dedupe key unique per invitation + delivery template/version. The invitation authority table stores only `SHA-256(token)`; the outbox may hold a separate, transient AES-256-GCM encrypted delivery envelope containing only the token material needed to construct the email link. The envelope uses `INVITATION_ENVELOPE_ENCRYPTION_KEY`, is decrypted only immediately before SMTP delivery, and is cleared after a confirmed send, expiry, revocation, resend replacement, or terminal failure. Encryption/decryption failure fails closed without email or plaintext fallback. A worker claims rows transactionally and retries bounded failures with backoff. Unknown SMTP timeout outcomes are not blindly resent in the same attempt; they remain recoverable for controlled retry/resend. Resend revokes the old invitation, destroys its delivery envelope, and makes a new outbox record, preventing duplicate current-token mail. A crash after transaction commit is recovered by the worker; SMTP failure leaves visible recoverable onboarding status.

No LLM/API call is permitted in any onboarding, invitation, password, or SMTP execution path. Focused acceptance tests assert OpenAI calls = 0, Gemini calls = 0, other LLM calls = 0.

## OWNER and customer Dashboard UX

Use one existing Dashboard portal/dialog primitive for Create company, Assign existing customer, invitation status, resend, and revoke. The portal root is above page/header stacking contexts with a documented z-index scale; dialogs have backdrop, focus trap, initial focus, focus restoration, Escape handling, scroll lock, keyboard navigation, visible focus, and controlled internal scrolling. Buttons, fields, selects, errors, loading, disabled behavior, and contrast reuse Dashboard primitives. No overlay may clip behind cards, header, or dropdowns at wide desktop, narrow desktop, or tablet widths.

Create company presents company name, first name, last name, and email, with `ADMIN` as the fixed initial role, and a primary `Create company & invite administrator` action. It validates fields, supplies idempotency, shows delivery/onboarding status, and safely exposes resend/revoke where authorized. `Assign existing customer` is secondary and lists/searches only ACTIVE, non-fixture CUSTOMER users; it allows only ADMIN or AGENT. The legacy direct-assignment endpoint enforces the same ACTIVE/non-fixture CUSTOMER restriction, so an INVITED user can gain a membership only through acceptance of that specific tenant invitation.

Role display is presentation-only:

- OWNER session: selected company name + `Platform Owner`.
- CUSTOMER + ADMIN membership: selected company name + `Administrator`.
- CUSTOMER + AGENT membership: selected company name + `Agent`.

OWNER sees all tenants and remains OWNER after context switching. CUSTOMER lists only actual memberships and never sees OWNER controls.

## Fixture isolation and staging-only cleanup

Add explicit `is_test_fixture BOOLEAN NOT NULL DEFAULT FALSE` metadata to users; fixtures must be created with it in deterministic test setup. Normal owner customer search and onboarding APIs exclude it. Product runtime never relies on email naming heuristics.

The cleanup script is structurally staging-only: it requires an explicit staging deployment marker, an allowlisted staging database host/name/identifier, dry-run mode by default, `--execute`, and a separate exact confirmation value. Any failed guard aborts before querying deletable rows.

The dry run reports safe fixture identifiers/counts and all dependent records. Execution uses one transaction and deletes only explicit fixture users and their fixture-only invitations/memberships/data. It fails closed if a fixture user has a non-fixture tenant relationship or any ambiguous dependency. It never deletes a real/manual account, service identity, owner account, or non-fixture tenant data. Foreign-key delete order is explicit and reviewed; ambiguous data is retained.

## API and authorization boundaries

OWNER-only endpoints: onboarding, invitation status, resend/revoke, existing-customer search, and membership assignment. Direct membership assignment accepts only an ACTIVE, non-fixture CUSTOMER and only ADMIN or AGENT; INVITED, DISABLED, fixture, and OWNER targets are rejected. Public endpoints: bounded invitation validation and acceptance only. Customer endpoints retain membership-based tenant access. Cross-tenant invitation/user/membership reads and writes are denied by tenant/user scoping.

Existing ACTIVE CUSTOMER path: resolve canonical email, preserve password and role, create/reuse requested membership, return safe assignment status, and optionally send a non-sensitive membership notification. It never creates a password-setup invitation.

Existing INVITED CUSTOMER path: resolve canonical email, retain INVITED status, issue/reuse only the requested tenant's invitation, and defer that membership until acceptance.

## Acceptance and regression gates

Security: >=32-byte random hash-only tokens; expiry; one-time/replay rejection; resend invalidation; bounded malformed inputs; rate limits; no token/password logs; Argon2id; HTTPS/no-referrer token handling.

Isolation and concurrency: Tenant A acceptance never enables Tenant B; cross-tenant access is denied; existing customer assignment is scoped; duplicate onboarding/membership/email races are safe; accept/resend/revoke races serialize.

SMTP: validated readiness; durable outbox/recovery/retry; sender `support@samchecompany.com`; no LLM calls.

UX: public acceptance route, safe terminal states, portal layering, focus/escape/restoration/scroll behavior, and responsive unclipped controls.

Cleanup: explicit metadata, dry-run default, staging DB identity guard, execute plus confirmation, dependency report, and non-fixture fail-closed protection.

Existing regressions remain green: PDF/DOCX/TXT/JPG/JPEG/PNG ingestion, Gemini Vision extraction, segment roles, PII redaction, candidate/review/indexing, Business Profile, Recommendation, Configuration, activation, WhatsApp runtime, and EN/TR/AR cross-topic switching.
