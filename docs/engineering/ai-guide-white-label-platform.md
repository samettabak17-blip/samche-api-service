# AI Guide White-Label Platform

AI Guide has one shared public shell at `/guide`. Its customer-facing identity is resolved from the configured `SAMCHEGUIDE` channel integration, then the tenant and assistant that own that channel. A browser never selects a tenant ID.

## Experience configuration

`guide_experience_versions` stores tenant-owned presentation data only: safe brand copy, opaque platform asset routes or intentionally validated HTTPS raster URLs, constrained color tokens, fonts, layout presets and module flags. It cannot contain provider, model, prompt, script or HTML values. The runtime behavior continues to come from the active Business Profile, active Assistant Configuration and approved knowledge.

Administrators create a **DRAFT**, inspect its Dashboard preview, then explicitly **PUBLISH** it. Only one version per tenant/assistant scope is published. Publishing archives the previous version, changes the runtime cache key, and requires no frontend deployment. An earlier archived published version can be explicitly restored through **Rollback**; this does not change channel ownership, Business Profiles, Assistant Configurations, providers or models. Existing enabled Guide integrations receive a neutral, data-derived initial published version during migration.

## Branding assets

Logo and assistant-avatar uploads use the existing private object-storage abstraction. `guide_experience_assets` stores portable, tenant/assistant-scoped metadata and an internal storage key; a public Guide receives only an opaque `/guide/assets/<asset-id>` route. PNG, JPEG and WebP are verified by MIME, byte signature and a 5 MB limit. SVG, base64 and executable content are rejected. Replacing an image creates a new scoped asset and leaves historical experience versions intact; a missing or deleted asset simply renders the configured safe fallback.

## Safety and onboarding

Attach a Guide channel/integration to the tenant's assistant during onboarding. Profile or configuration activation must never remap that channel. The public bootstrap and the chat runtime fail closed when channel, tenant, assistant, profile or configuration ownership does not agree. If no published experience exists, the public shell uses neutral `AI Guide` copy and never falls back to another tenant or SamChe branding.

Platform owners can administer a selected tenant; CUSTOMER tenant ADMINs can administer only their tenant. AGENT users remain read-only. Provider/model selection is not part of the experience API or Dashboard UI.
