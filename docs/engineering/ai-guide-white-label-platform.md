# AI Guide White-Label Platform

AI Guide has one shared public shell. Its customer-facing identity is resolved from the incoming hostname through the active `guide_domains` binding, then the bound Guide channel, tenant and assistant. A browser never selects a tenant or assistant ID; query parameters, local storage and browser-provided identity are not routing inputs.

## Experience configuration

`guide_experience_versions` stores tenant-owned presentation data only: safe brand copy, opaque platform asset routes or intentionally retained HTTPS asset URLs, constrained color tokens, fonts, layout presets and module flags. It cannot contain provider, model, prompt, script or HTML values. The runtime behavior continues to come from the active Business Profile, active Assistant Configuration and approved knowledge.

Administrators create a **DRAFT**, inspect its Dashboard preview, then explicitly **PUBLISH** it. Only one version per tenant/assistant scope is published. Publishing archives the previous version, changes the runtime cache key, and requires no frontend deployment. An earlier archived published version can be explicitly restored through **Rollback**; this does not change channel ownership, Business Profiles, Assistant Configurations, providers or models. Existing enabled Guide integrations receive a neutral, data-derived initial published version during migration.

## Branding assets

Logo and assistant-avatar uploads use the existing private object-storage abstraction. `guide_experience_assets` stores portable, tenant/assistant-scoped metadata and an internal storage key; a public Guide receives only an opaque `/guide/assets/<asset-id>` route. PNG, JPEG and WebP are verified by MIME, byte signature and a 5 MB limit. SVG, base64 and executable content are rejected. Replacing an image creates a new scoped asset and leaves historical experience versions intact; a missing or deleted asset simply renders the configured safe fallback.

## Safety and onboarding

Attach a Guide channel/integration to the tenant's assistant during onboarding, then create a hostname binding under **Guide Experience → Domains**. The binding is durable infrastructure identity: Profile, Configuration, Experience publish and Experience rollback never remap it. A hostname moves through `PENDING → VERIFIED → ACTIVE` after its CNAME targets the platform-configured Guide ingress; it can later be explicitly archived. Hostnames are normalized and globally unique.

The public bootstrap, public asset route, session token and chat runtime all use that same resolved domain scope. The session token is bound to domain, tenant, assistant and channel, and active assets are filtered by that exact tenant/assistant scope. Unknown, inactive, archived or ownership-inconsistent hostnames fail closed; they never fall back to SamChe or another tenant. A published Experience still resolves dynamically, so a Dashboard publish or explicit restore changes the public Guide without a frontend deployment.

The platform ingress target is deployment configuration (`GUIDE_DOMAIN_INGRESS_TARGET`), not tenant configuration. In a Render deployment, the SamChe-owned ingress adapter registers the hostname against the shared web service through the platform's service credentials, and verification succeeds only when both DNS and Render report the hostname ready. Customer onboarding needs only the hostname binding and the displayed DNS CNAME; it never requires a source-code, provider/model, Render environment, or tenant-ID edit. Customer-owned domains use the same binding model as SamChe-hosted subdomains.

Platform owners can administer a selected tenant; CUSTOMER tenant ADMINs can administer only their tenant. AGENT users remain read-only. Provider/model selection is not part of the experience API or Dashboard UI.
