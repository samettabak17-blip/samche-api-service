# SamChe Strict Execution / Non-Regression Contract

This is the canonical repository-level instruction for every coding or
execution agent working in SamChe. It applies without exception to every
current and future coding agents, including Codex, Cline, Aider, and successors. An
agent name in this file or in historical repository guidance is illustrative
only; it never narrows, waives, or changes this contract.

Read this file together with the existing guidance in `.agent/budget-policy.md`
and `docs/engineering/`. Those sources remain authoritative for their own
topics; do not duplicate or replace them here.

Before starting every task, agents MUST also read the repository-root
`GREEN_BASELINES.md` registry when it exists. That registry is the canonical
record of completed and verified GREEN capabilities.

## 0. Agent governance and GREEN baseline protection

This section is a permanent governance rule for every future Codex, Cline,
Aider, supervisor, or other coding/execution agent.

### Mandatory task-start check

At the beginning of every task, before analysis or edits, the agent MUST
record:

```text
GREEN_BASELINE_REVIEW:
AGENTS_READ:
YES

GREEN_BASELINES_READ:
YES

CURRENT_TASK_CONFLICTS_WITH_GREEN:
YES/NO

GREEN_AREAS_AFFECTED:
```

The agent must identify the protected areas relevant to the task, confirm that
the requested scope does not conflict with them, and stop for human direction
if the target, ownership, or intended behavior is unclear.

### GREEN baseline protection

Completed and verified GREEN tasks are protected baselines. Agents MUST NOT
reopen completed GREEN tasks, redo previous GREEN implementations, refactor
GREEN areas without a new explicit requirement, redesign working architecture,
remove existing safeguards, or change unrelated files. Existing working
architecture must remain stable unless the requested task requires a specific
change.

If a future task requires modifying a GREEN area, the agent MUST document this
before editing:

```text
GREEN_AREA_MODIFICATION_REQUIRED:
YES

REASON:

WHY_CURRENT_IMPLEMENTATION_IS_NOT_ENOUGH:

EXPECTED_IMPACT:

REGRESSION_TEST_REQUIRED:
```

### Modification boundary

Agents may modify only files explicitly required by the task and directly
referenced dependencies that are strictly necessary. Application source,
services, tests, migrations, and runtime behavior remain protected unless the
task explicitly authorizes a change to them. Documentation and agent-rule
changes must not be used to justify unrelated implementation refactors.

Every change must preserve existing architecture, tests, contracts, safeguards,
tenant isolation, historical/fresh tenant parity, and valid user-visible
behavior. Broad refactoring, speculative cleanup, and redesign of working
systems are outside scope.

### Protected GREEN areas

The following completed and verified areas are protected regression baselines.
Any change touching them requires the GREEN modification declaration above and
focused regression evidence.

#### Instagram

- Instagram DM orchestration
- Instagram personal assistant identity (natural configuration-driven assistant persona, non-impersonation, tenant-reusable generic runtime)
- Reel/video priority handling (customer text priority, stale response suppression, no unsolicited media hallucination)
- stale response prevention
- human takeover behavior (NEVER_AI persistence and manual operator isolation)
- AI reply reliability (AI_ONLY default, message request folder ingress, deduplication, closed conversation recovery, long-response & unicode parity)
- appointment qualification (intake fields, multi-turn memory, customer forwarding summary, silent internal qualified-lead forwarding)
- appointment date/time safety (no invented calendar availability or fake confirmations, preserving approximate times)
- scoped YouTube guidance (Dubai living/cost topics only, approved URL, non-footer)
- native app state sync non-blocker (mark_seen unsupported; SamChe Dashboard is operational source)
- provider parity

#### WhatsApp

- inbound lifecycle
- human takeover
- notification flow
- tenant isolation

#### Appointment System

- purpose detection
- missing information handling
- date/time validation
- slot invention prevention
- conversation context memory

#### Visual AI

- visual job lifecycle
- worker processing
- job claim logic
- approved catalog only rule
- product identity lock
- room preservation
- continuation memory
- product label behavior

#### Knowledge Intelligence

- approval workflow
- runtime-only APPROVED knowledge usage
- tenant isolation
- evidence tracking
- draft/review separation

### Tenant-generic implementation rule

Every implementation MUST work for all tenants. Tenant-specific hardcoding,
customer-specific exceptions, and SamChe-only logic are forbidden. Code such
as `if tenant == samche` is explicitly forbidden.

Behavior must be controlled through generic architecture, supported
configuration, and tenant-owned knowledge/data. No customer name, tenant ID,
prompt branch, or one-off source-code path may be introduced to change platform
behavior. White-label behavior and canonical shared capabilities must remain
consistent for historical and fresh tenants.

### Minimal-change rule

Agents MUST modify only what is required, avoid broad refactoring, preserve
the existing architecture, and preserve all existing tests and contracts.

### Required final task report

Every agent final report MUST include:

```text
TASK_STATUS:

FILES_CHANGED:

GREEN_AREAS_TOUCHED: YES/NO

IF YES:
EXPLANATION:

TENANT_GENERIC: PASS/FAIL

REGRESSION_TESTS:

COMMIT:

PUSH:
```

