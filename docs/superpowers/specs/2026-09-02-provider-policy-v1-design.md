# SamChe Provider Policy V1 Design

## Goal

Centralize provider-neutral generation policy so SamChe domain services declare a workload class, and adapters translate that intent into provider-specific requests. The design preserves the existing Assistant Recommendation background-job flow and does not alter tenant-specific behavior.

## Workload Contract

`FAST_STRUCTURED` is for compact schema-constrained classification, canonicalization, and image semantics. `STANDARD_STRUCTURED` is for bounded Business Profile and Assistant Configuration synthesis. `LONG_BACKGROUND` is for large or multi-source generation. `AGENTIC_REASONING` is reserved for future multi-step planning.

Each policy resolves to provider-neutral fields: policy version, workload class, execution mode, latency budget, provider timeout, output budget, reasoning effort, structured-output requirement, retry policy, and telemetry requirement. The resolver is the only location with default numeric limits or retry classification.

## Execution Model

`FAST_STRUCTURED` may be synchronous only when a caller has an existing bounded response contract; review-artifact creation defaults to background execution. `STANDARD_STRUCTURED`, `LONG_BACKGROUND`, and `AGENTIC_REASONING` identify background-required work when it can outlive normal browser latency. Existing image semantic and Assistant Recommendation jobs remain on the canonical `knowledge_processing_jobs` worker; Policy V1 changes their policy source, not their queue design.

Business Profile remains on its accepted path in this task unless the existing job service can be reused without destabilization. Assistant Configuration is audited and moved to the same central policy; whether it is migrated to a job is decided only from the policy execution-mode contract and existing worker capability.

## Provider Boundary

Core lifecycle services use only `workloadClass` and the resolved SamChe policy. The provider adapter owns capability mapping. Gemini maps `MINIMAL`, `LOW`, `MEDIUM`, and `HIGH` to supported `thinkingLevel` values. OpenAI maps supported reasoning controls or omits unsupported controls safely. Unsupported capability combinations degrade to the nearest safe supported setting without leaking vendor SDK terms back into domain code.

Provider transport receives an AbortSignal from the resolved provider timeout. It must pass the signal to the real HTTP request. The central retry contract retries only timeout, rate-limit, temporary transport, and transient provider-server failures; validation, authorization, safety, tenant, and persistence failures are non-retryable.

## Observability and Identity

Generation telemetry adds workload class, execution mode, provider-policy version, timeout, reasoning class, output budget, and safe attempt state to the existing generation-run metadata. It never stores prompts, documents, secrets, or customer-specific provider policy. Fingerprints include policy version where artifact idempotency requires it.

## Mapping and Scope

Image semantic generation maps to `FAST_STRUCTURED` and remains background. Business Profile maps to `STANDARD_STRUCTURED`. Assistant Recommendation maps to `FAST_STRUCTURED` and preserves the new background job. Assistant Configuration maps to `STANDARD_STRUCTURED` and receives the same bounded/observable policy. Chat runtime paths are audited and documented, but are not behaviorally changed unless they already consume the knowledge-generation provider contract.

## Safety and Verification

No tenant controls provider, model, timeout, output limit, or reasoning setting. No customer-specific override exists. Tests cover resolver defaults, capability degradation, abort propagation, retry classification, telemetry policy metadata, and the four generation paths. Existing lifecycle contracts—tenant isolation, provenance, review approval, and explicit runtime activation—remain unchanged.
