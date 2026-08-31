# SamChe Supervisor Policy

This policy defines how the SamChe Aider + Supervisor + Prompt Architect workflow must operate.

## Core Workflow

Aider must not start open-ended work by itself.

Every run must follow this loop:

1. Supervisor receives a task or Aider report.
2. Prompt Architect reviews the report.
3. Prompt Architect writes the next exact Aider prompt.
4. Supervisor sends only that approved prompt to Aider.
5. Aider executes the prompt.
6. Aider produces a structured AIDER RUN REPORT.
7. Supervisor either continues, marks GREEN, marks BLOCKED, or requests human review.

## Modes

### VERIFY

Read-only mode.

Allowed:
- inspect files
- run safe git commands
- run tests
- summarize findings

Not allowed:
- edit files
- create files
- delete files
- commit
- push

### IMPLEMENT

Controlled edit mode.

Allowed:
- modify only files explicitly allowed by the prompt
- add tests only if the prompt allows it
- run required checks

Not allowed:
- modify unrelated files
- auto-commit
- push
- deploy

### STOP

Stop immediately and request human review.

Required when:
- destructive command is needed
- database migration is needed
- secrets or credentials are involved
- billing/provider configuration is involved
- security architecture is involved
- production deploy is involved
- staging/main merge is involved
- the same issue fails repeatedly

### AWAY MODE ACTIVATION

Away Mode may start only when the user explicitly says:

`devam et, ben olmayacağım`

The same exact phrase must be supplied to the supervisor runner. Design approval, implementation approval, or `ONAYLIYORUM` is not sufficient.

## Forbidden Automatic Actions

Aider/Supervisor must never automatically:

- deploy to production
- merge to staging or main
- run git reset --hard
- change secrets or credentials
- modify billing logic
- modify provider/model governance without approval
- create destructive database migrations
- perform broad redesigns or unrelated refactors

## SamChe Architecture Rules

All changes must preserve:

- tenant isolation
- provider-agnostic architecture
- no customer-specific hardcoded logic
- no SamChe branding leakage in white-label tenant UI
- approved Knowledge Intelligence lifecycle
- review/approval before production knowledge changes
- clean audit trail
- narrow task scope
- tests before GREEN status

## Iteration Limits

Default limits:

- max_cost_per_task_usd: 0.25
- max_iterations: 3
- max_fix_attempts: 2
- max_runtime_minutes: 30

`.agent/away-mode.config.json` is the machine-enforced source of truth for these values and the required model `gpt-5.6-luna`.

If limits are reached, mark the task as BLOCKED or HUMAN_REVIEW_REQUIRED.

## Required Final Report

Every Aider run must end with an AIDER RUN REPORT using:

- Task
- Status
- Repository
- Branch
- HEAD
- Files Read
- Files Modified
- Commands Run
- Test Results
- Root Cause
- Changes Made
- Remaining Failures
- Risks
- Next Action
