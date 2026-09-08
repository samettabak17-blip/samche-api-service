# SamChe Strict Execution / Non-Regression Contract

This is the canonical repository-level instruction for AI coding agents working
in SamChe. It is intended to be discovered and read by Codex, Cline, Aider,
and future AI coding agents before they inspect or change the repository.

Read this file together with the existing guidance in `.agent/budget-policy.md`
and `docs/engineering/`. Those sources remain authoritative for their own
topics; do not duplicate or replace them here.

## 1. Strict execution and scope

- Do exactly the requested task and its explicit acceptance criteria.
- Do not broaden scope, redesign unrelated architecture, perform speculative
  refactors, or touch unrelated files.
- Do not write customer-specific code, customer-specific branches, customer
  names, tenant IDs, or one-off behavior. Implement generic, tenant-driven
  architecture using configuration, capabilities, policies, and data rather
  than hardcoded customer exceptions.
- If a required dependency or file is outside the authorized scope, stop and
  report `REQUIRED_ADDITIONAL_FILE`, `REQUIRED_FUNCTION`, and `WHY_REQUIRED`.

## 2. Absolute non-regression and compatibility

- Backward compatibility and non-regression are mandatory, not optional.
- Preserve every existing valid capability, API contract, authorization rule,
  tenant boundary, workflow, and user-visible behavior unless the task
  explicitly changes it.
- Preserve historical valid data and state. Do not delete, rewrite, invalidate,
  or reinterpret existing records, configurations, migrations, or tenant state
  without explicit authorization and a safe migration plan.
- New behavior must work for existing tenants and newly created tenants. Do not
  require tenant-specific repairs or special deployment steps.
- Treat all prior capabilities as regression contracts. New tests must cover
  the requested behavior without weakening old tests or acceptance criteria.

## 3. Repository access boundary

- Work only with files explicitly listed in the task and directly referenced
  dependencies that are strictly necessary.
- Do not perform repository-wide searches or scans unless the task explicitly
  authorizes them.
- Do not use broad codebase search, recursive symbol search, repository-wide
  grep/ripgrep, recursive directory enumeration, unrelated file discovery, or
  unrelated test discovery.
- Prefer targeted reads and existing engineering guidance. Avoid
  `node_modules`, generated files, and secrets.
- Never expose, print, copy, or commit secrets, credentials, tokens, or private
  customer data.

## 4. Diagnosis, tests, and runtime verification

- Do not guess the root cause. Establish it from the smallest relevant set of
  files, reproducible evidence, and focused checks.
- Tests are necessary but not sufficient. A compile, lint, or passing test suite
  does not by itself prove that the requested behavior works.
- Verify the acceptance criteria directly. When behavior depends on runtime
  configuration, integrations, persistence, authorization, or deployment
  wiring, perform appropriate live/runtime or staging verification as well.
- If runtime verification is relevant but unavailable, report that explicitly;
  do not claim completion based only on static checks.
- Do not weaken, delete, skip, or broadly rewrite tests to obtain a pass.

## 5. Safe logging and observability

- Logs must be safe for production and multi-tenant operation.
- Never log secrets, credentials, access tokens, full sensitive payloads,
  private personal data, or cross-tenant data.
- Use safe identifiers, redaction, and sufficient context to diagnose failures
  without exposing sensitive information.

## 6. Git and worktree safety

- Preserve unrelated staged, unstaged, and untracked worktree changes.
- Do not reset, clean, overwrite, delete, stash, or reformat unrelated work.
- Do not modify production or deploy unless explicitly instructed.
- Do not commit, push, merge, or change branches unless explicitly instructed.
- Review the final diff and ensure every changed file is within the authorized
  scope.

## 7. Completion gate

A task is complete only when all of the following are true:

1. The requested behavior and every acceptance criterion are implemented.
2. Existing capabilities and valid historical data/state remain compatible.
3. Focused tests and any relevant broader regression checks pass.
4. Relevant live/runtime or staging verification has passed, or its absence is
   clearly reported.
5. The final diff contains no unrelated changes and `git diff --check` passes.

