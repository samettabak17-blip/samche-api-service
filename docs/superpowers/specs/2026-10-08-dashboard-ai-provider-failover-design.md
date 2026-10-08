# Dashboard AI Provider Failover Design

## Goal

Extend the existing production-approved shared AI provider resilience
architecture to every compatible Dashboard AI operation. Vertex AI remains the
platform-controlled primary provider and OpenAI remains the independent
secondary provider. A supported Dashboard operation must continue through
OpenAI when Vertex is suspended or otherwise unavailable without weakening
tenant isolation, grounding, validation, review, approval, or artifact
lifecycle contracts.

This is a tenant-generic platform capability. Provider and model selection stay
under platform or Super Admin configuration. No tenant-owned provider keys,
tenant-selectable routing, customer names, tenant IDs, manual data repairs, or
source-code exceptions are introduced.

## Confirmed root cause

`knowledge-generation-provider.js` currently selects one configured provider.
In its default `GEMINI` mode it invokes the Google provider directly and maps
all non-timeout provider failures to `KNOWLEDGE_GENERATION_PROVIDER_FAILED`.
It never enters the circuit breaker or Vertex-to-OpenAI path implemented by
`shared-ai-provider-resilience.js`.

Business Profile, Assistant Recommendation, Assistant Configuration, and image
semantic classification therefore bypass the approved shared failover
architecture. The CRM lead qualification runner and image Knowledge extractor
also invoke Gemini directly. The confirmed suspended-project permission error
is normalized by the Google adapter as `GOOGLE_VERTEX_PERMISSION_DENIED`, but
the Dashboard paths do not use the shared classifier and cannot fall back.

The current Assistant Recommendation worker retries every thrown error up to
three attempts. This includes deterministic validation and persistence errors,
which cannot be repaired by repeating a provider call. The other Knowledge
workers already contain narrower retry policies but do not share one canonical
provider-failure taxonomy.

The focused provider/job baseline also failed the repository lifecycle gate:
assertions passed, but the Node process did not exit. Implementation must first
isolate the responsible test or timeout path and prove that focused provider
tests terminate naturally. Forced process termination cannot establish GREEN.

## Dashboard AI operation matrix

| Operation | Invocation path | Execution | Provider capability | Design outcome |
| --- | --- | --- | --- | --- |
| Business Identity source-scope analysis | Knowledge generation provider | Synchronous HTTP | Structured text | Shared Vertex-to-OpenAI failover |
| Business Profile generation | Durable Knowledge generation job | Worker | Structured text | Shared Vertex-to-OpenAI failover |
| Assistant Recommendation generation | Durable Knowledge generation job | Worker | Structured text | Shared Vertex-to-OpenAI failover |
| Assistant Configuration generation | Durable Knowledge generation job | Worker | Structured text | Shared Vertex-to-OpenAI failover |
| Image Knowledge semantic classification | Durable candidate generation job | Worker | Structured text over extracted segments | Shared Vertex-to-OpenAI failover |
| Image Knowledge text/role extraction | Direct Gemini multimodal extractor | Source-processing worker | Image understanding plus structured text | OpenAI vision fallback only after explicit capability validation and provider-accurate provenance |
| Document extraction | Local PDF/DOCX/text extraction | Source-processing worker | No generative provider | Unchanged |
| Knowledge indexing and retrieval preview | OpenAI embeddings | Worker and synchronous HTTP | Embeddings | Unchanged; this is already an independent OpenAI capability, not Vertex-primary generation |
| Knowledge Candidate review and approval | Domain and database services | Synchronous HTTP | No generative provider | Unchanged |
| Knowledge Gap review and candidate creation | Domain and database services | Synchronous HTTP | No generative provider | Unchanged |
| CRM lead qualification and Dashboard rescore | Direct Gemini structured qualification | Deferred execution | Structured text | Shared Vertex-to-OpenAI failover |
| CRM summaries displayed in lead detail | Persisted qualification analysis | Read-only HTTP | No provider during read | Unchanged |
| Conversation attention summary | Database aggregation | Read-only HTTP | No provider | Unchanged |
| Guide logo theme recommendation | Browser color extraction plus deterministic server validation | Synchronous HTTP | No provider | Unchanged |
| Manual Assistant setup | Dashboard form and domain services | Synchronous HTTP | No provider | Unchanged; generated assistance is covered by recommendation/configuration |
| WhatsApp, Instagram, Web Chatbot, and AI Guide responses | Existing shared runtime | Runtime | Conversational text/multimodal | Preserve behavior and approved prompts; regression coverage only |
| Visual AI image generation | Existing Google image provider and durable worker | Worker | Image generation/editing | Unchanged; no compatible fallback is assumed by this task |

