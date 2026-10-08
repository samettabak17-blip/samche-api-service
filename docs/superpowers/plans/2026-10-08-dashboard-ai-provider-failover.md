# Dashboard AI Provider Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every compatible Dashboard AI operation through the existing shared Vertex-primary/OpenAI-secondary resilience architecture while preserving structured contracts, tenant isolation, durable review lifecycles, and all protected customer-channel behavior.

**Architecture:** Extend `shared-ai-provider-resilience.js` with one provider-neutral execution primitive and a provider/model/capability circuit registry. Dashboard policy supplies platform-owned flags, compatible models, and operation budgets; Knowledge, image extraction, and CRM adapters keep their current prompts, validators, persistence, and approval boundaries while delegating provider attempts to that shared primitive.

**Tech Stack:** Node.js ESM, built-in `node:test`, `@google/genai`, OpenAI Chat Completions, PostgreSQL, existing Knowledge durable jobs and generation-run telemetry.

**Spec:** `docs/superpowers/specs/2026-10-08-dashboard-ai-provider-failover-design.md`

## Global Constraints

- Vertex AI is primary and OpenAI is secondary whenever Dashboard failover is enabled.
- Existing WhatsApp, Instagram, Web Chatbot, AI Guide, Live Inbox, takeover, and return-to-AI behavior and prompts must remain unchanged.
- Provider/model/capability selection is platform-owned and is never tenant-configurable.
- No tenant IDs, customer names, per-tenant credentials, manual tenant repair, or customer-specific code may be introduced.
- Structured schemas, tenant grounding, RBAC, explicit review/approval, transactional idempotency, and migration 112 remain authoritative.
- Fallback applies only to classified provider-availability failures and verified compatible capabilities.
- Deterministic parsing, schema, validation, authorization, tenant configuration, and persistence failures never trigger fallback or provider retries.
- No migration or Dashboard UI change is planned. Discovery of a required migration or UI change is a stop condition requiring renewed review.
- Do not commit until every focused, PostgreSQL, protected regression, natural-exit, and Fresh Tenant Golden Path gate in Task 9 has passed.
- Do not push until the final task-scoped diff is clean, `origin/staging` has been refreshed and reconciled, and local verification has been rerun against that exact state.
- Do not deploy to production or declare physical GREEN.

## Resolved Planning Decisions

### Circuit isolation and tenant impact

`ProviderCircuitBreakerRegistry` owns breakers keyed by the exact normalized tuple
`provider:model:capability`. The key contains no tenant identifier.

- `VERTEX:gemini-3-flash-preview:STRUCTURED_TEXT` and
  `VERTEX:gemini-3-flash-preview:IMAGE_UNDERSTANDING_STRUCTURED` have separate
  primary circuits.
- OpenAI secondary attempts use equivalent independent keys, such as
  `OPENAI:gpt-4o-mini:STRUCTURED_TEXT`.
- Customer conversational runtime uses `CONVERSATIONAL_TEXT` or its existing
  multimodal capability, so Dashboard failures cannot open a customer-channel
  circuit.
- Circuits are intentionally shared across tenants because platform credentials
  and upstream availability are shared. A confirmed provider suspension should
  stop every tenant from repeatedly hitting the same unavailable platform
  boundary.
- Tenant input, grounding, schema, authorization, and persistence failures are
  excluded from breaker accounting, so one tenant cannot poison another
  tenant's provider access.
- Permission/authentication failures open the exact circuit immediately.
  Capacity, rate, network, timeout, and provider-internal failures use the
  existing bounded threshold and cooldown. Success closes only the exact key.

### Operation timeout budgets

All values are hard wall-clock budgets in milliseconds. The total budget owns
both attempts and cleanup; a provider double that ignores abort must still
settle at the attempt deadline.

