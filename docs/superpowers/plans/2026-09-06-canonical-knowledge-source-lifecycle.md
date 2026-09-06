# Canonical Knowledge Source Lifecycle Implementation Plan

**Goal:** Give every supported Knowledge source type one derived lifecycle authority while preserving the raw-image privacy boundary and indexing only approved canonical facts.

**Constraints:** Preserve tenant isolation, provenance fail-closed behavior, approved history, document behavior, and existing durable jobs. Never mark a source indexed without successful indexing; never use tenant-specific data or repairs.

### Task 1: Prove the lifecycle semantics with focused RED tests

- Add source-state tests for image processing readiness, index eligibility versus index readiness, and profile eligibility.
- Add processing tests proving that raw images stay outside retrieval indexing while their approved materialized facts use the normal durable index job.
- Update candidate approval tests to prove indexing is not an image-evidence prerequisite while CUSTOMER-only and conflicting/no-identity evidence remain rejected.
- Run the focused tests and confirm they fail because the canonical resolver and convergence path do not exist.

### Task 2: Introduce the canonical derived source-state authority

- Add `services/knowledge-source-canonical-state.js` with a tenant-scoped derived resolver based on source persistence, source identity relations, durable job state, and actual indexed chunks.
- Keep processing readiness, image-candidate eligibility, `indexEligible`, `indexReady`, source identity validity, and profile eligibility distinct. The resolver creates no redundant lifecycle columns.
- Classify raw images as not index-eligible: their full extracted text can retain CUSTOMER context. An approved canonical materialized source is the only image-derived source that enters the durable index pipeline.
- Re-run source-state tests.

### Task 3: Connect the durable processing and consumer boundaries

- Preserve image extraction without indexing raw image text.
- Use canonical source state in profile presentation and Business Profile source-scope validation.
- Remove image `DISABLED` as a candidate-generation requirement; preserve extraction, tenant, assignment, and provenance checks.
- Make list/detail presentation await the canonical state and present the source-owned “canonical candidate approval required” reason.
- Run lifecycle, image, candidate, profile, tenant-isolation, and document regression tests.

### Task 4: Preserve the agent contract and verify cumulatively

- Add the minimum architectural invariant to `AGENTS.md` only if the existing contract does not already capture the resolver, semantic separation, and normal historical convergence requirements.
- Run syntax checks, the real disposable-DB Fresh Tenant Golden Path, full backend suite, dashboard suite/build, and `git diff --check`.
- Review only task-related files, commit only after every mandatory gate is green, push only `origin/staging`, and verify local/remote HEAD equality.
