# Tenant Persona Isolation and Automatic Configuration Design

## Objective

Remove SamChe as a platform-wide runtime persona. Every mapped channel must resolve business identity and behavior from the current tenant's ACTIVE Business Profile, ACTIVE Assistant Configuration, approved Assistant knowledge, and current authority epoch. SamChe remains an ordinary tenant whose SamChe behavior is tenant data.

## Security boundary

The shared platform layer may contain only provider safety, tenant and Assistant isolation, authority-epoch history filtering, secret protection, grounding, human-handoff, and delivery constraints. It must contain no company identity, services, prices, geography, sales policy, fallback wording, follow-up wording, or scheduled-message wording.

Mapped runtimes fail closed when either ACTIVE profile or ACTIVE configuration is unavailable. They must never fall back to the legacy SamChe prompt. Legacy behavior remains reachable only through an explicit SamChe-tenant compatibility boundary, never by default or by channel type.

## Data contracts

Business Profile V2 remains versioned JSONB and adds an explicit `schema_version = 2` contract. It captures source-derived business facts: company identity/display name/summary, industry/type, products, services, packages, pricing, policies, procedures, operations, sales information, escalation facts, communication style, customer handling, terminology, languages, and source-supported prohibited or unsupported claims. Generation must distinguish unknown facts from recommendations and retain source provenance.

Assistant Configuration V2 remains Assistant-scoped versioned JSONB with `schema_version = 2`. It stores tenant data for assistant identity, role/purpose, company context, instructions, tone, greeting, customer handling, FAQ/qualification/fallback/escalation/sales guidance, follow-up and scheduled behavior, languages and language selection, prohibited claims, unsupported-claim behavior, terminology, operating rules, and channel adaptations.

Recommendations and configurations are distinct artifacts. Recommendations propose behavior from the ACTIVE profile and approved tenant knowledge. Final configurations are generated only from an APPROVED recommendation plus the ACTIVE profile, remain `NEEDS_REVIEW`, and affect runtime only after explicit activation.

## Generation

Generation prompts are generic and require current-tenant approved evidence only. They forbid default or cross-tenant personas, explicitly forbid using SamChe as a default, require unknown/unsupported treatment when evidence is insufficient, and separate factual extraction from AI recommendations. Provider/model, input source hashes, profile/recommendation IDs, and output hashes remain recorded through the existing generation-run provenance model.

## Shared runtime persona assembler

A channel-neutral service resolves and validates the ACTIVE profile/configuration pair and renders a structured provider instruction. Inputs are tenant ID, Assistant ID, current approved knowledge, current authority-epoch history, current user message, and optional channel formatting constraints. Output contains a platform-safety instruction and tenant business persona without exposing secrets or raw embeddings.

The assembler returns an explicit unavailable result when ACTIVE persona data is incomplete. Channel adapters convert that result to a neutral localized configuration-unavailable response without calling a legacy business prompt.

## Channels

- WhatsApp retains existing provider, routing, delivery, media, authority, and handoff paths. Mapped traffic uses the shared persona. Existing `system_prompt` and deterministic SamChe templates are accepted only inside the explicit SamChe compatibility boundary.
- Signed Web Chat retains server-side widget-to-tenant/Assistant resolution and OpenAI. Its hardcoded SamChe base prompt is replaced for mapped traffic by the shared persona.
- AI Guide `/chat` and `/plan` require mapped tenant/Assistant persona. `/plan` uses ACTIVE persona and approved knowledge, not a default UAE/SamChe planning prompt.

## Deterministic and scheduled behavior

Generic deterministic templates provide structure only and interpolate tenant identity/configuration. Business capability wording comes from ACTIVE tenant data. Follow-up and scheduled behavior is configuration data containing enabled state, timing strategy, tone, allowed topics, continuation/CTA policy, and suppression rules. Cron remains an orchestrator: it resolves tenant, Assistant, current configuration and conversation context before producing a message. It contains no customer-specific wording.

## Authority and history

ACTIVE profile/configuration changes continue to bump the tenant+Assistant authority epoch. Persona-bearing messages from an older epoch remain visible in Live Inbox but are excluded from all provider history. Reassignment or reactivation never revives old persona history.

## Dashboard

Business Profile and Configuration screens expose structured V2 fields and safe provenance labels (`SOURCE-DERIVED`, `AI RECOMMENDED`, `ADMIN EDITED`). Raw JSON remains a technical fallback. A Runtime Behavior Preview shows resolved business identity and behavior summaries but never global safety instructions, secrets, raw embeddings, or the full provider prompt.

## Verification and release gate

TDD covers non-SamChe isolation in WhatsApp, Web Chat, AI Guide and `/plan`; missing-persona fail-closed behavior; cross-tenant identity/service/price isolation; SamChe tenant compatibility; approval versus activation; epoch invalidation; follow-up/scheduled isolation; protected channel and dashboard regressions. Only staging is deployed. Automated success does not make Task 6 GREEN; the user must complete the supplied manual Meridian Arc acceptance checklist.