| Operation | Capability | Vertex | OpenAI | Total |
| --- | --- | ---: | ---: | ---: |
| `BUSINESS_IDENTITY_ANALYSIS` | `STRUCTURED_TEXT` | 8,000 | 10,000 | 20,000 |
| `BUSINESS_PROFILE` | `STRUCTURED_TEXT` | 15,000 | 15,000 | 32,000 |
| `ASSISTANT_RECOMMENDATION` | `STRUCTURED_TEXT` | 12,000 | 15,000 | 30,000 |
| `ASSISTANT_CONFIGURATION` | `STRUCTURED_TEXT` | 40,000 | 45,000 | 90,000 |
| `IMAGE_SEMANTIC_CLASSIFICATION` | `STRUCTURED_TEXT` | 25,000 | 30,000 | 60,000 |
| `IMAGE_KNOWLEDGE_EXTRACTION` | `IMAGE_UNDERSTANDING_STRUCTURED` | 15,000 | 15,000 | 32,000 |
| `CRM_LEAD_QUALIFICATION` | `STRUCTURED_TEXT` | 12,000 | 15,000 | 30,000 |

The existing customer runtime retains its current 12,000 ms Vertex and 15,000
ms OpenAI budgets. A circuit-open primary consumes no artificial delay. A caller
cancellation terminates the operation without fallback.

### CRM interruption and recovery

CRM qualification remains deferred and does not gain a new job table or queue.
The current PostgreSQL advisory lock, checkpoint hash, unique
`(tenant_id, lead_id, analysis_hash)` constraint, and transaction remain the
authority.

- If the process stops before `BEGIN`, no state has changed.
- If it stops during the transaction, PostgreSQL rollback leaves the previous
  analysis authoritative.
- The next supported inbound trigger or explicit Dashboard rescore re-evaluates
  the persisted checkpoint and safely runs the missing analysis.
- A repeated force-rescore converges on the existing unique analysis row and
  cannot create a duplicate qualification artifact.
- The in-process `inFlight` set remains a local optimization only and is always
  cleared in `finally`.
- Deferred failures emit safe operation/correlation/classification telemetry;
  there is no persisted `PENDING` CRM state that can become stuck.

### Dashboard-only rollout and rollback

`DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED=true` enables automatic structured-text
failover for Dashboard operations. It defaults to `false`, preserving the
current single-provider Dashboard path until staging rollout is explicitly
enabled.

`DASHBOARD_AI_MULTIMODAL_FAILOVER_ENABLED=true` independently enables OpenAI
vision fallback for image Knowledge extraction after compatibility tests pass.
It also defaults to `false`.

Platform-owned model settings are:

- `DASHBOARD_AI_OPENAI_STRUCTURED_MODEL`, default `gpt-4o-mini`;
- `DASHBOARD_AI_OPENAI_VISION_MODEL`, default `gpt-4o-mini`.

When the main flag is enabled, Vertex is always primary for eligible Dashboard
generation even if the legacy `KNOWLEDGE_GENERATION_PROVIDER` override exists.
Disabling the flag is the rollback: the legacy Dashboard provider selection is
restored without code rollback, migration rollback, or artifact changes.
Neither flag is read by customer-channel routing. The staging deployment must
enable the main flag only after OpenAI credentials are verified; the multimodal
flag is enabled separately only after staging image capability evidence.

## Review Focus

- An already-aborted primary signal must never be reused for provider-local retry or OpenAI fallback; Task 1 and Task 3 pin natural settlement and signal freshness.
- A tenant-caused schema or grounding failure must not open a shared circuit or affect another tenant; Task 2 and Task 8 cover breaker accounting and isolation.
- OpenAI JSON that is syntactically valid but violates a domain schema must create no artifact and receive no durable retry; Task 4 and Task 7 cover this.
- A process interruption during CRM qualification must leave no partial analysis or duplicate activities when retried; Task 6 covers transaction rollback and convergence.
- Disabling Dashboard flags must not disable or alter existing customer-channel failover; Task 3 and Task 8 cover rollback and channel parity.

---

### Task 1: Fix the provider-local retry hang

