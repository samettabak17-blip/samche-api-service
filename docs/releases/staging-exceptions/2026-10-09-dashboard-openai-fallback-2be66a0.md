# Scoped Staging Exception Evidence — Dashboard OpenAI Fallback

## Decision state

- Governance design approval: **APPROVED**
- Evidence completeness: **COMPLETE — isolated PostgreSQL/pgvector comparison recorded below**
- Staging release approval: **NOT YET GRANTED**
- Staging release decision: **HOLD**
- Production release decision: **BLOCKED — full GREEN required**
- Fresh Tenant Golden Path: **FAIL — never GREEN under this exception**
- Scoped exception eligibility: **SCOPED_EXCEPTION_ELIGIBLE — exact complete baseline failure-set equivalence proven; final human staging approval still required**

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
- Governance-only release HEAD tested:
  `c2b4ce56f4d8d5ccf28ba35f9c9b96d0349c1d9c`
- Final amended governance/release HEAD: **record in the external final report and
  final human approval** (a commit cannot contain its own hash)
- Staging deployment identifier: **PENDING**
- Rollback owner: **PENDING**
- Governance approval source: direct human approval in Codex task
  `01a11d1f-d42b-71b3-a1bc-f47ec9b324f7` on `2026-10-09`
- Full failure-set equivalence amendment approval source: direct human approval
  in this Codex task on `2026-10-09`
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

## Immutable pre-existing red failure set

The cumulative gate must remain reported as `FAIL`. The only potentially
excepted failures are the complete 31-entry normalized failure-identity set
recorded under `Restored isolated Golden Path environment` below. That full base
set is the immutable allowlist for this exact one-time staging release only.
The exception is invalid if candidate and base do not reproduce that set
exactly, if the candidate introduces any additional skip, or if any failure is
edited, skipped, filtered, renamed, reclassified, or described as GREEN.

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
- [x] Run the unchanged `npm run test:fresh-tenant-golden-path` against an
      isolated database at the base commit. Record timestamp, exit code,
      failing stage, exact failures, and artifact/log reference.
