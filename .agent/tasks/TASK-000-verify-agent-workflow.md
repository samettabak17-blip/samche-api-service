# TASK-000 — Verify SamChe Agent Workflow

## Mode
VERIFY

## Objective
Verify that the SamChe Aider workflow can read the agent workspace, supervisor policy, budget policy, and prompt architect template without modifying application source files.

## Allowed Scope
Aider may read only:

- .agent/README.md
- .agent/supervisor-policy.md
- .agent/budget-policy.md
- .agent/templates/task-template.md
- .agent/templates/report-template.md
- .agent/templates/prompt-architect-template.md

## Do Not Modify
Do not modify, create, delete, rename, commit, push, or deploy anything.

Do not inspect unrelated application source files.

## Required Commands
Run:

git status

## Acceptance Criteria
GREEN if:

- Aider reads the allowed files only
- no files are modified
- git status remains clean
- final answer uses AIDER RUN REPORT format

## Stop Conditions
Stop immediately if:

- Aider wants to edit any file
- Aider wants to inspect unrelated source code
- git status is not clean
- any command requests destructive action
