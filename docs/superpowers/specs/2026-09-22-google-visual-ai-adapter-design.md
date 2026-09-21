# Google Visual AI Adapter Design

## Goal

Prepare the existing provider-independent Visual AI workflow for a controlled,
future Google image-provider smoke test using `gemini-3.1-flash-image`, without
making a provider request or changing deployment configuration.

## Scope and boundaries

`VISUAL_AI_PROVIDER` remains the sole provider-selection switch. Unset,
`NONE`, or an unsupported provider fails closed. `MOCK` remains an explicit,
deterministic zero-cost provider. Google credentials alone never select Google.

The Google Visual AI model is configured only by the Visual AI configuration
path. Its narrow Google default is `gemini-3.1-flash-image`; an explicitly
configured valid Visual AI Google model may override it. The adapter must never
fall back to Imagen or MOCK.

Google-specific request and response structures live only in a dedicated
Google Visual AI adapter. WhatsApp, jobs, worker delivery, Live Inbox, WebChat,
AI Guide, and the ordinary Gemini assistant provider retain their existing
provider-neutral contracts. Existing Google Developer API and Vertex
authentication conventions may be reused, but ordinary assistant model routing
is not reused for Visual AI.

## Canonical interface

The Visual AI provider boundary accepts a canonical request containing an
instruction, source images, reference images, output options, and safe
metadata. Compatibility aliases for the existing `targetImage` and
`referenceImage` inputs are retained at the boundary during this change. The
durable job currently supplies one target and at most one reference resource;
the adapter nevertheless supports a bounded collection of references for
future canonical callers. No migration or external URL fetching is introduced.

Input validation remains before provider invocation: only JPEG, PNG, and WebP
buffers within the existing size bound are accepted. The job layer continues to
load resources only by same-tenant, same-conversation resource IDs. It neither
fetches arbitrary URLs nor bypasses SSRF or resource-ownership controls.

## Google adapter

The adapter uses the repository's `@google/genai` SDK and the current image
interaction request form: instruction plus inline source/reference image
content, with an image-only response and bounded safe output options. It
supports Developer API credentials and Vertex project/location configuration
through the existing Google auth conventions, but makes no request during
construction.

Capabilities are declared only for the configured Google image model path:
text-to-image, image-conditioned generation, image editing, and reference
images. The unavailable provider reports none; the deterministic mock retains
its deterministic supported capability set.

## Output and errors

Only a normalized result crosses the provider boundary: image buffer, MIME
type, provider/model identity, safe request/result identifiers, bounded
usage/cost data, and latency. Raw SDK objects, request bodies, credentials,
signed URLs, and image content never leave the adapter or enter durable
metadata.

Adapter errors are converted to canonical Visual AI classes: authentication or
configuration, unsupported capability, invalid input, safety rejection,
quota/rate limit, transient provider failure, and permanent provider failure.
Their retryability remains compatible with the existing bounded job retry
logic. A response with no valid image is a terminal safe failure.

## Verification and release

All provider-boundary verification injects an SDK stub. `REAL_VISUAL_PROVIDER_CALLS`
remains `0`. Tests cover request mapping, MIME preservation, normalized output,
capabilities, model resolution, error classification, fail-closed selection,
explicit MOCK behavior, and existing Phase 3/channel boundaries. Deployment
configuration is not modified; staging must remain fail-closed unless already
configured otherwise.
