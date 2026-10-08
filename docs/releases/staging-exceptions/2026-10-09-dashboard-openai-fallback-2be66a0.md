# Scoped Staging Exception Evidence — Dashboard OpenAI Fallback

## Decision state

- Governance design approval: **APPROVED**
- Evidence completeness: **INCOMPLETE — comparable Golden Path evidence blocked by local pgvector prerequisite**
- Staging release approval: **NOT YET GRANTED**
- Staging release decision: **HOLD**
- Production release decision: **BLOCKED — full GREEN required**
- Fresh Tenant Golden Path: **FAIL — never GREEN under this exception**

This record documents a possible one-time staging exception. It does not
authorize a push or deployment. A human must review the completed evidence and
approve this exact candidate for one exact staging release.

## Immutable release identity

- Application candidate commit: `2be66a0434229371c15004dc6d3f1a922992ead9`
- Staging base: `b0a7b13d6d12348c5508fef8aa1fe7718e3bcd9a`
- Rollback commit: `b0a7b13d6d12348c5508fef8aa1fe7718e3bcd9a`
- Record created: `2026-10-09T00:21:17+04:00` (`Asia/Dubai`)
- Intended environment: `staging` only
- Intended release: one deployment whose application payload is the exact
  candidate commit plus only the allowlisted governance documents below
- Governance-only descendant release HEAD before evidence amendment:
  `1198ee74cbf7f2982a190696c35dbef54be9d7fe`
- Final amended governance/release HEAD: **record in the external final report and
  final human approval** (a commit cannot contain its own hash)
- Staging deployment identifier: **PENDING**
- Rollback owner: **PENDING**
- Governance approval source: direct human approval in Codex task
  `01a11d1f-d42b-71b3-a1bc-f47ec9b324f7` on `2026-10-09`
- Final staging release approver: **PENDING**
- Final staging approval timestamp/reference: **PENDING**

Any change to the application candidate, approved governance-only descendant,
base, rollback target, diff, test runner, failure set, environment, or release
scope invalidates this record.

## Approved candidate diff allowlist

The base-to-candidate application diff must contain exactly these paths:

- `services/knowledge-assistant-lifecycle.js`
- `services/knowledge-generation-provider.js`
- `tests/knowledge-assistant-lifecycle.test.js`
- `tests/knowledge-generation-provider.test.js`

Governance amendments made after the candidate commit are reviewed separately
and are limited to:

- `AGENTS.md`
- `GREEN_BASELINES.md`
- `docs/releases/staging-exceptions/2026-10-09-dashboard-openai-fallback-2be66a0.md`

No Instagram, WhatsApp, Web Chatbot, AI Guide, migration, tenant-data, fixture,
credential, model-selection, production configuration, customer prompt, or
channel-policy path is approved.

## Candidate purpose and blast radius

The candidate preserves Vertex as primary and OpenAI `gpt-4o-mini` as the
secondary provider for eligible Dashboard Knowledge generation. It adds an
explicit one-object JSON instruction and safe allowlisted OpenAI rejection
diagnostics.

Static caller review at `2026-10-09T00:45:22+04:00` found
`createKnowledgeGenerationProvider` imported only by `app.js` and
`routes/knowledgeIntelligenceRoutes.js`. The `app.js` call sites bootstrap the
Knowledge processing/recommendation workers; the route call sites serve
Knowledge Intelligence operations. No Instagram, WhatsApp, Web Chatbot, or AI
Guide runtime imports this provider directly. The candidate diff does not
modify customer-channel runtime files. Shared platform resilience behavior was
also exercised through the focused provider suite described below.

## Known pre-existing red failures

The cumulative gate must remain reported as `FAIL`. The only potentially
excepted failures are the exact test names below:

1. `FIRST CONTACT: Obvious business, personal, or ambiguous first DM is held silent until operator decision`
2. `AI_ONLY selection immediately answers pending customer message and prevents double replies`