Automated release/test processes must own and close every resource they create.
A suite that completes assertions but leaves referenced resources keeping Node
alive is not GREEN; forced process termination must not mask lifecycle leaks.

Report files read, files modified, verification performed, results, and any
remaining limitation. Never report success merely because code compiles or
tests pass.

## 8. Stop condition

Stop and request human review immediately for production deployment, a
staging/main merge, destructive migrations, secrets or credentials, billing or
provider configuration, security architecture changes, broad architecture
changes, customer-specific hardcoding risk, an unclear root cause after
verification, repeated verification failure, or any request to inspect or
modify files outside the authorized scope.

## 9. Canonical tenant behavior and messaging

- A tenant inherits the canonical platform behavior engine; tenant data and
  explicitly supported configuration may specialize behavior but must never
  fork, remove, or bypass shared capabilities. Provisioning and idempotent,
  non-destructive backfill must preserve this for new and existing tenants.
- Fixed platform lifecycle messages are database-backed, localized,
  deterministic templates shared across channels. They do not use an LLM or
  runtime translation. Contextual AI follow-up is a separate capability: its
  copy is generated from the resolved tenant, conversation, language, and
  grounded business context, then persisted and delivered idempotently.
- Customer-facing behavior is always white-label and tenant-driven. Never add
  customer-specific code, identifiers, prompts, branches, or platform-brand
  leakage for another represented tenant.
- Human-support ownership, fallback, scheduled follow-up, WhatsApp, Web Chat,
  AI Guide, Live Inbox, takeover, and return-to-AI are shared cross-channel
  regression contracts. Future work must not silently change their semantics,
  tenant isolation, historical compatibility, or canonical lifecycle policy.
- Durable jobs, escalation instances, notification outbox rows, and persisted
  messages are the authority; process memory is never an authority. Telegram
  is not an active runtime dependency, and wpSessions is not a source of truth.
- Background employee-phone delivery requires a configured external transport;
  do not simulate it or add provider credentials without explicit approval.

## 10. Agent continuity and cumulative release gate

- This file is the single authoritative cross-agent engineering contract for
  Codex, Cline, Aider, and future coding agents. Agent-specific entry files may
  point here but must not duplicate or diverge from this policy.
- A new tenant is not a new implementation. Canonical provisioning and
  idempotent, non-destructive repair/backfill must give old and new tenants the
  same shared platform capabilities, subject only to supported entitlements
  and tenant data/configuration.
- Never repair missing platform behavior with tenant-specific application code
  or manual tenant patches.
- The machine-readable capability registry, canonical provisioning/ensure
  service, migrations/backfills, old-tenant fixture, two-fresh-tenant isolation
  checks, and cumulative Fresh Tenant Golden Path are release contracts.
- New-tenant provisioning and old-tenant repair must call the same ensure
  semantics. Only the normal provisioning path may be used for fresh-tenant
  acceptance; manual database patches cannot satisfy the release contract.
- A competing source of truth, critical process-memory authority, tenant
  boundary failure, or screen-level customer-visible error is a release
  blocker even when unit tests pass.
- Every tenant-affecting platform task must retain the prior Golden Path and add
  its new capability coverage. Never replace or narrow prior GREEN coverage.
- Critical SQL paths that depend on PostgreSQL-specific types, operators,
  aggregates, constraints, or transaction behavior must execute in the
  disposable PostgreSQL release gate; mocked query-shape tests alone cannot
  establish compatibility with the deployed database engine.
- Run the release-blocking golden-path command before claiming completion. If a
  previously GREEN capability regresses, tenant age alone changes behavior, or
  tenant-specific source changes are required, report `TASK_COMPLETE = NO`.
- Image-derived candidate approval requires exactly one tenant-scoped trusted
  Business Identity chain from BUSINESS PRIMARY evidence. Canonical convergence
  may repair only unapproved historical candidates when one explicit source
  identity is proven; CUSTOMER evidence is never business truth, missing or
  conflicting identities fail closed, and APPROVED history is immutable.

