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