Public sales chat and visitor-intent generation are not Dashboard operations.
They remain outside this change. Existing customer-facing channel routing is a
protected regression surface, not a target for redesign.

## Shared provider architecture

`shared-ai-provider-resilience.js` remains the single failover authority. It is
extended with a provider-neutral execution primitive used by both its existing
conversational method and new structured/multimodal adapters. There is no
Knowledge-specific circuit breaker, classifier, retry loop, or provider order.

The shared execution primitive accepts:

- operation and safe tenant-scoped correlation identifiers;
- declared capability;
- primary and secondary provider closures;
- operation-specific primary and secondary timeouts;
- the shared circuit breaker;
- the canonical provider-error classifier;
- an eligibility policy describing which provider failures may fail over;
- a safe telemetry sink.

It returns a normalized result containing output plus actual provider/model and
failover metadata. Raw SDK responses, credentials, prompts, customer messages,
and private payloads never cross the boundary or enter logs.

The existing `generateAiResponse` public contract and channel prompts remain
unchanged. Its current request construction and response mapping delegate to
the shared execution primitive without changing channel semantics. Structured
Dashboard adapters use the same primitive but retain their own request schemas,
validators, parsing, and domain errors.

## Provider order and capability policy

Vertex is attempted first when its circuit permits an attempt. OpenAI is
attempted second with a fresh client request and a fresh abort signal. An
aborted or expired Vertex signal is never reused for OpenAI.

Each Dashboard operation declares one of these capabilities:

- `STRUCTURED_TEXT`: supported for Business Identity, Business Profile,
  Recommendation, Configuration, image semantic classification, and CRM lead
  qualification. OpenAI must use a platform-approved model with JSON response
  support. Existing validators remain authoritative after either provider.
- `IMAGE_UNDERSTANDING_STRUCTURED`: supported for bounded PNG/JPEG Knowledge
  extraction only when the configured OpenAI fallback model accepts image
  inputs and JSON output. The canonical extraction validator remains
  authoritative.
- `EMBEDDING`: remains OpenAI-only under the existing embedding adapter. It is
  not routed through text-generation failover.
- `IMAGE_GENERATION`: unsupported by this Dashboard failover change. Visual AI
  retains its existing provider adapter and fails according to its protected
  capability contract.

If a secondary provider lacks the declared capability or required platform
configuration, the shared boundary returns a safe operation-level unsupported
or unavailable error. It never fabricates output, converts an unrelated model
response, or silently removes grounding or safety controls.

Fallback model configuration is platform-owned environment configuration.
Customer tenant APIs and Dashboard screens do not expose provider or model
selection. Defaults must be explicitly covered by capability tests rather than
assuming Gemini and OpenAI model names are interchangeable.

## Failure taxonomy and failover eligibility

The canonical shared classifier distinguishes these failover-eligible primary
provider failures:

- provider permission denied, including a suspended Google Cloud project;
- provider authentication failure;
- provider timeout or deadline exceeded;
- supported network, socket, DNS, or transport failure;
- provider capacity or internal-service unavailability;
- provider rate or quota exhaustion;
- configured provider model unavailable;
- primary circuit breaker open.

These failures do not trigger failover:

- invalid caller input;
- RBAC, tenant-scope, or tenant-grounding rejection;
- missing or conflicting Business Identity/provenance;
- unsupported capability;
- application or tenant configuration validation;
- malformed or schema-invalid provider output;
- deterministic JSON parsing failure after a provider returned content;
- domain validation, review, approval, or activation errors;
- persistence, uniqueness, transaction, or authorization failures;
- caller-request cancellation.

