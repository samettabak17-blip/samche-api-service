# SamChe Agent Workspace

This folder is used for controlled Aider + Supervisor task execution.

Aider must not choose its own scope. Every task must start from an approved prompt. Unexpected failures must be reported and marked as blocked.

## Modes

- Manual Mode is the default and requires the user to run every Aider prompt.
- Away Mode starts only when the user explicitly says `devam et, ben olmayacağım` and then runs the supervisor command with that exact activation phrase.
- Design approval, implementation approval, or `ONAYLIYORUM` does not activate Away Mode.

## Machine-enforced configuration

`.agent/away-mode.config.json` is the machine-readable source for model, budget, iteration, fix-attempt, and runtime limits. Human-readable policy files must stay aligned with it.

Away Mode task files are JSON documents under `.agent/tasks` and must follow `.agent/schemas/away-task.schema.json`. Runtime logs are local-only under `.agent/runs`.

See `scripts/agent-supervisor/README.md` for setup and commands.