- [x] Run the same unchanged command in an equivalent isolated database at the
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
| Governance-only release HEAD | `git show --name-status c2b4ce5`; candidate-to-HEAD and base-to-HEAD name-status checks | `2026-10-09T01:38:29+04:00` | 0 | `c2b4ce5` contains exactly the three governance paths; base-to-HEAD contains exactly the four approved Dashboard paths plus those three governance paths |
| Container preflight and database verification | `Get-Command docker,podman,nerdctl`; `Get-Service *docker*`; processor virtualization query; PostgreSQL/version/extension/distance queries against both disposable databases | `2026-10-09T01:40:18.4398907+04:00`–`01:40:20.4629068+04:00` | 0 | No container CLI or Docker service; firmware virtualization false. Both disposable servers returned PostgreSQL `16.15`, pgvector `0.8.6`, vector distance `1`. Log `environment-verification.log`, SHA-256 `EDE472D2A47551FD9253D9351DABD4AC36D2682C9BBE050D9FCB720C160F1B2C` |
| Disposable database runtime | Micromamba environment creation with `postgresql=16 pgvector=0.8.6`; two `initdb` clusters; `CREATE EXTENSION vector`; version and distance queries | `2026-10-09T01:21:00+04:00`–`01:26:20+04:00` | 0 | PostgreSQL `16.15`, pgvector `0.8.6`; separate clusters bound to `127.0.0.1:55432` and `127.0.0.1:55433`; vector distance smoke query returned `1` in both databases |
| Base Golden Path | `npm.cmd run test:fresh-tenant-golden-path` in detached `b0a7b13` worktree, with only `TEST_DATABASE_URL` pointing to the base disposable database and `DATABASE_SSL=false` | `2026-10-09T01:26:34.4240464+04:00`–`01:30:22.5089503+04:00` | 1 | **FAIL** at `TASKS_1_TO_7_AND_FRESH_TENANT_TESTS`: 2,250 tests; 2,217 pass, 31 fail, 2 skipped. Log `base-golden-path-disposable-pgvector.log`, SHA-256 `FA32D013483A087A41AA5DF967E21652F34C95828B02DFB5525124CF75681BE2` |
| Candidate Golden Path | same unchanged command in detached `c2b4ce5` worktree, with only `TEST_DATABASE_URL` pointing to the candidate disposable database and `DATABASE_SSL=false` | `2026-10-09T01:30:34.9264325+04:00`–`01:34:53.9969899+04:00` | 1 | **FAIL** at `TASKS_1_TO_7_AND_FRESH_TENANT_TESTS`: 2,253 tests; 2,220 pass, 31 fail, 2 skipped. The three candidate-added tests pass; exact 31-test failure set equals base. Log `candidate-c2b4ce5-golden-path-disposable-pgvector.log`, SHA-256 `78F5CA1C3C98EACBAFFFB65C2CE345938B610C8B4FDD21368F91D7DA0FF5C22D` |
| Focused Dashboard suites | `node --test tests/knowledge-generation-provider.test.js tests/knowledge-assistant-lifecycle.test.js tests/knowledge-assistant-generation-response-contract.test.js tests/knowledge-assistant-recommendation-job.test.js tests/shared-ai-provider-failover.test.js tests/dashboard-ai-provider-policy.test.js` | `2026-10-09T01:37:07.9595401+04:00`–`01:37:09.7866152+04:00` | 0 | 68 tests: 68 pass, 0 fail, 0 skipped; log SHA-256 `30B0D464E0A5EDE2D7A21FA6C3AC10B439AF41E9D3FE105D90FB8CB3796DC2AC` |
| Tenant/security suites | `node --test` with CRM boundary/permissions, workflow security, push security, conversation permissions, assistant model policy, multi-tenant permanence, tenant grounding, Web Chat access suites | `2026-10-09T01:37:06.3584492+04:00`–`01:37:07.7874592+04:00` | 0 | 42 tests: 42 pass, 0 fail, 0 skipped; log SHA-256 `DF1365865AF350E971A2964C9EF99572B183DFB5F8996773EE4D76F89D242E9D` |
| Historical Instagram failure comparison | `node --test test/channelAiActivationPolicy.test.js` independently at base and candidate | base `2026-10-09T00:43:22+04:00`; candidate `2026-10-09T00:43:23+04:00` | 1 / 1 | Both: 13 tests, 11 pass, the same exact 2 fail, 0 skipped. This confirms that file only; it does **not** substitute for Golden Path equivalence. Base/candidate log SHA-256: `BB827AA3983707AA46867CC2E051CD6637AEED0EA2B278F563C55B0004F2A47D` / `534D86631A163EBB40AF7466AEB4C153D9F7AD90D2A48DA09549D138220D1A7D` |
| Protected-channel regression | same unchanged 12-file Instagram/WhatsApp/Web Chatbot/AI Guide command independently at base and candidate | base `2026-10-09T01:37:08.5246598+04:00`–`01:37:09.5940315+04:00`; candidate `2026-10-09T01:37:07.1054161+04:00`–`01:37:08.5383615+04:00` | 1 / 1 | Both: 84 tests, 82 pass, same 2 fail, 0 skipped: canonical SamChe master policy preservation; signed Web Chat ACTIVE persona resolution. No candidate-only failure, but the suite is **FAIL**, not GREEN. Base/candidate log SHA-256: `09317465BB9B2D9A031F3CF3F1F0C1042DBC3D9B1F1CB123BA944469C9D91E4D` / `F9258D398050E40C410928C992BCBD36CFEB02B0A42646A3AF9C7D1BAAC2BBE7` |
| Shared-provider impact | caller inventory with `rg`; focused provider/failover suite; strict diff review | `2026-10-09T00:42:51+04:00`–`00:45:22+04:00` | 0 | Direct runtime consumers limited to Dashboard/Knowledge bootstrap and Knowledge Intelligence routes; shared circuit/failover behavior passed; no protected-channel path changed |
| Natural termination | process exit and timestamps from Golden Path and focused runs | `2026-10-09T01:26:34.4240464+04:00`–`01:37:09.7866152+04:00` | — | All test processes terminated naturally; none was force-killed |
| Disposable database shutdown | `pg_ctl -D <base-or-candidate-data> -m fast -w stop`; `pg_isready` on ports `55432` and `55433` | `2026-10-09T01:41:10.1239244+04:00`–`01:41:14.9188423+04:00` | 0 | Both servers stopped cleanly; both ports subsequently returned no response. Log `database-shutdown.log`, SHA-256 `FC35A2DEAC725E80A84FDA63F1242971FD51D46FBA9F781E654FDE340DC47BC8` |

## Restored isolated Golden Path environment

Docker was not available in this Windows session: no Docker, Podman, or
Nerdctl command/service/Desktop installation was present; no WSL distribution
was installed; and firmware virtualization support was reported disabled. No
Windows C++ build toolchain was installed.