**Files:**
- Modify: `tests/google-gemini-provider.test.js`
- Modify: `services/google-gemini-provider.js:294-319,395-443`
- Verify: `tests/knowledge-generation-provider.test.js:202-214`

**Interfaces:**
- Consumes: `normalizeRequestError(error, mode, model)` and the existing `GoogleGeminiProviderError` codes.
- Produces: provider-local default-model retry only for `GOOGLE_GEMINI_MODEL_UNAVAILABLE`; all other normalized errors are thrown after one Vertex request.

- [ ] **Step 1: Write failing retry-classification tests**

Add tests named:

```js
test('vertex permission failure does not retry another model', async () => {})
test('vertex timeout with an aborted signal does not retry another model', async () => {})
```

Each test records models called, asserts exactly one call, and asserts the
canonical permission or timeout code. Preserve the existing 404 test that
expects exactly one retry to the default model.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
node --test --test-name-pattern "vertex permission failure|vertex timeout with an aborted signal" tests/google-gemini-provider.test.js
```

Expected: FAIL because the current adapter attempts the default model for both
errors; the timeout case may fail to settle and must be stopped and recorded as
the reproduced defect.

- [ ] **Step 3: Restrict provider-local retry**

In `createGoogleGeminiProvider().generateContent`, normalize the first error
before deciding to retry. Retry with the default model only when:

```js
normalized.code === 'GOOGLE_GEMINI_MODEL_UNAVAILABLE'
  && activeModel !== defaultModel
  && !signal?.aborted
```

Throw the normalized first error for permission, authentication, timeout,
capacity, rate, network, invalid-request, or aborted-signal cases. Keep the
existing one bounded default-model retry for a genuine unavailable model.

- [ ] **Step 4: Verify GREEN and natural exit**

Run:

```powershell
node --test tests/google-gemini-provider.test.js
node --test --test-name-pattern "Gemini boundary telemetry records abort" tests/knowledge-generation-provider.test.js
```

Expected: all selected tests PASS, both commands print final summaries, return
exit code 0, and leave no running Node process.

### Task 2: Add the shared provider-neutral executor and isolated circuit registry

**Files:**
- Create: `tests/shared-ai-provider-failover.test.js`
- Modify: `services/shared-ai-provider-resilience.js:4-149,451-676`
- Modify: `tests/task9-canonical-shared-runtime.test.js`

**Interfaces:**
- Produces: `AI_PROVIDER_CAPABILITIES`, `providerCircuitKey({ provider, model, capability })`, `ProviderCircuitBreakerRegistry`, and `executeAiProviderFailover(options)`.
- Preserves: `ProviderCircuitBreaker`, `classifyAiProviderError`, `createSharedAiRuntime`, `canonicalSharedAiRuntime`, and existing response metadata.

- [ ] **Step 1: Write failing registry and executor tests**

Cover exact key isolation, shared cross-tenant platform behavior, immediate open
for permission/authentication, threshold-based transient opening, independent
OpenAI secondary circuits, Vertex success without OpenAI, eligible fallback,
caller cancellation, non-eligible validation errors, both-provider failure, and
fresh secondary signals.

- [ ] **Step 2: Run the focused shared tests and verify RED**

Run:

```powershell
node --test tests/shared-ai-provider-failover.test.js
```

Expected: FAIL because the new exports and executor do not exist.

- [ ] **Step 3: Implement the shared contracts**

Add these signatures:

```js
export function providerCircuitKey({ provider, model, capability })

export class ProviderCircuitBreakerRegistry {
  constructor({ createBreaker, logger } = {})
  get({ provider, model, capability })
  reset({ provider, model, capability } = {})
}

