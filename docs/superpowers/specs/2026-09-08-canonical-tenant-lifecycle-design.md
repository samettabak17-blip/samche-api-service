# Canonical Tenant Lifecycle Design

## Goal

Make cross-cutting SamChe lifecycle capabilities permanent across historical,
current, fresh and future tenants without hidden repair, tenant-specific code,
or automatic creation of customer-owned domain entities.

## Boundary

`ensure_tenant_platform_capabilities` remains responsible only for durable
platform baseline state. Assistants, channels, Business Identities, sources,
Business Profiles, recommendations and configurations remain intentionally
on-demand and are created only by their canonical user/domain operations.

## Relationship authority

Every lifecycle relation has one canonical creator and owner:

| Relation | Canonical creator / owner | Historical convergence |
| --- | --- | --- |
| tenant-user | onboarding / tenant membership domain | existing membership tables, tenant-scoped authorization |
| tenant-capability | tenant platform provisioning service | idempotent `ensure_tenant_platform_capabilities` |
| tenant-Business Identity | tenant-admin identity operation | no inferred identity; explicit assignment only |
| tenant-assistant and channel-assistant | canonical assistant/channel operations | tenant-scoped constraints and runtime validation |
| source-Business Identity | explicit assignment service | idempotent unambiguous provenance convergence only |
| source-assistant | source scope operation | materialized-source inheritance plus replay-safe migration 067 |
| candidate-source and materialized-source provenance | candidate approval service | immutable approved history; approved materialization provenance |
| chunk-source and embedding-chunk | source indexing service | normal index job; no repair-by-dashboard path |
| profile-identity, recommendation-profile, configuration-assistant/profile | versioned Knowledge lifecycle services | explicit review/activation semantics |
| conversation-tenant/channel/assistant | live-inbox/channel ingress | tenant/channel scope validation and durable messages |
| push subscription-user/device | push subscription domain service | opt-in only; no subscription fabricated by provisioning |

## Shared runtime brain

Guide, Web Chat and WhatsApp resolve channel scope through the same tenant and
assistant authority, then use the active configuration/profile and
`retrieveApprovedKnowledge`. Channel adapters may add delivery/session context,
but cannot introduce another business-knowledge authority.

## Evidence gate

The real PostgreSQL platform lifecycle Golden Path contains: a historical
equivalent tenant, a fresh tenant using normal domain operations, and an
isolation-control tenant. It verifies no cross-tenant source, profile,
configuration, retrieval, Guide, fake WhatsApp, handoff, or implemented push
boundary leaks. It must never seed final canonical relationships directly.

## Compatibility

Historical data converges only through replay-safe migrations, baseline
capability ensure, deterministic domain convergence, or approved durable
background work. No manual SQL, tenant-specific scripts, implicit dashboard
repair, or tenant-name branch is a valid migration path.

## Human acceptance sequence

After automated lifecycle gates pass, Guide is the next human product gate.
WhatsApp automated and real test-recipient acceptance follow. Phone push and
the final new-tenant zero-intervention human acceptance remain separate
physical-world gates.