A provider response that reaches parsing or domain validation belongs to that
attempt. Invalid OpenAI fallback output is terminal validation failure and
cannot create or activate an artifact. Invalid Vertex output is likewise not
masked by automatically asking a second provider to produce different data.

## Timeouts, retries, and circuit breaking

Every provider attempt has an operation-specific hard deadline implemented by
the shared boundary. The hard deadline must settle even if an injected SDK or
test double ignores an abort signal. Timers and listeners are always released,
so test and worker processes terminate naturally.

Provider-local model retry is allowed only for an explicitly classified model
availability failure. Permission, authentication, suspension, invalid request,
and other non-retryable failures must not cause a second Vertex request before
OpenAI fallback.

The circuit breaker records only provider availability failures. Permission
and authentication failures may open the primary circuit immediately because
repeating them cannot repair credentials or a suspended project. Transient
capacity/network failures use the bounded threshold and cooldown. A half-open
probe remains bounded and does not block OpenAI fallback.

One durable job attempt may contain one Vertex attempt and one eligible OpenAI
attempt. If both providers are unavailable, the job may retry only under its
existing bounded durable policy. Deterministic parsing, schema, validation,
authorization, and persistence failures become terminal `FAILED` job states.
No operation may remain indefinitely in `PENDING`, `PROCESSING`, or `READY`
without the corresponding durable artifact.

## Structured generation contracts

The current Business Profile, Assistant Recommendation, Assistant
Configuration, Business Identity, image semantic, and CRM qualification
prompts are preserved. Provider adapters map those prompts into native request
formats without rewriting approved customer behavior.

Knowledge output continues through the existing JSON parser and exact V2 field
validators. Provider results cannot add platform prompt fields, unsupported
claims, unknown keys, oversized values, or a different schema version.

Business Profile and Assistant Configuration artifacts remain review-only when
generated. Recommendation and Configuration generation cannot automatically
approve or activate anything. Previously rejected recommendations remain
rejected. A new valid generation uses the existing request fingerprint,
supersession, and migration 112 reconciliation semantics without duplicate-key
conflict.

The provider object retains a stable platform policy identity for request
fingerprinting. Actual provider/model execution metadata is recorded separately
through safe telemetry, so failover does not change idempotency keys or create
provider-dependent duplicate artifacts.

## Image Knowledge provenance

Image extraction retains the existing MIME, byte-size, dimension, pixel-count,
role, confidence, reading-order, and canonical extraction validation.

The normalized result records the actual provider-derived method. Vertex output
continues to use the established Gemini provenance. OpenAI fallback uses a
distinct provider-accurate extraction method within the existing bounded
provenance field. Downstream candidate and evidence services consume the same
canonical extraction structure and never infer business truth from the
provider name.

OpenAI receives only the already validated tenant-owned image bytes for the
current source. No cross-tenant resource lookup, arbitrary URL fetching, or
external source substitution is introduced.

## Durable jobs and concurrency

The existing PostgreSQL job claims, `FOR UPDATE SKIP LOCKED`, leases, stale-job
recovery, scoped request fingerprints, and transactional artifact persistence
remain authoritative. Provider failover happens before artifact persistence and
does not add a second completion path.

A worker marks `READY` only after the canonical lifecycle service has returned
the one durable scoped artifact. Failure updates remain tenant-scoped and clear
leases. Concurrent requests converge through existing job uniqueness and
generation-run fingerprints. Fallback does not bypass the lifecycle services
or write artifacts directly.

Migration `112_reconcile_rejected_recommendation_runs.sql` is not modified. Its
historical reconciliation and rejected-recommendation behavior receive focused
PostgreSQL regression coverage.

CRM qualification retains its PostgreSQL advisory lock and transactional
analysis persistence. The current process-memory in-flight set remains only a
local optimization, never authority. Failover does not introduce a second
analysis write or duplicate lead activity.

## Observability and customer-facing errors

Safe structured telemetry records:

- operation;
- tenant-scoped correlation ID or bounded fingerprint prefix;
- primary provider attempted;
- primary failure classification;
- fallback attempted;
- fallback success or failure;
- actual successful provider and model;
- total bounded duration;
- durable job status when applicable;
- terminal error category.