They are located in `test/channelAiActivationPolicy.test.js`. They must not be
edited, skipped, filtered, renamed, reclassified, or described as GREEN. The
exception is invalid unless fresh equivalent base and candidate runs reproduce
exactly these two failures and no others.

## Mandatory fresh evidence before release approval

- [x] Record `git status --short`, branch, worktree, candidate hash, base hash,
      and current `origin/staging` hash.
- [x] Verify `origin/staging` still equals the recorded base or document and
      re-review any advancement; silent reuse of this record is forbidden.
- [x] Run `git diff --name-status <base>...<candidate>` and confirm the exact
      four-path application allowlist above.
- [x] After committing these governance documents, verify
      `git diff --name-status <candidate>...<release-head>` contains exactly the
      three governance paths above and no application, test, runner, prompt,
      fixture, migration, or configuration path.
- [x] Verify `git diff --name-status <base>...<release-head>` is exactly the
      four application paths plus the three governance paths recorded here.
- [x] Run `git diff --check <base>...<candidate>`.
- [ ] Run the unchanged `npm run test:fresh-tenant-golden-path` against an
      isolated database at the base commit. Record timestamp, exit code,
      failing stage, exact failures, and artifact/log reference.
- [ ] Run the same unchanged command in an equivalent isolated database at the
      candidate commit. Record the same fields and prove the failure set is
      identical to the base.
- [x] Run the focused Dashboard provider and recommendation lifecycle suites;
      require zero failures and zero newly skipped tests.
- [x] Run applicable tenant-isolation, security, authorization, CRM boundary,
      provider resilience, and Knowledge lifecycle suites; require zero
      failures and zero newly skipped tests.
- [x] Confirm the completed focused test processes terminate naturally. Forced termination is
      not passing evidence.
- [x] Confirm no protected customer-channel implementation, test, prompt,
      fixture, or policy changed.
- [x] Perform and record the shared-provider indirect-impact review, including
      caller inventory and regression commands.
- [x] Record safe staging observability checks and rollback detection signals.
- [ ] Obtain explicit human approval for this exact completed record, exact
      candidate, and one staging deployment.

Historical reports that 94 focused tests passed and that the cumulative gate
failed on the two tests above are context only. They are not fresh release
evidence and do not satisfy this checklist.

## Required evidence table