export async function executeAiProviderFailover({
  operation,
  capability,
  correlationId,
  primary,
  secondary,
  primaryProvider,
  primaryModel,
  secondaryProvider,
  secondaryModel,
  primaryTimeoutMs,
  secondaryTimeoutMs,
  totalTimeoutMs,
  circuitRegistry,
  failoverEnabled,
  signal,
  telemetry,
  logger,
})
```

`primary` and `secondary` receive fresh signals and return provider-native
results. The executor owns hard deadline races, timer/listener cleanup,
classification, breaker accounting, safe telemetry, and normalized success
metadata. It never parses application JSON or validates domain schemas.

- [ ] **Step 4: Delegate the existing conversational runtime without changing its contract**

Refactor `generateAiResponse` to use `executeAiProviderFailover` with the existing
request builders, models, timeouts, and response shape. Preserve all current
channel strings and returned fields. Map its existing injected
`circuitBreaker` to the conversational circuit key for backward-compatible
tests.

- [ ] **Step 5: Verify shared and protected runtime GREEN**

Run:

```powershell
node --test tests/shared-ai-provider-failover.test.js
node --test tests/task9-canonical-shared-runtime.test.js
node --test tests/tenant-fact-authority.test.js tests/shared-channel-runtime-contract.test.js
```

Expected: PASS with natural exit; existing WhatsApp, Instagram, Web/Guide,
multimodal, factual-authority, and failover assertions remain unchanged.

### Task 3: Add Dashboard-only operation policy and rollback flags

**Files:**
- Create: `services/dashboard-ai-provider-policy.js`
- Create: `tests/dashboard-ai-provider-policy.test.js`
- Modify: `app.js:1054-1109`
- Modify: `tests/semantic-worker-bootstrap.test.js`

**Interfaces:**
- Produces: `DASHBOARD_AI_OPERATIONS` and `getDashboardAiProviderPolicy(operation, env)`.
- Consumes: `AI_PROVIDER_CAPABILITIES` from the shared resilience module.

- [ ] **Step 1: Write failing policy tests**

Assert the exact operation table and budgets in this plan, strict boolean flag
parsing, platform-owned model defaults, structured and multimodal flag
independence, fail-closed unknown operations, and legacy single-provider
behavior when the main flag is false.

- [ ] **Step 2: Run policy tests and verify RED**

Run:

```powershell
node --test tests/dashboard-ai-provider-policy.test.js
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement immutable policy resolution**

Implement:

```js
export function getDashboardAiProviderPolicy(operation, env = process.env)
```

Return capability, primary/fallback models, three timeout budgets, and
`failoverEnabled`. Reject unknown operations and invalid model strings without
reading tenant data.

- [ ] **Step 4: Wire Dashboard worker enablement only**

Allow the Knowledge semantic worker to start when the legacy primary is
available or when Dashboard failover is enabled with OpenAI configured. Do not
change the initialization or flags used by customer channels.

- [ ] **Step 5: Verify policy and startup GREEN**

Run:

```powershell
node --test tests/dashboard-ai-provider-policy.test.js tests/semantic-worker-bootstrap.test.js
```

Expected: PASS and natural exit.

### Task 4: Route structured Knowledge operations through shared failover

**Files:**
- Modify: `services/knowledge-generation-provider.js`
- Modify: `tests/knowledge-generation-provider.test.js`
- Modify: `services/knowledge-generation-persistence.js:4-11,166-198`
- Modify: `tests/knowledge-generation-persistence.test.js`
- Modify: `services/knowledge-assistant-lifecycle.js:76-131`
- Modify: `services/knowledge-profile-lifecycle.js:345-405`

**Interfaces:**
- Consumes: `executeAiProviderFailover`, the shared circuit registry, and `getDashboardAiProviderPolicy`.
- Produces: unchanged Knowledge generation methods and validated output objects; adds safe failover telemetry events and actual provider/model metadata outside artifact payloads.

- [ ] **Step 1: Write failing structured failover tests**

Add deterministic provider-double tests for:

```js
test('Vertex success does not call OpenAI for Assistant Recommendation', async () => {})
test('suspended Vertex project falls back to OpenAI and preserves Recommendation V2', async () => {})
test('Vertex network and timeout failures use independent OpenAI attempts', async () => {})
test('open primary circuit selects OpenAI without a Vertex request', async () => {})
test('both structured providers unavailable returns bounded safe failure', async () => {})
test('invalid OpenAI output is terminal schema failure', async () => {})
test('Vertex schema failure does not invoke OpenAI', async () => {})
```