The approved disposable alternative used a user-scoped Micromamba `2.9.0`
environment under the task evidence directory. It resolved PostgreSQL `16.15`
and pgvector `0.8.6` from conda-forge. The exact provisioning sequence was:

```text
winget.exe install --id Mamba.Micromamba --exact --scope user --silent
micromamba create -y -p <evidence>/pg16-pgvector-env -c conda-forge postgresql=16 pgvector=0.8.6
initdb -D <evidence>/pg-base-data --username=golden --auth=trust --encoding=UTF8 --locale=C
initdb -D <evidence>/pg-candidate-data --username=golden --auth=trust --encoding=UTF8 --locale=C
pg_ctl -D <evidence>/pg-base-data -o "-h 127.0.0.1 -p 55432" -l <evidence>/pg-base-server.log start
pg_ctl -D <evidence>/pg-candidate-data -o "-h 127.0.0.1 -p 55433" -l <evidence>/pg-candidate-server.log start
createdb -h 127.0.0.1 -p 55432 -U golden golden_path_testing_base
createdb -h 127.0.0.1 -p 55433 -U golden golden_path_testing_candidate
psql <each disposable database> -c "CREATE EXTENSION vector"
psql <each disposable database> -c "SELECT version(), extversion FROM pg_extension WHERE extname='vector'"
psql <each disposable database> -c "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector"
```

Both servers listened only on loopback, used separate data directories and
separate clean databases, and shared the same package binaries and settings.
Neither database existed before this evidence run. No development, staging,
production, customer, Render, or other external database was accessed.

Environment-equivalence controls:

- unchanged runner SHA-256 at both revisions:
  `585BD9E646EB8A50490421BE507CA1862B4EEC445BCC7251673DA9262C3EEACC`;
- unchanged database safety helper SHA-256:
  `69728BA1CE9DE12CEC24CA22BC0C5CE52BD538B7D9F099FD02DB1EBC4B47D51B`;
- same root lockfile SHA-256:
  `DD25452E291A5101C60F4C4B7425BF0798C466B0B7EFD84A97643B4CB88D5C83`;
- same installed dependency tree was exposed read-only to both detached
  worktrees;
- only the disposable `TEST_DATABASE_URL` port/database differed; both used
  `DATABASE_SSL=false`;
- the exact unchanged command in both worktrees was
  `npm.cmd run test:fresh-tenant-golden-path`.

The candidate has three more passing tests than base because its approved test
diff adds coverage. The complete normalized failure records (source and test
name) are identical across base and candidate. They are:

1. `test/channelAiActivationPolicy.test.js` — `FIRST CONTACT: Obvious business, personal, or ambiguous first DM is held silent until operator decision`
2. `test/channelAiActivationPolicy.test.js` — `AI_ONLY selection immediately answers pending customer message and prevents double replies`
3. `test/guideAcceptanceTask7L.test.js` — `Task 7L2: AI Guide runtime context contract provides knowledge chunks array and model metadata`
4. `test/instagramBehaviorCorrection.test.js` — `TEST F: Authoritative Main policy SHA-256 matches exact required hash`
5. `test/instagramDeliveryMemoryAndQualification.test.js` — `32. Generation Failure after typing_on: typing_off must be attempted without hanging`
6. `test/instagramDeliveryMemoryAndQualification.test.js` — `33. Generation Exception/Timeout: typing_off must be attempted`
7. `test/instagramWebhookAcceptance.test.js` — `21. ensureConversationCrmIdentity falls back to lowest position stage when is_default is missing`
8. `test/internalWhatsAppDeliveryObservability.test.js` — `PHASE 4.1 — Internal template HTTP 200 + wamid sets DISPATCH_ACCEPTED (not falsely DELIVERED)`
9. `test/internalWhatsAppDeliveryObservability.test.js` — `PHASE 4.8 & 4.9 & 4.10 — Dedupe, in-flight protection and supported retry`
10. `test/internalWhatsAppDeliveryObservability.test.js` — `PHASE 4.11 & 4.12 — Zero LLM calls and zero customer Instagram messages`
11. `test/internalWhatsAppDeliveryObservability.test.js` — `PHASE 4.14 — HTTP 400 from Meta persists sanitized failure details to internal_notification_deliveries`
12. `test/internalWhatsAppDeliveryObservability.test.js` — `PHASE 4.17 — sendSilentInternalWhatsAppLeadNotification dispatches to resolved Phone Number ID instead of WABA ID`
13. `test/migrationConstraintIdempotency.test.js` — `MIGRATION REGRESSION: Full migration run is idempotent and preserves all historical audit event types without code 23514`
14. `test/samcheInstagramAiOnlyOverride.test.js` — `4. AI_ONLY answers pending message exactly once (idempotent, no duplicates)`
15. `test/samcheKnowledgeMigrationRetrieval.test.js` — `SamChe Canonical Knowledge Sources: Verifies all 7 sources and hash integrity`
16. `test/samcheWhatsAppCandidateParity.test.js` — `Parity Scenario 4-6: Company Formation, Free Zone and Mainland`
17. `test/samcheWhatsAppCandidateParity.test.js` — `Parity Scenario 19-22: Instagram Natural Conversation & Transparency Policy`
18. `test/samcheWhatsAppCandidateParity.test.js` — `Baseline Integrity Check: Master policy canonical SHA-256 matches non-negotiable hash`
19. `test/task9CustomerInitiatedWhatsAppCta.test.js` — `17. Master policy hash is exactly c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58`
20. `test/task9FinalInstagramMainParity.test.js` — `X. Master policy file SHA-256 hash is byte-for-byte identical to c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58`
21. `test/task9InstagramInboxHistoryAndLeadQualification.test.js` — `TEST O — Authoritative SamChe Main Policy SHA-256 integrity check`
22. `test/whatsappAuthoritativePolicy.test.js` — `preserves the recovered canonical SamChe master policy byte-for-byte and beyond 6000 characters`
23. `test/whatsappDeliveryStatus.test.js` — `correlates delivered WhatsApp status only through the mapped phone number and external message ID`
24. `test/whatsappDeliveryStatus.test.js` — `does not mutate another tenant when no message matches the mapped provider identifier`
25. `test/whatsappDeliveryStatus.test.js` — `reconciles an early status webhook after the assistant wamid is committed`
26. `test/whatsappDeliveryStatus.test.js` — `reconciles an early FAILED voice status after the outbound transaction commit boundary`
27. `tests/guide-lifecycle-postgres.test.js` — `G. Historical managed slug collision, same-owner convergence, and Render deploy blocker reproduction (CASES 1-7)`
28. `tests/public-web-chat-runtime-integration.test.js` — `signed Web Chat resolves opaque identity and ACTIVE tenant persona before provider invocation`
29. `tests/web-chat-e2e-browser.test.js` — `REAL BROWSER E2E: Responsive Viewports (Desktop, Tablet, Mobile, Mobile Landscape)`
30. `tests/web-chat-e2e-browser.test.js` — `REAL BROWSER E2E: Adversarial Host CSS Isolation Fixture`
31. `tests/web-chat-productization.test.js` — `Authorization and scoping prevent cross-tenant Web Chat logo management`

This proves the exact complete baseline equivalence required by the amended
exception contract: candidate-only failures are zero, normalized failure
identities are identical, and both revisions report two skipped tests. The
candidate is therefore `SCOPED_EXCEPTION_ELIGIBLE` for the exact one-time
staging release, subject to separate final human approval of the final release
hash. No failure was skipped, renamed, reclassified, or called GREEN.

## Historical Golden Path environment incident (superseded)

The following failed attempts are retained for audit history only. They were
superseded by the valid disposable PostgreSQL/pgvector comparison above and
must not be used as release evidence.

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

Local filesystem searches found no recoverable pgvector package for that host
installation. The attempted Microsoft Visual Studio C++ Build Tools installer
was cancelled with Windows installer exit code `1602`. Base and candidate then
stopped at migration 016. Those migration failures prove only the former
environment blocker and are not comparable release evidence. The blocker was
later resolved without Windows C++ tooling by the two disposable conda-forge
clusters documented above.

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

For this completed evidence set, the binding decision is:

```text
EXCEPTION_ELIGIBILITY: SCOPED_EXCEPTION_ELIGIBLE
REASON: complete normalized base/candidate failure identities are exactly equal; candidate-only failures 0; additional candidate skips 0
READY_FOR_FINAL_STAGING_APPROVAL: YES
```

Final human approval cannot override or widen the immutable 31-entry technical
failure allowlist inside this record. Any release hash, diff, runner, test,
environment, failure identity, skip count, base, rollback target, staging
target, or evidence change invalidates eligibility and requires fresh evidence.

If all requirements are later satisfied, only the staging line may become:

```text
STAGING_RELEASE: SCOPED_EXCEPTION_ELIGIBLE
```

`GOLDEN_PATH` remains `FAIL`, and production remains `BLOCKED` until the full
mandatory gate is genuinely GREEN.