| Evidence | Command / reference | Timestamp | Exit code | Result |
| --- | --- | --- | ---: | --- |
| Repository identity | `git status --short`; `git branch --show-current`; `git rev-parse HEAD b0a7b13 2be66a0 origin/staging` | `2026-10-09T00:45:22+04:00` | 0 | Branch `codex/dashboard-ai-provider-failover`; clean before evidence amendment; `origin/staging` exactly `b0a7b13d6d12348c5508fef8aa1fe7718e3bcd9a` |
| Strict candidate diff | `git diff --name-status b0a7b13...2be66a0`; `git diff --check b0a7b13...2be66a0` | `2026-10-09T00:45:22+04:00` | 0 | Exactly the four allowlisted application/test paths; whitespace check clean |
| Governance-only release HEAD | `git show --name-status 1198ee7`; candidate-to-HEAD and base-to-HEAD name-status checks | `2026-10-09T00:45:22+04:00` | 0 | `1198ee7` contained exactly the three governance paths; base-to-HEAD contained exactly seven allowlisted paths |
| Base Golden Path | `npm.cmd run test:fresh-tenant-golden-path` in detached base worktree | `2026-10-09T00:35:41+04:00` | 1 | **FAIL / INVALID FOR COMPARISON** at `MIGRATIONS`: PostgreSQL `42704`, type `vector` missing; log SHA-256 `70FC0F0BAC19798D683669FB04AFB75BF8CC12B6D3C8FDC53CEACC754628BA58` |
| Candidate Golden Path | same unchanged command in detached candidate worktree | `2026-10-09T00:45:01+04:00` | 1 | **FAIL / INVALID FOR COMPARISON** at `MIGRATIONS`: PostgreSQL `0A000`, `vector.control` unavailable; log SHA-256 `000B86CD74A9D4E79901E09F8B44E4A378828660CF801F058073B2ADBAAEB2C4` |
| Focused Dashboard suites | `node --test tests/knowledge-generation-provider.test.js tests/knowledge-assistant-lifecycle.test.js tests/knowledge-assistant-generation-response-contract.test.js tests/knowledge-assistant-recommendation-job.test.js tests/shared-ai-provider-failover.test.js tests/dashboard-ai-provider-policy.test.js` | `2026-10-09T00:42:51+04:00` | 0 | 68 tests: 68 pass, 0 fail, 0 skipped; log SHA-256 `49175777B50B0B570E291F515296C923B33EA1A6CF3B2ABFE1FBA70058AF3996` |
| Tenant/security suites | `node --test` with CRM boundary/permissions, workflow security, push security, conversation permissions, assistant model policy, multi-tenant permanence, tenant grounding, Web Chat access suites | `2026-10-09T00:43:04+04:00` | 0 | 42 tests: 42 pass, 0 fail, 0 skipped; log SHA-256 `DD984604200D36BEEE2637E65146FB8C445FA02F06E3A220B42608581CCF413F` |
| Historical Instagram failure comparison | `node --test test/channelAiActivationPolicy.test.js` independently at base and candidate | base `2026-10-09T00:43:22+04:00`; candidate `2026-10-09T00:43:23+04:00` | 1 / 1 | Both: 13 tests, 11 pass, the same exact 2 fail, 0 skipped. This confirms that file only; it does **not** substitute for Golden Path equivalence. Base/candidate log SHA-256: `BB827AA3983707AA46867CC2E051CD6637AEED0EA2B278F563C55B0004F2A47D` / `534D86631A163EBB40AF7466AEB4C153D9F7AD90D2A48DA09549D138220D1A7D` |
| Protected-channel regression | same 12-file Instagram/WhatsApp/Web Chatbot/AI Guide command independently at base and candidate | base `2026-10-09T00:44:00+04:00`; candidate `2026-10-09T00:43:37+04:00` | 1 / 1 | Both: 84 tests, 82 pass, same 2 fail, 0 skipped: canonical SamChe master policy preservation; signed Web Chat ACTIVE persona resolution. No candidate-only failure, but the suite is **FAIL**, not GREEN. Base/candidate log SHA-256: `1A81BBD0B3364912E48B826F1430F55B85ABE6F1AA908BC30731798B6ED18376` / `81F59EF61BD8BCC2752C77A632908EF406DB6B58CAEF66345C0B858DDF42E765` |
| Shared-provider impact | caller inventory with `rg`; focused provider/failover suite; strict diff review | `2026-10-09T00:42:51+04:00`–`00:45:22+04:00` | 0 | Direct runtime consumers limited to Dashboard/Knowledge bootstrap and Knowledge Intelligence routes; shared circuit/failover behavior passed; no protected-channel path changed |
| Natural termination | process exit and timestamps from all focused runs | `2026-10-09T00:42:52+04:00`–`00:44:01+04:00` | — | All focused processes terminated naturally; none was force-killed |

## Golden Path environment incident and invalid evidence

The required equivalent clean base/candidate Golden Path comparison is **not
complete** and must not be inferred from the focused comparisons above.

An initial base run at `2026-10-09T00:30:11+04:00` completed with exit `1` and
reported 2,250 tests: 2,219 pass, 30 fail, 1 skipped (log SHA-256
`C67F7AFAF2001000A0F564029CEE7E590B0E9181CFC4C44E8197D2B29F42FAA2`).
It is retained only as a diagnostic because the reused test database contained
residual rows and therefore was not an acceptable clean isolated baseline. It
must not be represented as the base failure set for this exception.