Assert telemetry contains only safe operation, correlation, provider/model,
classification, fallback state, and duration fields.

- [ ] **Step 2: Run the new Knowledge tests and verify RED**

Run:

```powershell
node --test --test-name-pattern "Vertex success|suspended Vertex|network and timeout|open primary circuit|both structured|invalid OpenAI|Vertex schema" tests/knowledge-generation-provider.test.js
```

Expected: FAIL because Knowledge still uses a single provider.

- [ ] **Step 3: Implement lazy shared provider attempts**

Keep `createKnowledgeGenerationProvider` and every public generation method.
Construct Vertex and OpenAI clients lazily inside their attempt closures so a
primary initialization/authentication failure can be classified and an OpenAI
fallback can proceed. Use native JSON request formats, then run the existing
`parseJson` and exact validator once on the selected provider response.

Map shared all-provider failure to
`KNOWLEDGE_GENERATION_PROVIDERS_UNAVAILABLE`. Preserve legacy
`KNOWLEDGE_GENERATION_PROVIDER` selection only when the Dashboard flag is off.
Keep provider/model policy identity stable for request fingerprints.

- [ ] **Step 4: Extend existing safe telemetry persistence**

Add bounded failover event names and fields to
`recordKnowledgeGenerationProviderTelemetry`; do not add a table or migration.
Update both lifecycle adapters to persist primary classification, fallback
attempt/success, actual provider/model, total duration, and terminal category
without prompts or outputs.

- [ ] **Step 5: Verify Knowledge provider and telemetry GREEN**

Run:

```powershell
node --test tests/knowledge-generation-provider.test.js tests/knowledge-generation-persistence.test.js
```

Expected: all tests PASS, final summaries print, and the processes exit
naturally.

### Task 5: Add compatible image Knowledge extraction fallback

**Files:**
- Modify: `services/image-knowledge-gemini-extractor.js`
- Modify: `services/knowledge-source-processing-service.js:130-205,245-340`
- Modify: `tests/image-knowledge-gemini-extractor.test.js`
- Modify: `tests/knowledge-source-processing-service.test.js`
- Modify: `tests/knowledge-image-provenance-postgres.test.js`

**Interfaces:**
- Preserves: `createGeminiImageKnowledgeExtractor` as a compatibility export and the canonical extraction result contract.
- Adds: `createImageKnowledgeExtractor(options)` using the shared `IMAGE_UNDERSTANDING_STRUCTURED` capability.

- [ ] **Step 1: Write failing multimodal capability and provenance tests**

Cover Vertex success, suspended Vertex followed by OpenAI vision JSON success,
multimodal flag disabled, fallback model/client without image capability,
invalid OpenAI JSON, bounded dimensions, same-tenant bytes only, and exact
`GEMINI_VISION` versus `OPENAI_VISION` extraction methods.

- [ ] **Step 2: Run image tests and verify RED**

Run:

```powershell
node --test tests/image-knowledge-gemini-extractor.test.js tests/knowledge-source-processing-service.test.js
```

Expected: new fallback/provenance cases FAIL.

- [ ] **Step 3: Implement shared multimodal execution**

Validate bytes, MIME, dimensions, source hash, and capability before provider
invocation. Build native Vertex inline-data and OpenAI image-content requests,
delegate attempts to the shared executor, and run the existing canonical
extraction validator on the selected output. Fail with an actionable safe
operation error when capability or fallback configuration is unavailable.

- [ ] **Step 4: Persist provider-accurate provenance without schema changes**

Keep downstream canonical segments unchanged and store the selected extraction
method in the existing bounded columns. Never label OpenAI output as
`GEMINI_VISION`.

- [ ] **Step 5: Verify image unit and PostgreSQL provenance GREEN**

Run:

```powershell
node --test tests/image-knowledge-gemini-extractor.test.js tests/knowledge-source-processing-service.test.js
node --test tests/knowledge-image-provenance-postgres.test.js
```

Expected: PASS and natural exit. If OpenAI image capability cannot be verified,
stop with `REQUIRED_CAPABILITY: IMAGE_UNDERSTANDING_STRUCTURED`; leave the
multimodal flag disabled and do not fabricate fallback output.

### Task 6: Route CRM qualification through shared structured failover

**Files:**
- Modify: `services/lead-qualification-runner.js`
- Modify: `services/lead-qualification-service.js:130-139`
- Modify: `services/lead-qualification-provider-policy.js`
- Modify: `tests/lead-qualification-service.test.js`
- Create: `tests/lead-qualification-runner.test.js`

**Interfaces:**
- Produces: `invokeLeadQualificationModel(prompt, options)` returning `{ output, provider, model, fallbackUsed }`.
- Preserves: injected `invokeModel` callbacks that return a raw object and the existing persisted qualification schema.

- [ ] **Step 1: Write failing CRM failover and recovery tests**

Cover Vertex success, suspended Vertex to OpenAI, invalid OpenAI output,
provider-accurate analysis provenance, no cross-tenant reads, advisory-lock
contention, interruption before commit followed by successful rerun, repeated
force-rescore convergence, and `inFlight` cleanup after error.

- [ ] **Step 2: Run CRM tests and verify RED**

Run:

```powershell
node --test tests/lead-qualification-service.test.js tests/lead-qualification-runner.test.js
```

Expected: new failover and interruption cases FAIL.

- [ ] **Step 3: Implement the shared CRM adapter**

Use the `CRM_LEAD_QUALIFICATION` operation policy and shared structured
executor. Preserve the existing prompt and normalized evidence validation.
Allow `qualifyConversation` to consume the result envelope while retaining raw
object compatibility for existing tests. Persist the actual selected
provider/model.

- [ ] **Step 4: Preserve minimal interruption semantics**

Do not add a CRM job table, retry timer, or background queue. Keep the existing
transaction, advisory lock, checkpoint hash, unique upsert, inbound triggers,
and explicit rescore recovery described above. Log only safe failure category,
operation, bounded correlation, and duration.

- [ ] **Step 5: Verify CRM GREEN**

Run:

```powershell
node --test tests/lead-qualification-service.test.js tests/lead-qualification-runner.test.js
```

Expected: PASS and natural exit.

### Task 7: Make durable retry and terminal job semantics explicit

**Files:**
- Modify: `services/knowledge-semantic-generation-job-service.js:578-739`
- Modify: `tests/knowledge-assistant-recommendation-job.test.js`
- Modify: `tests/knowledge-assistant-configuration-job.test.js`
- Modify: `tests/knowledge-business-profile-generation-job.test.js`
- Modify: `tests/knowledge-semantic-generation-job.test.js`
- Modify: `tests/knowledge-assistant-configuration-job-postgres.test.js`

**Interfaces:**
- Produces: one internal `isRetryableKnowledgeProviderError(error, operation)` allowlist used by all four Knowledge generation job processors.
- Consumes: `KNOWLEDGE_GENERATION_PROVIDERS_UNAVAILABLE` and canonical timeout/provider classifications from Task 4.

- [ ] **Step 1: Write failing retry-matrix tests**

For every job type, assert bounded retry only after all providers are
unavailable or an explicitly retryable transport failure. Assert terminal
`FAILED` for parsing, schema, grounding, authorization, stale input,
persistence, and unsupported capability errors. Assert every failure clears
leases and no failure path inserts or activates an artifact.

- [ ] **Step 2: Run job tests and verify RED**

Run:

```powershell
node --test tests/knowledge-assistant-recommendation-job.test.js tests/knowledge-assistant-configuration-job.test.js tests/knowledge-business-profile-generation-job.test.js tests/knowledge-semantic-generation-job.test.js
```