Telemetry must not contain API keys, credentials, raw SDK errors containing
secrets, full prompts, generated output, customer messages, image bytes,
document contents, private contact data, or cross-tenant identifiers.

Dashboard errors remain operation-specific and actionable: retry later for
temporary provider unavailability, correct invalid input or review state when
appropriate, and report an unsupported capability when no compatible fallback
exists. They never name platform credentials, Google project identifiers,
internal provider topology, or provider model details to customer tenants.

## Security and compatibility

- Every database read and write remains tenant-scoped.
- Provider failover never changes RBAC or approval boundaries.
- Grounding is assembled before provider invocation and validated afterward.
- No prompt, tenant knowledge, conversation, image, or artifact is reused
  across tenants.
- Historical and fresh tenants use the same shared provider path.
- WhatsApp, Instagram, Web Chatbot, AI Guide, Live Inbox, takeover, and
  return-to-AI behavior remain unchanged.
- Existing approved prompts and active tenant data are not rewritten.
- No migrations or Dashboard UI changes are expected. A migration may be added
  only if later evidence proves it strictly necessary and requires a renewed
  design review.

## Test strategy

Implementation follows test-driven development. Each production change begins
with a focused failing test that proves the missing behavior.

Shared gateway tests cover:

- Vertex primary success without an OpenAI call;
- suspended-project/permission failure followed by OpenAI success;
- authentication failure followed by OpenAI success;
- timeout and supported network failure followed by OpenAI success;
- circuit open followed by an independent OpenAI attempt;
- both providers unavailable with bounded actionable failure;
- caller cancellation with no fallback;
- validation/schema errors with no fallback;
- unsupported capability with no fabricated request;
- fresh, un-aborted secondary signals;
- hard timeout settlement when a provider double ignores abort;
- timer/listener cleanup and natural Node process exit.

Knowledge and CRM tests cover:

- identical structured validators on Vertex and OpenAI output;
- invalid OpenAI output creates no artifact and is not retried;
- provider failure and persistence failure remain distinct;
- `NEEDS_REVIEW` is preserved for recommendations and configurations;
- rejected recommendation followed by new generation without duplicate-key
  conflict;
- concurrent generation converges to one scoped artifact;
- multiple tenants cannot share jobs, prompts, artifacts, or results;
- Business Profile and image semantic jobs reach terminal states;
- image extraction records accurate provider provenance;
- CRM rescore persists at most one tenant-scoped analysis;
- migration 112 remains unchanged and effective in real PostgreSQL.

Protected regression tests cover existing WhatsApp, Instagram, Web Chatbot,
AI Guide, tenant factual authority, provider parity, Live Inbox persistence,
and Fresh Tenant Golden Path behavior. Focused suites run first. The cumulative
release-blocking command runs only after focused behavior is GREEN.

Every invoked test process must exit naturally with zero remaining resources.
The existing hanging focused baseline is investigated before completion; no
forced-exit workaround, skipped test, or weakened timeout assertion is allowed.

## Deployment and acceptance

After focused, real-PostgreSQL, protected channel, and Fresh Tenant Golden Path
checks pass:

1. Review the final task-scoped diff and run `git diff --check`.
2. Refresh `origin/staging` and reconcile any newer changes without reset,
   force-push, or destructive rebase.
3. Rerun every gate affected by reconciliation.
4. Commit only approved task files and push to `origin/staging`.
5. Verify local `HEAD` equals refreshed `origin/staging`.
6. Verify the staging deployment contains that commit and required workers are
   healthy.
7. Use safe staging telemetry to confirm an eligible Vertex failure attempts
   and succeeds through OpenAI where environment access permits.

Automated success does not establish physical GREEN. Dubai Horizon Real Estate
is only the human acceptance scenario and must never appear in implementation
logic. Human acceptance must select its active Business Profile, generate a new
`NEEDS_REVIEW` recommendation through fallback, preserve rejected history,
explicitly approve the recommendation, generate and explicitly approve/activate
the review-only Configuration, verify the public AI Guide persona response, and
confirm conversations and responses in Live Inbox.

If OpenAI credentials are unavailable or invalid, a required capability is not
supported, staging access is unavailable, or a protected GREEN invariant would
need to change, implementation stops and reports the exact blocker. The task is
not declared physically GREEN.