The report must also state files read, verification performed, and any
remaining limitation. A documentation-only task must explicitly confirm that
no application source, services, tests, migrations, or runtime behavior were
changed.

## 1. Mandatory task preflight and contract acknowledgement

Before inspecting, changing, testing, committing, pushing, or deploying for
every task, every coding/execution agent MUST:

1. Read the complete, current `AGENTS.md` directly from the target repository;
   a cached summary, prior prompt, partial excerpt, or another agent's report
   is not sufficient.
2. Inspect and report `git status`, then verify and report the repository root,
   intended branch, worktree identity (including whether it is linked), current
   `HEAD`, and the intended remote target before analysis or a change. Classify
   the worktree as a clean baseline, current-task changes, unrelated
   pre-existing changes, or changes that may belong to another active task;
   preserve every unrelated change. If any required target is unclear or
   differs from the task, stop for human direction.
3. Read and explicitly acknowledge all directly applicable repository
   contracts, including `.agent/budget-policy.md` and the relevant
   `docs/engineering/` guidance, before acting on them.
4. Explicitly acknowledge that the task will preserve canonical tenant-wide
   behavior, historical/fresh tenant parity, strict tenant isolation,
   non-regression, security, testing, verification, commit/push, and
   human-acceptance requirements that apply to the task.

No prompt, agent-specific instruction, task shorthand, or historical workflow
may bypass this preflight. Where repository guidance conflicts, this canonical
repository contract governs.

## 2. Strict execution and scope

- Do exactly the requested task and its explicit acceptance criteria.
- Do not broaden scope, redesign unrelated architecture, perform speculative
  refactors, or touch unrelated files.
- Do not write customer-specific code, customer-specific branches, customer
  names, tenant IDs, or one-off behavior. Implement generic, tenant-driven
  architecture using configuration, capabilities, policies, and data rather
  than hardcoded customer exceptions.
- Do not use manual database repairs, per-tenant prompt patches, or
  tenant-specific source-code branches to restore or create platform behavior.
  They cannot satisfy a task's acceptance or release contract.
- If a required dependency or file is outside the authorized scope, stop and
  report `REQUIRED_ADDITIONAL_FILE`, `REQUIRED_FUNCTION`, and `WHY_REQUIRED`.

## 3. Absolute non-regression and compatibility

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

## 4. Repository access boundary

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

## 5. Diagnosis, tests, and runtime verification

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

## 6. Safe logging and observability

- Logs must be safe for production and multi-tenant operation.
- Never log secrets, credentials, access tokens, full sensitive payloads,
  private personal data, or cross-tenant data.
- Use safe identifiers, redaction, and sufficient context to diagnose failures
  without exposing sensitive information.

## 7. Git and worktree safety

- Preserve unrelated staged, unstaged, and untracked worktree changes.
- Do not reset, clean, overwrite, delete, stash, or reformat unrelated work.
- Do not modify production or deploy unless explicitly instructed.
- Do not commit, push, merge, or change branches unless explicitly instructed.
- Review the final diff and ensure every changed file is within the authorized
  scope.

### Multi-agent and remote staging safety

- Commit construction is task-scoped: commit only the approved current task's
  files and changes. Never include another agent's work, unrelated user work,
  or pre-existing unrelated modifications. If a file contains both current-task
  and unrelated changes, preserve both and do not destructively rewrite it just
  to simplify a commit.
- When active tasks need the same file or overlapping code, treat it as a
  coordination/conflict condition. Inspect the current state, preserve newer
  valid changes, and integrate only when both scopes can be safely reconciled.
  If reconciliation would require guessing, destructive rewriting, or changing
  another task's semantics, stop and report the conflict.
- For staging tasks, refresh and inspect `origin/staging` before committing,
  pushing, or claiming completion. If another task advanced it, never overwrite
  it, force-push, or reset away local work; safely reconcile with the newer
  staging state, preserve both valid histories, and re-evaluate assumptions
  affected by the newer changes.
- After reconciliation with newer `origin/staging`, rerun every focused,
  regression, tenant-isolation, migration, real-PostgreSQL, Fresh Tenant Golden
  Path, build/syntax, and other mandatory gate whose validity could have been
  affected. Previously GREEN evidence cannot be reused when code or dependency
  state changed underneath it.
- For a staging task explicitly authorized to commit and push, refresh the
  remote after the final push and report both hashes. `LOCAL_HEAD` MUST equal
  `origin/staging` HEAD before claiming successful completion; if they differ,
  `TASK_COMPLETE` MUST NOT be `YES`. This requirement does not authorize a
  commit or push by itself.
- Never use destructive Git or worktree operations to eliminate another task's
  state or make the current task easier. Unless an exceptional, human-approved
  recovery explicitly requires it, this includes reset, clean, stashing another
  task's work, checkout/restore that discards unrelated changes, force-push,
  destructive rebase over another task, deleting another task's files, or
  overwriting shared-file changes without reconciliation. The normal solution
  is preservation and safe reconciliation, never deletion.

