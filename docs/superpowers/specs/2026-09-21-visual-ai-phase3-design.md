# Visual AI Phase 3 Design

## Goal

Complete the canonical, tenant-scoped WhatsApp Visual AI lifecycle: explicit image generation or editing requests progress from persisted inbound context through a durable job, a provider-neutral generation boundary, generated resource/message convergence, and canonical WhatsApp media delivery. Existing image/document understanding remains unchanged. Web Chat and AI Guide remain understanding-only.

## Scope and invariants

- WhatsApp is the only channel allowed to enqueue or deliver Visual AI generation.
- The existing `visual_ai_generation_jobs`, tenant configuration, resource architecture, provider adapter, and Phase 2 intent service remain authoritative.
- A job is tenant-, conversation-, and resource-scoped; every lookup includes those boundaries.
- Customer attachment/conversation evidence is preferred over catalog/entity grounding. Missing critical source or reference context is surfaced as a safe localized state, never guessed.
- Human-owned conversations cannot autonomously enqueue or deliver Visual AI. Return-to-AI re-enables only otherwise eligible future requests.
- No real visual-provider call is permitted. `MOCK` is allowed only when explicitly selected through test/staging configuration. In production, an absent or disabled real provider must return a capability-unavailable outcome and must never silently produce mock media.
- Completion must be idempotent across worker restarts and concurrent workers: one generated resource, one assistant message, one resource/message link, and one logical WhatsApp media delivery per job.
- Provider schemas do not cross the provider adapter boundary. Provider/model/latency/usage metadata is stored only in safe normalized form.
- Existing WhatsApp, Web Chat, AI Guide, Live Inbox, tenancy, resource validation, URL/SSRF, handoff, and delivery semantics are non-regression contracts.

## Current pipeline and gaps

Current WhatsApp flow is `webhook -> persistWhatsAppInbound -> conversation_messages/conversation_resources -> ownership gate -> multimodal/provider response`. Inbound image and document resources are correctly tenant-scoped and appear through canonical Live Inbox data. Phase 2 can classify and enqueue visual jobs in isolation, while Phase 1 can claim/process a job and create a generated resource.

The missing links are runtime invocation after ownership gating, a durable worker, grounded multi-turn resolution, a terminal message/delivery state on the job, resource-to-message linkage, and delivery through `deliverWhatsAppMedia`. The existing job completion update is not constrained to a claimed job and cannot by itself prove exactly-once final convergence.

## Architecture

### Intent and multi-turn orchestration

Introduce the complete intent vocabulary `UNDERSTAND_IMAGE`, `SUPPORT_WITH_IMAGE`, `DOCUMENT_UNDERSTANDING`, `VISUAL_GENERATION`, `VISUAL_EDIT`, and `INSUFFICIENT_CONTEXT`. Deterministic support/document signals take precedence over generation. Explicit transformation/edit signals are required; receiving an image alone never generates media.

WhatsApp orchestration runs only after canonical inbound persistence confirms `shouldInvokeAi`. It resolves current-message and recent same-conversation image resources, chooses explicit attachment references before broader context, bounds the history/context it stores, and returns localized acknowledgement/missing-context messages. It persists its acknowledgement through the existing handling-version guard before sending it. It creates no request while a conversation is HUMAN-owned.

### Durable lifecycle

A narrow migration extends the existing job record with an output message reference and an outbound delivery state/correlation fields. The generation job is still the authority. Claim remains `FOR UPDATE SKIP LOCKED`. Completion occurs in stages that converge safely:

1. Claim the job under a lease.
2. Validate/load same-tenant target/reference media and invoke a capability-checked provider.
3. Create-or-reuse the generated resource under an idempotent job linkage.
4. Create-or-reuse one canonical assistant message and link the resource to it.
5. Deliver that resource using the canonical WhatsApp media adapter if no accepted provider message ID is recorded.
6. Persist provider correlation and mark completed only after the durable message/resource state is complete.

Temporary provider/delivery failures remain pending with bounded retry. Validation, ownership, entitlement, unsupported capability, and safety errors are terminal. Expired leases are recovered with the existing recovery path. A terminal failure can produce a safe persisted WhatsApp text response at most once.

### Provider and configuration boundary

The provider interface exposes normalized capability reporting and `generateConcept`. The worker checks capability before loading/provider work. `createVisualAIProvider` permits deterministic mock only when `VISUAL_AI_PROVIDER=MOCK` or an explicit test option selects it. Its default is an unavailable provider, including production environments. Google remains an adapter stub that cannot make a paid request in this task.

### Delivery and Live Inbox

Generated output uses the existing tenant-scoped storage key and `conversation_resources` with source `VISUAL_AI_GENERATED`. The generated image is associated with a canonical ASSISTANT message using the existing resource/message schema, therefore existing Live Inbox feeds receive the same message and resource. WhatsApp delivery calls the existing media adapter using canonical conversation/channel identities and stores the accepted WAMID before job completion. No Visual AI-specific public endpoint or inbox is added.

## Failure behavior

Missing source/reference, entitlement disabled, unsupported capability, unsafe resource, expired source, temporary outage, and terminal generation failure produce channel-safe, localized copy without provider diagnostics. No customer message promises a generated visualization without an enqueued/accepted job. Logs use only safe IDs and normalized codes.

## Verification

Tests use the deterministic provider explicitly and assert no real visual provider calls. Focused tests cover intent separation, multi-turn context, entitlement/isolation, supported capability, duplicate dedupe, SKIP LOCKED/lease recovery, retries, generated resource/message/delivery idempotency, ownership/return-to-AI, outbound delivery boundary, Live Inbox resolution, SSRF/mime safety, and Web Chat/Guide exclusion. Existing WhatsApp, Web Chat, Guide, and Live Inbox regressions remain green. Staging verification, if deployment credentials are available, uses explicit mock configuration only.
