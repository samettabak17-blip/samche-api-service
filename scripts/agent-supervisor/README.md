# SamChe Away Mode Supervisor Runner

This isolated tool coordinates Prompt Architect decisions and single-message Aider runs. It does not import or start the SamChe application.

## Safety boundary

- Away Mode starts only with the exact activation phrase `devam et, ben olmayacağım`.
- Startup requires branch `staging` and a clean working tree.
- The task must be a JSON file under `.agent/tasks`.
- The runner never commits, pushes, merges, deploys, or supplies automatic yes responses.
- Aider runs with Git integration, repo-map discovery, shell suggestions, automatic linting, and automatic tests disabled.
- Only task-declared paths may change. Unexpected paths stop the run.
- Existing paths and ancestors are canonicalized so a symlink cannot escape the repository.
- Test commands are token arrays. Only `node --test`, `npm test`, and `npm run test:*` or `npm run verify:*` are accepted.
- Git and tests receive a minimal environment without `OPENAI_API_KEY` or unrelated ambient secrets. Aider receives only required operating-system variables and `OPENAI_API_KEY`.
- One absolute 30-minute deadline is shared by Prompt Architect, Aider, and every test command; timed-out process trees are terminated.
- Runtime output is redacted and stored under the ignored `.agent/runs` directory.

## API key

Set `OPENAI_API_KEY` in the current process environment. Do not put a key in this repository.

```powershell
$env:OPENAI_API_KEY = Read-Host "OPENAI_API_KEY" -MaskInput
```

## Task contract

Create a narrow task such as `.agent/tasks/TASK-001.json`:

```json
{
  "id": "TASK-001",
  "objective": "Verify and implement one narrowly defined behavior.",
  "allowed_paths": ["dashboard/example.js", "tests/example.test.js"],
  "read_only_paths": [".agent/supervisor-policy.md"],
  "allowed_commands": [["node", "--test", "tests/example.test.js"]]
}
```

Do not use repository-root paths, wildcards, shell operators, or high-risk objectives.

## Commands

The runner requires a clean working tree. Commit or otherwise resolve the tooling changes manually before a future preflight.

Preflight performs no OpenAI or Aider call:

```powershell
.\scripts\agent-supervisor\Start-AwayMode.ps1 `
  -TaskFile ".agent\tasks\TASK-001.json" `
  -ActivationPhrase "devam et, ben olmayacağım" `
  -PreflightOnly
```

Start Away Mode only after the user explicitly gives the activation phrase:

```powershell
.\scripts\agent-supervisor\Start-AwayMode.ps1 `
  -TaskFile ".agent\tasks\TASK-001.json" `
  -ActivationPhrase "devam et, ben olmayacağım"
```

Run local unit tests without starting Away Mode:

```powershell
node --test ".\scripts\agent-supervisor\tests\supervisor-runner.test.mjs"
```

## Cost boundary

Prompt Architect usage is calculated from Responses API usage fields. Aider-reported cost is accumulated after each completed call. The runner refuses another iteration when the recorded task cost reaches USD 0.25. Because Aider makes its own request, a single in-flight Aider call cannot be interrupted at an exact dollar amount; the OpenAI project spend limit remains the external hard backstop.
