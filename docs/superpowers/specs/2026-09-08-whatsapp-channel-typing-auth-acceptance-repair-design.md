# WhatsApp Channel, Typing, and Auth Acceptance Repair Design

## Scope

This design closes three human-acceptance failures without tenant-specific behavior:

1. canonical WhatsApp external-channel ownership and explicit cross-tenant transfer;
2. real WhatsApp Cloud API typing on the inbound AI-response path; and
3. responsive Login and Customer Invitation rendering against the four repository PNG references.

The work preserves Guide, Web Chat, Knowledge Intelligence, Business Profile, Assistant Configuration, Live Inbox, human handoff, push, delivery status, authentication, invitation acceptance, and historical conversation ownership.

## Authority and ownership

`tenant_channels` remains the canonical owner of a physical WhatsApp phone-number ID. Canonical comparison strips an optional `whatsapp:` prefix, trims the value, and validates a digits-only Meta phone-number ID. At most one active WhatsApp channel may own one normalized external ID.

Same-tenant create and update use the existing tenant access and tenant-admin boundary. A conflicting active owner produces a structured `WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT` response. The response exposes transfer metadata only to a platform operator with `system_role === 'OWNER'`; CUSTOMER tenant administrators cannot transfer or learn another tenant's identity.

Cross-tenant transfer uses the existing platform-level `requireOwner` middleware. It requires the target tenant, target active assistant, normalized external ID, expected current channel ID, and explicit confirmation. The transaction obtains an external-ID advisory lock and row locks, revalidates the expected owner, retires the prior channel, activates or creates one target channel, moves the single transport projection, and writes an immutable audit event. Any ambiguity or changed owner rolls back the whole transaction.

Historical conversations and messages remain attached to their original tenant and retired channel. No conversation tenant ID or channel ID is rewritten. A retired source channel may retain the historical external ID because the uniqueness contract applies to active ownership only.

## Runtime resolution and historical convergence

Inbound runtime resolution starts from the one active normalized `tenant_channels` row. It requires active tenant, active same-tenant assistant, and matching channel assistant. `channel_integrations` is a derived transport projection, not competing ownership authority.

The runtime may repair a missing or stale integration mapping only after exactly one canonical active channel owner has been proven. It must never change `tenant_channels`, deactivate another owner, or transfer ownership. Multiple candidates or an inconsistent target fail closed.

Conversation upsert updates activity only when the conflicting row already has the same canonical tenant and channel. A cross-tenant mismatch returns `WHATSAPP_CONVERSATION_OWNERSHIP_CONFLICT`; it never updates `conversations.tenant_id`.

## WhatsApp transport and typing

The webhook phone-number ID is checked against the canonical resolved channel. Outbound AI and lifecycle delivery receives that canonical channel phone-number ID explicitly. `WHATSAPP_TOKEN` remains server-only platform transport authorization, but `WHATSAPP_PHONE_ID` is no longer the global routing authority or a reason to reject another canonically configured phone ID.

Before persona, knowledge, or model generation for an eligible AI-owned inbound message, the webhook awaits a Meta `/messages` request containing:

```json
{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "<inbound wamid>",
  "typing_indicator": { "type": "text" }
}
```

The response path records safe lifecycle diagnostics: attempted, accepted or failed, canonical tenant/channel short identifiers, phone-ID fingerprint, HTTP status, provider error code, failure category, and whether outbound processing continued. Tokens, credentials, raw payloads, customer phone numbers, and message contents are never logged.

Typing failure is observable but does not change the durable conversation outcome. Human ownership, handoff, duplicate webhook, closed conversation, or suppressed AI prevents typing. Return to AI restores it for the next eligible inbound message. Adaptive pacing preserves a minimum observable compose window of 1500 ms and caps artificial delay at 2500 ms.

## Dashboard ownership experience

The Channels form lists only same-tenant active assistants for an active WhatsApp channel. If an eligible assistant exists and no assignment is present, the form selects an eligible assistant rather than presenting an unassigned active channel as the default.

Create conflict renders the structured ownership state. CUSTOMER tenant administrators see that platform assistance is required. Platform OWNER users see the current owner, target owner, selected target assistant, and an explicit confirmation action. Transfer success refreshes channel and assistant state.

## Auth rendering

The exact authoritative references are:

- `docs/design-reference/samche-login-reference.png` (1600×983)
- `docs/design-reference/samche-customer-invitation-reference.png` (1672×941)
- `docs/design-reference/login.mobile.png` (384×620)
- `docs/design-reference/invatation.login.png` (364×620)

The existing canonical logo asset is reused. Its large internal canvas padding is compensated by a clipped responsive frame so the visible mark, not merely the image element, matches the reference scale.

Desktop retains a true two-column composition with the hero, capability row, and footer on the left and a correctly sized/positioned card on the right. The laser SVG is layered above the page background and behind interactive content.

Mobile is a single ordered flow: prominent logo, Login hero copy where present in the reference, compact form card, exactly six compact capability items, and footer. Login-only badge, welcome copy, and assurance decoration are hidden on mobile because they are not in the mobile reference. Invitation keeps its identity context and four fields while removing the duplicate card logo and compacting spacing. Mobile capability title text uses `Automation`; desktop may retain `Automation / Agentic` to match its reference.

Every required width from 320 px through large desktop must avoid horizontal overflow, clipping, overlap, inaccessible controls, and accidental desktop split layout.

## Verification

Tests are written and observed failing before production changes. Ownership tests cover structured conflicts, platform-only transfer, same-tenant update, assistant eligibility, normalized uniqueness, atomic ambiguity failure, audit history, stale projection convergence, and untouched historical conversations. Real PostgreSQL tests exercise locks, constraints, transfer, and conversation isolation.

Webhook integration tests execute the same orchestration function mounted by `app.js` and assert ordering from persistence through typing, runtime generation, pacing, and delivery. They inspect the complete Meta payload and safe failure diagnostics.

Auth behavior tests remain intact. Rendered browser inspection uses the exact reference viewports plus 320, 375, 390, 393, 414, 430, tablet, desktop, and large desktop widths. Measurements record visible logo bounds, card bounds, capability order, scroll size, and overflow; screenshots are visually compared with all four PNGs. Human acceptance remains required.