Expected: recommendation and image job retry assertions FAIL because their
current policies retry all errors.

- [ ] **Step 3: Implement one bounded retry classification**

Replace broad per-job checks with the shared internal allowlist. Retain each
job type's existing maximum attempts and backoff unless a test proves it is
unbounded. Add safe terminal job telemetry containing operation, opaque job ID,
status, attempts, total duration when available, and terminal category.

- [ ] **Step 4: Verify unit and PostgreSQL job convergence GREEN**

Run:

```powershell
node --test tests/knowledge-assistant-recommendation-job.test.js tests/knowledge-assistant-configuration-job.test.js tests/knowledge-business-profile-generation-job.test.js tests/knowledge-semantic-generation-job.test.js
node --test tests/knowledge-assistant-configuration-job-postgres.test.js
```

Expected: PASS, no duplicate completion, and natural exit.

### Task 8: Prove lifecycle, concurrency, tenant isolation, and channel non-regression

**Files:**
- Modify only if a missing acceptance assertion is demonstrated:
  `tests/fresh-tenant-complete-onboarding-e2e.test.js`
- Modify only if a missing PostgreSQL assertion is demonstrated:
  `test/knowledgeAssistantGenerationPostgres.test.js`
- Modify only if a missing PostgreSQL assertion is demonstrated:
  `test/knowledgeGenerationPostgres.test.js`
- Read/verify unchanged: `migrations/112_reconcile_rejected_recommendation_runs.sql`
- Read/verify unchanged: customer-channel regression tests listed below.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: acceptance evidence for rejected-history preservation, concurrent convergence, two-tenant isolation, explicit approvals, and unchanged channel routing.

- [ ] **Step 1: Add only missing end-to-end assertions**

Tests must prove:

- active Business Profile is required before Recommendation generation;
- suspended Vertex plus valid OpenAI produces one `NEEDS_REVIEW` recommendation;
- a previously `REJECTED` recommendation remains rejected;
- concurrent requests converge without duplicate-key failure;
- Configuration remains `NEEDS_REVIEW` until explicit approval and activation;
- invalid fallback output activates nothing;
- two tenants cannot reuse each other's profile, recommendation,
  configuration, job, or telemetry;
- migration 112 remains byte-for-byte unchanged by the implementation.

- [ ] **Step 2: Run focused lifecycle and real-PostgreSQL tests**

Run:

```powershell
node --test tests/fresh-tenant-complete-onboarding-e2e.test.js tests/knowledge-assistant-lifecycle.test.js
node --test test/knowledgeAssistantGenerationPostgres.test.js test/knowledgeGenerationPostgres.test.js
```

Expected: PASS and natural exit. Missing disposable PostgreSQL configuration is
a reported blocker, not a skip-based pass.

- [ ] **Step 3: Run protected customer-channel regressions**

Run:

```powershell
node --test tests/task9-canonical-shared-runtime.test.js tests/tenant-fact-authority.test.js tests/shared-channel-runtime-contract.test.js
node --test tests/web-chat-canonical-runtime-turn.test.js test/publicGuideRuntime.test.js test/whatsappNativeTypingAndPacing.test.js test/samcheInstagramBehaviorParity.test.js
```

Expected: PASS with existing prompts, routing, grounding, typing, persona, and
provider parity unchanged.

### Task 9: Complete release gates, commit, push, and staging verification

**Files:**
- Review: every task-scoped modified file
- No production deployment files unless an existing staging flag mechanism explicitly requires a scoped value change and human review confirms it.

**Interfaces:**
- Consumes: all implementation and test results.
- Produces: one task-scoped staging commit, matching local/remote hashes, deployment evidence, and a non-physical acceptance report.

- [ ] **Step 1: Run syntax and complete focused natural-exit suites**

Run `node --check` for every modified `.js` file, then:

```powershell
node --test tests/google-gemini-provider.test.js tests/shared-ai-provider-failover.test.js tests/dashboard-ai-provider-policy.test.js tests/knowledge-generation-provider.test.js tests/knowledge-generation-persistence.test.js
node --test tests/image-knowledge-gemini-extractor.test.js tests/knowledge-source-processing-service.test.js tests/lead-qualification-service.test.js tests/lead-qualification-runner.test.js
node --test tests/knowledge-assistant-recommendation-job.test.js tests/knowledge-assistant-configuration-job.test.js tests/knowledge-business-profile-generation-job.test.js tests/knowledge-semantic-generation-job.test.js
```

Expected: every command prints a final summary, exits 0 naturally, and leaves no
Node process or referenced resource alive.

- [ ] **Step 2: Run real-PostgreSQL and cumulative release gates**

Run the PostgreSQL commands from Tasks 5, 7, and 8, then:

```powershell
npm run test:fresh-tenant-golden-path
```

Expected: PASS with no skipped database authority checks and natural exit.

- [ ] **Step 3: Verify final diff and protected files**

Run:

```powershell
git status --short
git diff --check
git diff -- migrations/112_reconcile_rejected_recommendation_runs.sql
git diff --stat
```

Expected: only approved task files are present, diff check is clean, and
migration 112 has no diff.

- [ ] **Step 4: Refresh and reconcile staging before committing**

Run:

```powershell
git fetch origin staging
git rev-parse HEAD
git rev-parse origin/staging
```

If `origin/staging` advanced, stop implementation, reconcile without reset,
force-push, or destructive rebase, then rerun every affected gate. Do not commit
until the reconciled state is GREEN.

- [ ] **Step 5: Create one task-scoped commit**

Stage only the approved files after all preceding gates pass and commit with:

```powershell
git commit -m "fix(ai): extend dashboard provider failover"
```

Do not include unrelated or pre-existing work.

- [ ] **Step 6: Push and verify exact remote convergence**

Run:

```powershell
git push origin staging
git fetch origin staging
git rev-parse HEAD
git rev-parse origin/staging
```

Expected: local `HEAD` equals `origin/staging`. Otherwise report
`TASK_COMPLETE = NO`.

- [ ] **Step 7: Verify staging rollout and rollback controls**

Confirm the running staging commit matches the pushed hash. Verify OpenAI
credentials without printing them, enable
`DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED=true`, and keep customer-channel
routing configuration unchanged. Enable the multimodal flag only after image
capability evidence. Use safe staging telemetry to confirm operation,
classification, fallback attempt, selected provider/model, duration, and
terminal status without prompts or tenant data.

If credentials, environment access, deployment status, or capability evidence
is unavailable, stop and report the exact blocker. Do not rotate credentials,
change billing, or create provider accounts.

- [ ] **Step 8: Hand off physical acceptance without declaring GREEN**

Report automated and staging evidence, unsupported capabilities, exact hashes,
and remaining blockers. Mark `READY_FOR_PHYSICAL_ACCEPTANCE: YES` only when
staging contains the fix and automated/staging gates pass. Dubai Horizon Real
Estate remains the human-only scenario for Dashboard recommendation,
Configuration approval/activation, public AI Guide, and Live Inbox acceptance.

## Stop Conditions

Stop immediately and report the exact blocker if:

- OpenAI platform credentials are missing or invalid;
- the configured OpenAI model does not support required JSON or image input;
- a required PostgreSQL or staging environment is unavailable;
- a protected GREEN prompt, routing contract, approval boundary, tenant scope,
  or migration 112 would need to change;
- implementation requires a new migration, CRM queue subsystem, Dashboard UI,
  tenant-specific repair, or provider account/configuration change outside the
  approved flags;
- the focused provider tests still fail to exit naturally after the retry fix;
- three implementation hypotheses fail or the root cause becomes unclear;
- `origin/staging` advances and cannot be reconciled without guessing or
  destructive Git operations;
- any protected WhatsApp, Instagram, Web Chatbot, AI Guide, Live Inbox,
  Knowledge, or Fresh Tenant regression fails.
