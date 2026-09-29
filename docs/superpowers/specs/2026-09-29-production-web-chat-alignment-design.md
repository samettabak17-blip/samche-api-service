# Production Web Chat Alignment and Public Error Boundary Design

## Scope

Align the public SamChe support chatbot with the existing canonical Web Chat runtime and ensure that every public chat boundary converts provider or infrastructure failures into a localized, provider-independent customer response. Production publication, DNS, secrets, hosting replacement, and infrastructure creation remain outside this change.

## Proven production path and target architecture

The current `ai.samchecompany.com` page is a Hostinger-served custom artifact whose inline widget posts `{ text }` to `https://samche-api-service.onrender.com/chat`. The deployed Render artifact is stale: it does not serve `/web-chat.js`, and its behavior matches the historical direct-Gemini `/chat` implementation that returned parsed upstream JSON without checking the upstream status.

The supported target path is:

`Customer -> canonical Web Chat client -> signed opaque Web Chat session -> /api/chat -> tenant/assistant knowledge authority -> conversation-intelligence support routing -> provider adapter -> public response sanitization -> customer`

`/chat` remains the AI Guide-compatible endpoint. It receives the same public error containment but is not repurposed as Support.

## Shared public error boundary

Create a small provider-independent service that owns three operations:

1. Resolve `tr`, `en`, or `ar` from the latest customer message first, using the existing conservative omnichannel language detector. Only when that message is ambiguous may a bounded conversation/page/configuration locale be used; otherwise English is the safe default.
2. Build a stable public JSON failure payload containing a non-diagnostic public error code and the exact localized customer reply.
3. Emit one sanitized diagnostic record containing only route, stage, correlation ID, normalized error code, and a bounded safe HTTP/provider status. Raw errors, payloads, bodies, prompts, credentials, secrets, stack traces, provider names, and infrastructure details are never serialized into the public payload or interpolated into this boundary's log line.

Required replies are:

- TR: `Şu anda yanıt oluştururken geçici bir sorun yaşıyorum. Lütfen kısa bir süre sonra tekrar deneyin.`
- EN: `I'm having a temporary problem generating a response. Please try again shortly.`
- AR: `أواجه مشكلة مؤقتة أثناء إنشاء الرد. يُرجى المحاولة مرة أخرى بعد قليل.`

The `/api/chat` outer catch and AI-output validation use this boundary. The legacy `/chat` outer catch uses the same boundary while preserving Guide request validation and all existing Guide routing semantics. The canonical browser client displays the server-provided safe reply and uses the same localized copy only for transport or non-JSON failures.

## Support and sales isolation

The Hostinger production preparation must replace the inline `/chat` client with the existing canonical `/web-chat.js` integration using an opaque public widget key. That is the architectural isolation: Support reaches `/api/chat` and its tenant-aware support pipeline, while Guide remains on `/chat`. No prompt duplication or customer-specific route branch is added.

Regression coverage will exercise the two-turn Instagram DM support case in Turkish, English, and Arabic at the canonical conversation-intelligence boundary. It must retain the Instagram context, use the latest-message language, remain troubleshooting-oriented, and exclude legacy UAE visa/company-formation qualification, internal metadata, developer routes, dead links, and unsupported routing or transfer claims.

## Stale link handling

Every active customer-facing occurrence of `aichatbot.samchecompany.com` is reviewed in context. References whose semantic action is the public chatbot demo may use the independently verified `https://ai.samchecompany.com/#live-demo`; examples or unnecessary instructions are removed rather than mechanically replaced. This change does not make the legacy sales prompt part of Support.

## Verification and release boundary

Test-first coverage includes quota/rate-limit, timeout, provider 5xx, malformed provider output, and unexpected exceptions, with explicit negative assertions for raw provider data. Existing Guide, Web Chat, language, tenant, and support behavior remains compatible. Run targeted tests, full repository tests, typecheck, lint, build, and `git diff --check`, then validate the deployed staging API and canonical widget in TR/EN/AR, including a controlled public-error exercise.

Production deployment and Hostinger publication remain human-gated. Preparation must identify the real production widget key, exact script URL and embed, CSP/CORS/domain requirements, client-visible values, and rollback procedure without exposing a secret or changing production.
