# SamChe Agent Budget and Mode Policy

This policy controls how the SamChe Aider + Supervisor + Prompt Architect workflow operates in Manual Mode and Away Mode.

## Billing Rule

Aider and Prompt Architect use OpenAI API credits through OPENAI_API_KEY.

This usage is separate from ChatGPT Plus, ChatGPT Pro, and Codex usage limits.

## Current Cost Controls

The development agent must use the dedicated SamChe Dev Aider Agent OpenAI project.

Required controls:

- allowed model: gpt-5.6-luna only
- auto-reload: OFF
- prepaid balance limit: 5 USD
- organization spend limit: 5 USD
- project rate limit: 60,000 TPM / 10 RPM
- local Aider auto-commits: false

## Manual Mode

Manual Mode is the default.

Use Manual Mode when the user is at the PC.

In Manual Mode:

1. Aider runs only the exact prompt manually provided by the user.
2. Aider produces a report.
3. The user sends the report to ChatGPT.
4. ChatGPT writes the next Aider prompt.
5. The user manually pastes the prompt into Aider.

Aider must not automatically continue to the next step in Manual Mode.

## Away Mode

Away Mode may only start when the user explicitly says:

"devam et, ben olmayacagim"

In Away Mode:

1. Supervisor receives the current task and latest Aider report.
2. Supervisor sends the report to the OpenAI API Prompt Architect.
3. Prompt Architect writes the next exact Aider prompt.
4. Supervisor sends only that approved prompt to Aider.
5. Aider executes the prompt.
6. Aider produces an AIDER RUN REPORT.
7. Supervisor repeats the loop only within the allowed limits.

Aider must not choose its own next scope.

## Default Away Mode Limits

Per task:

- max_cost_per_task_usd: 0.25
- max_iterations: 3
- max_fix_attempts: 2
- max_runtime_minutes: 30

If any limit is reached, the task must stop with:

BLOCKED

or

HUMAN_REVIEW_REQUIRED

## Stop Conditions

Stop immediately and require human review for:

- production deploy
- staging/main merge
- destructive migration
- secrets or credentials
- billing/provider configuration
- security architecture
- broad architecture change
- customer-specific hardcoding risk
- repeated failure after allowed attempts
- unclear root cause after verification
- Aider wants to inspect unrelated files
- Aider wants to modify files outside allowed scope

## Required Report

Every run must report:

- mode used: Manual Mode or Away Mode
- model used
- estimated API cost
- iterations used
- files read
- files modified
- commands run
- test results
- final status
- next action