During preparation of a clean run, the isolated local database named exactly
`workflow_test` was safety-checked and its `public` schema was recreated. This
exposed an inconsistent host prerequisite: the database had stale `vector`
extension metadata/type state while the PostgreSQL 16 installation had no
`vector.control` or pgvector binary files. A repair attempt removed the stale
extension registration, after which recreation failed because the server-side
package is absent. No staging, production, customer database, credential, or
Render configuration was accessed or changed.

Local filesystem searches found no recoverable pgvector package. The official
Windows recovery path requires Microsoft Visual Studio C++ Build Tools and a
source build. The attempted Build Tools installation was cancelled by Windows
installer exit code `1602`; therefore the local test prerequisite remains
unrestored. Base and candidate subsequently stop at migration 016 before the
test corpus executes. These migration failures prove only the environment
blocker and are not comparable release evidence.

Required recovery before reconsideration:

1. Install pgvector for the local PostgreSQL 16 server from the official
   pgvector source using the documented Windows toolchain.
2. Recreate/verify the `vector` extension in `workflow_test` and prove a basic
   vector operation works.
3. Provision two clean, equivalent isolated test databases (or reset between
   revisions with a documented extension-preserving procedure).
4. Re-run the unchanged Golden Path on base and candidate and record complete
   test counts and exact failure sets.
5. Require the candidate to introduce no additional failure. The exception
   remains invalid unless the only Golden Path failures are the two explicitly
   allowlisted Instagram failures.

## Protected-channel regression details

The separate historical Instagram policy comparison reproduced the two
allowlisted failures on both revisions:

1. `FIRST CONTACT: Obvious business, personal, or ambiguous first DM is held silent until operator decision`
2. `AI_ONLY selection immediately answers pending customer message and prevents double replies`

The broader protected-channel selection also reproduced two identical failures
at base and candidate:

1. `preserves the recovered canonical SamChe master policy byte-for-byte and beyond 6000 characters`
2. `signed Web Chat resolves opaque identity and ACTIVE tenant persona before provider invocation`

Because those broader checks fail, they are recorded as regression comparison
only and are never described as GREEN. No channel implementation, prompt,
test, fixture, or configuration file was edited.

## Staging acceptance and rollback

After separately approved deployment, human acceptance must verify the
Dashboard recommendation path with Vertex unavailable and OpenAI fallback,
including valid JSON output, review-only lifecycle, tenant grounding, and no
duplicate artifact. Protected Instagram, WhatsApp, Web Chatbot, and AI Guide
smoke checks must remain unchanged.

Rollback triggers include any new test failure, provider-contract regression,
tenant/security/authorization anomaly, customer-channel behavior change,
invalid or ungrounded output, duplicate/stuck job, unexpected diff, or mismatch
between deployed and approved hashes.

Rollback procedure:

1. Stop further staging acceptance activity and record the trigger.
2. Confirm the deployed candidate hash.
3. Restore staging to `b0a7b13d6d12348c5508fef8aa1fe7718e3bcd9a`
   through the normal auditable deployment/Git procedure.
4. Do not force-push, reset shared history, or deploy production.
5. Verify the running staging hash and repeat the affected health checks.
6. Mark this exception closed as rolled back; a retry requires a new record and
   new human approval.

## Required final decision vocabulary

Until every checkbox is satisfied and final human approval is recorded:

```text
GOLDEN_PATH: FAIL
STAGING_RELEASE: HOLD
PRODUCTION_RELEASE: BLOCKED
PUSH: NO
DEPLOY: NO
```

If all requirements are later satisfied, only the staging line may become:

```text
STAGING_RELEASE: SCOPED_EXCEPTION_ELIGIBLE
```

`GOLDEN_PATH` remains `FAIL`, and production remains `BLOCKED` until the full
mandatory gate is genuinely GREEN.