- Once SamChe supports a Knowledge source type, all downstream consumers must
  derive readiness, identity validity, provenance validity, indexing readiness,
  Business Profile eligibility and candidate approval eligibility from shared
  canonical backend/domain authority. A source must never be GREEN in one
  subsystem but unusable in another due only to tenant age, source age,
  migration timing, assignment timing, generation timing or coding-agent
  changes. Every root-caused defect class fixed in human acceptance must become
  permanent regression coverage.
- Knowledge lifecycle state is derived, never duplicated as ad-hoc raw-column
  checks: index eligibility and index readiness are distinct, and only a
  successful normal indexing operation may establish index readiness. Candidate
  approval eligibility and Business Profile eligibility remain separate.
  CUSTOMER-context-bearing raw sources must never enter retrieval merely to
  satisfy profile eligibility; only safely approved canonical knowledge follows
  the normal durable indexing path. Historical and fresh tenant data converge
  through the same tenant-scoped, idempotent product behavior, never through a
  manual tenant patch.
- A successful user-visible domain mutation must correspond to durable canonical
  state. Explicit source Business Identity assignment persists both the current
  tenant-scoped relationship and its audit evidence transactionally; repeated
  assignment must converge eligible unapproved provenance without duplicating
  audit history. Historical restoration may use only one unambiguous, same-tenant
  authoritative assignment trail and must otherwise fail closed.

- Fresh tenants must inherit the complete shared platform capability baseline
  through normal provisioning without manual database, relationship, scope,
  index, embedding, or runtime repair. Provisioning must not fabricate
  customer-owned domain entities whose creation requires normal user/domain
  intent; historical tenants converge through the same tenant-scoped,
  idempotent capability, migration, runtime, or approved durable-job path.
- Every critical tenant lifecycle relationship has exactly one documented
  canonical creator and owner. Tenant-specific behavior belongs only to data
  and supported configuration, never source-code branches. Cross-cutting
  lifecycle changes require historical, fresh, and isolation evidence before
  GREEN; incomplete test or platform resources are not GREEN.
- Guide, Web, and WhatsApp are channel adapters over the same canonical tenant
  identity, active configuration, active Business Profile, and approved
  knowledge authority. They must not introduce parallel business truth or
  require an admin/debug action to repair hidden runtime state.
- The AI Guide channel (`SAMCHEGUIDE`) is the assistant-bound channel adapter
  for the tenant's AI Assistant. Each active assistant maintains a canonical
  same-tenant `tenant_channels` record and `channel_integrations` mapping. The
  normal Guide lifecycle automatically ensures this channel across assistant
  creation, channels enumeration, and Guide Experience domain and publication
  flows; generic Web Chat and WhatsApp channel management UI must not fabricate
  or expose manual Guide channel creation.
- Platform-managed staging Guide routing uses one canonical platform hostname
  with tenant-safe path-based resolution; tenant-specific wildcard DNS is not a
  runtime dependency; custom Guide domains remain host-based.

- Push subscriptions are tenant/user/device scoped records; a browser
  subscription never grants tenant authorization. Notification intents and
  delivery transports are observational, idempotent, bounded, and replaceable:
  a delivery failure must never mutate the originating domain outcome. Push
  payloads and deep links must minimize sensitive data and permit only validated
  internal routes. Real device receipt remains a human-acceptance gate.
- Once a Business Identity has been resolved, its tenant-scoped canonical ID is
  authoritative for domain equality, eligibility, authorization, conflict
  detection, and lifecycle decisions. Display names are presentation and
  evidence-explanation data only; they may support a bounded, unambiguous
  resolution step but must never override a contradictory canonical ID or become
  a parallel frontend source of identity truth. PostgreSQL-backed identity and
  provenance decisions require disposable real-PostgreSQL regression coverage.
- Tenant-specific factual claims require eligible canonical tenant authority (ACTIVE Business Profile, ACTIVE Assistant Configuration, or approved canonical Knowledge Intelligence). General model/world knowledge may support reasoning, generic domain concepts, or general educational explanation, but must never be promoted into unsupported facts about a tenant.