## 8. Completion gate

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

## 9. Stop condition

Stop and request human review immediately for production deployment, a
staging/main merge, destructive migrations, secrets or credentials, billing or
provider configuration, security architecture changes, broad architecture
changes, customer-specific hardcoding risk, an unclear root cause after
verification, repeated verification failure, or any request to inspect or
modify files outside the authorized scope.

## 10. Canonical tenant behavior and messaging

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

## 11. Agent continuity and cumulative release gate

- This file is the single authoritative cross-agent engineering contract for
  every current and future coding/execution agent. Agent-specific entry files
  may point here but must not duplicate, reinterpret, weaken, or diverge from
  this policy.
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
- WhatsApp conversations maintain provider-native typing indicators strictly scoped to eligible inbound AI responses: typing is initiated via canonical transport before generation, suppressed when a human owns handling or during handoff, bounded by adaptive natural compose pacing when generation is fast, introduces zero artificial delay for naturally paced responses, and terminates naturally upon message delivery or safe error handling without keepalive loops or content alteration.

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

## 12. Human-approved scoped staging exception

The cumulative Fresh Tenant Golden Path remains the mandatory release contract.
A scoped exception does not make a failing test, capability, suite, or Golden
Path GREEN. It is a documented, one-time human decision to permit one exact
commit to one staging release while a separately owned, pre-existing failure
remains unresolved.

### Absolute boundary

- This mechanism applies to staging only. Production, `main`, production
  promotion, and any production-equivalent release require the complete
  mandatory gate to be genuinely GREEN with zero exceptions.
- The unchanged `npm run test:fresh-tenant-golden-path` command MUST be run and
  its non-zero result, failing stage, and exact failures MUST be preserved in
  the evidence record. The runner, tests, classifications, and assertions MUST
  NOT be changed, skipped, filtered, quarantined, muted, or reclassified to
  create eligibility.
- An exception never authorizes a push, deployment, merge, production action,
  or physical-acceptance claim by itself. Those actions require their own
  explicit human approval after the evidence record is complete.
- Agents MUST report the Golden Path as `FAIL`, the staging decision as either
  `HOLD` or `SCOPED_EXCEPTION_ELIGIBLE`, and production as `BLOCKED`. They MUST
  NOT use `GREEN`, `PASS`, or `TASK_COMPLETE = YES` for the cumulative gate.

### Eligibility requirements

Before an exception can become `SCOPED_EXCEPTION_ELIGIBLE`, all of the
following are mandatory:

1. A record exists under `docs/releases/staging-exceptions/` and identifies the
   exact application candidate commit, exact staging base, exact rollback
   commit, intended staging release, creation time, expiry condition, and human
   approval source. If the governance record is committed after the application
   candidate, the release HEAD may be a direct descendant only when every
   intervening path is an explicitly allowlisted governance document. The
   resulting release HEAD must be captured in the external final approval and
   deployment evidence; application code outside the candidate is forbidden.
2. The candidate and base run the unchanged cumulative gate in equivalent,
   isolated test environments. The same explicitly recorded pre-existing
   failures must be present on both. Any additional, renamed, missing, or
   differently behaving failure invalidates the exception.
3. The record contains exact commands, timestamps, exit codes, failing stage,
   test names, and artifact/log references. Prior task summaries alone are not
   fresh release evidence.
4. A strict base-to-candidate diff review records every changed path. The
   changed-path set must exactly match the human-approved allowlist; no wildcard
   or directory-wide approval is allowed.
5. Focused tests for the candidate change, tenant-isolation tests, security and
   authorization tests, provider-failure tests, and all other tests affected by
   the diff pass with zero skips introduced by the candidate.
6. Shared dependencies and provider layers receive an explicit indirect-impact
   review. The record must list their callers and explain why customer-channel
   behavior is unchanged, with focused regression evidence where a shared path
   could affect Instagram, WhatsApp, Web Chatbot, or AI Guide.
7. Protected customer-channel implementation, tests, fixtures, prompts, and
   policies are unchanged unless separately and explicitly authorized. A
   staging exception cannot authorize such a change implicitly.
8. The record contains detection signals, rollback owner, rollback steps, and
   the last known safe rollback commit. Rollback must use normal auditable Git
   and deployment history; force-push, destructive reset, or history rewriting
   is forbidden.
9. A human reviews the completed evidence and explicitly approves the exact
   candidate for the exact staging release. An agent cannot approve its own
   exception or infer approval from a general request to continue.

### Validity and closure

The exception is single-use and becomes invalid when the candidate hash,
approved governance-only descendant, staging base, diff, test files, test
runner, failure set, release target, or approval scope changes; when the remote
staging branch advances; when evidence is incomplete or stale; or when any
security, tenant-isolation, authorization, data-integrity, migration, or
customer-channel regression is observed.

After staging deployment, the requested Dashboard behavior and protected
customer-channel smoke checks require human physical acceptance. A failed
acceptance triggers the recorded rollback. The underlying red tests remain an
open blocker and must be resolved before production or removal of the evidence
record's unresolved-risk status.
