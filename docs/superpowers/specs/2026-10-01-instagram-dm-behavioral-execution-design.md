# Instagram DM Behavioral Execution Layer

## Scope

This change applies only to the Instagram DM AI runtime. It must not alter the
WhatsApp runtime, the AI Guide runtime, shared production prompts, or any
tenant-specific source-code path.

The behavioral prompt is tenant-owned channel configuration. It is distinct
from factual knowledge: knowledge answers *what is true for a tenant*, while
the behavioral policy governs *how the Instagram assistant must respond*.

## Authority and precedence

For every Instagram response, the runtime constructs a channel-specific
instruction with this effective precedence:

1. The current customer message and its explicit intent.
2. Durable conversation and visual-session context.
3. The active tenant assistant's Instagram behavioral policy.
4. Approved tenant knowledge and active business configuration.
5. General model reasoning, which may not contradict any earlier source.

The policy is fetched only through the active tenant/assistant configuration.
It is never selected by tenant name, product category, customer identity, or
any other hard-coded condition. A policy is untrusted as a source of facts but
is trusted as tenant-approved response behavior after scope validation.

## Components

### Instagram behavioral-policy resolver

Create an Instagram-only resolver that reads the behavioral prompt from the
active assistant configuration's Instagram channel adaptation. It returns an
empty policy when none is configured and does not read another tenant's
configuration. The resolver validates the configured value as bounded text up
to 64,000 characters so the complete supplied 51,040-character policy loads
without truncation, and labels it as behavioral authority rather than factual
knowledge.

### Instagram system-instruction composer

The normal inbound orchestration path and the operator AI-only path will use
one composer. It includes current intent, merged chronological conversation
turns, durable memory (including visual context), the resolved behavioral
policy, approved knowledge, and existing Instagram presentation rules.

The composer states that prepared answers and prohibited behavior in the
policy are mandatory, while tenant facts may only come from approved
configuration and knowledge. This prevents general model knowledge or attached
advertising media from overriding tenant-approved behavioral and factual
authority.

### Media and continuity

Existing Instagram media detection remains channel-local. A written customer
message is the primary intent even when media is attached. A media-only turn
asks for clarification without inventing business context. The response path
retains the full persisted message history and structured memory so visual
follow-ups continue the existing product/visual goal instead of resetting the
conversation.

## Data behavior

The uploaded behavioral prompt is stored as active tenant assistant
configuration under the Instagram channel adaptation. No hard-coded tenant
content is introduced in runtime code. Existing configurations without a
behavioral policy retain their current behavior; no historical configuration is
rewritten or invalidated.

## Error handling and isolation

If the Instagram policy is absent or malformed, the runtime uses the existing
Instagram presentation and safety rules without borrowing another tenant's
policy. Resolver failures are fail-safe and logged only with safe identifiers.
Human-takeover, delivery, idempotency, and tenant boundaries retain their
existing behavior.

## Tests

Tests will exercise observable Instagram runtime output/instructions for:

1. Behavioral-policy inclusion and precedence.
2. Sponsor residency prepared-answer behavior, including sponsor role, NOC,
   Turkey process, and the 13,000/4,000/8,000/1,000 AED amounts when the
   tenant policy supplies them.
3. Insurance behavior grounded in the tenant policy/approved authority without
   invented legal claims.
4. Media plus text: the written intent wins.
5. Media-only clarification.
6. Visual/product follow-up continuation through persisted conversation
   context.
7. Two-tenant isolation: one tenant's Instagram behavioral policy is never
   assembled for another tenant.
8. WhatsApp and AI Guide regression: neither receives Instagram behavioral
   policy content.

Tests are written before production code and must be observed failing before
the implementation is added.
