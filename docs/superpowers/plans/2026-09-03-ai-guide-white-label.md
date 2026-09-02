# AI Guide White-Label Implementation Plan

> **For agentic workers:** execute inline with test-first cycles; do not alter unrelated dashboard-contract/design-reference files.

**Goal:** Deliver one shared public AI Guide whose tenant-safe visual experience is configured and published as data, while preserving the existing runtime resolver and platform-controlled Vertex model path.

**Architecture:** Add versioned tenant/assistant Guide Experience records with strict active-version resolution.  Public Guide bootstrap resolves experience only through its existing channel integration; Dashboard management edits drafts, previews an explicit draft, and activates a version.  A shared, data-driven public Guide shell consumes the bootstrap payload and never receives provider or prompt controls.

**Tech Stack:** PostgreSQL migrations, Express routes/services, React/Vite Dashboard and public Guide bundle, React Query, existing auth/audit/runtime services.

## Global Constraints

- Production remains untouched; staging only.
- No tenant-specific source branches, prompts, HTML, CSS, or provider/model controls.
- Preserve strict channel/runtime ownership, active profile/configuration resolution, and Vertex adapter behavior.
- All public experience lookups fail closed or return a neutral configuration; never leak a different tenant.
- Use additive, idempotent migrations and retain user-owned dirty documentation unmodified.

### Task 1: Domain and migration

- [ ] Write failing domain tests for validation, lifecycle, active-only resolution, rollback, and scope isolation.
- [ ] Add an additive Guide Experience/version/audit schema and service with neutral fallback and safe presets.
- [ ] Re-run domain tests and migration checks.

### Task 2: Public resolution and shared Guide shell

- [ ] Write failing tests for integration-bound public bootstrap, neutral fallback, preview token scope, and no cross-tenant branding.
- [ ] Add public bootstrap/preview APIs and a shared public Guide component tree driven by safe configuration tokens.
- [ ] Preserve existing Guide chat/page/session context and runtime resolver.

### Task 3: Dashboard management

- [ ] Write failing Dashboard tests for tenant admin edit, draft preview, activation, rollback, and hidden platform controls.
- [ ] Add the Guide Experience Dashboard page using shared Dashboard controls and dark-theme semantic tokens.
- [ ] Re-run focused Dashboard tests.

### Task 4: Staging configuration, verification, and release

- [ ] Seed/migrate only generic neutral and explicit SamChe defaults; create Blue Dune through ordinary configuration data.
- [ ] Verify draft/preview/activate cache-version behavior with safe staging records and no channel/profile/configuration mutation.
- [ ] Run backend/Dashboard suites and builds, deploy staging, then verify API, DB, Dashboard, public Guide, and controlled Vertex runtime health.
