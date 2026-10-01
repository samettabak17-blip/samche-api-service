# Instagram DM Behavioral Execution Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active tenant-owned Instagram behavioral policies mandatory response authority without changing WhatsApp, AI Guide, or shared production prompts.

**Architecture:** An Instagram-only resolver extracts bounded behavioral-policy text from the active tenant assistant configuration. A single composer supplies that policy plus current intent and durable context to both Instagram generation paths, while the existing knowledge context remains factual reference only.

**Tech Stack:** Node.js ESM, PostgreSQL-backed active assistant configuration, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-01-instagram-dm-behavioral-execution-design.md`

## Global Constraints

- Instagram DM only; do not modify WhatsApp runtime or AI Guide runtime.
- Do not modify existing shared production prompt/policy files.
- Behavioral policy is tenant/assistant-scoped configuration, never tenant-name or product hardcoding.
- Current text intent outranks attached Instagram media; media-only remains a clarification flow.
- Approved tenant knowledge provides facts only and may not override prepared policy responses.
- Preserve persisted conversation and visual-session continuity.
- Test each new behavior before production code and observe the failing test.

## Review Focus

- Missing or non-string Instagram policy must preserve existing Instagram behavior without leaking another tenant's policy.
- A policy-shaped object/oversized value must be rejected rather than coerced into a system instruction.
- The operator AI-only path must not bypass behavioral-policy assembly.
- Text alongside attachment must never enter the media-only clarification branch.
- Previous visual/product turns must remain in the generation history for an ambiguous visual follow-up.

---

### Task 1: Resolve tenant-scoped Instagram behavioral policy

**Files:**
- Create: `services/instagram-behavioral-policy-service.js`
- Test: `tests/instagram-behavioral-policy-service.test.js`

**Interfaces:**
- Consumes: `persona.configuration.channel_adaptations.instagram.behavioral_prompt`.
- Produces: `resolveInstagramBehavioralPolicy({ persona, maxLength? }) -> { policy: string, configured: boolean }` with a 64,000-character default bound.

- [ ] **Step 1: Write the failing resolver tests**

Cover a valid string policy, an absent policy, an object policy, and an over-limit policy. Assert only the valid bounded string is returned and that no fallback tenant value exists.

- [ ] **Step 2: Run the resolver test to verify it fails**

Run: `node --test tests/instagram-behavioral-policy-service.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement `resolveInstagramBehavioralPolicy({ persona, maxLength = 64000 })`**

Read only the active persona's Instagram channel adaptation; trim a string only when it is non-empty and within the bound. Return an empty, unconfigured result for every other input.

- [ ] **Step 4: Run the resolver test to verify it passes**

Run: `node --test tests/instagram-behavioral-policy-service.test.js`

Expected: PASS.

### Task 2: Assemble Instagram-only behavioral authority in both response paths

**Files:**
- Modify: `services/instagram-ai-orchestrator.js`
- Test: `tests/instagram-media-text-intent-priority.test.js`

**Interfaces:**
- Consumes: `resolveInstagramBehavioralPolicy({ persona })` from Task 1, current text, merged conversation history, durable memory, and approved knowledge.
- Produces: `buildInstagramBehavioralInstruction({ currentIntent, conversationContext, behavioralPolicy }) -> string`, used in normal inbound and AI-only instruction assembly.

- [ ] **Step 1: Write failing orchestration tests**

Add tests that capture the generated system instruction and assert: the policy is explicitly labeled mandatory behavioral authority; sponsor residency prepared-answer values (sponsor role, NOC, Turkey process, 13,000/4,000/8,000/1,000 AED) are present only through the configured policy; insurance wording is policy/approved-authority based and blocks invented legal mandates; a visual follow-up receives previous visual/product turns; a second tenant policy is not included.

- [ ] **Step 2: Run the Instagram orchestration test to verify it fails**

Run: `node --test tests/instagram-media-text-intent-priority.test.js`

Expected: FAIL because behavioral authority is absent from both instruction paths.

- [ ] **Step 3: Implement policy instruction composition and wire it into both Instagram paths**

Add the composer in `services/instagram-ai-orchestrator.js`. It must state current-message intent and persisted context first, rendered behavioral policy next, then existing channel presentation/identity/memory rules; retain approved knowledge in the existing lower factual-reference position. Call it in `orchestrateInstagramInboundAiResponse` and `generateAndDeliverInstagramAssistantResponse` only.

- [ ] **Step 4: Run the Instagram orchestration test to verify it passes**

Run: `node --test tests/instagram-media-text-intent-priority.test.js`

Expected: PASS, including existing media-only and text-over-media coverage.

### Task 3: Verify channel isolation and regression behavior

**Files:**
- Modify: `tests/instagram-media-text-intent-priority.test.js`
- Test: `tests/instagram-behavioral-policy-service.test.js`

**Interfaces:**
- Consumes: Task 1 resolver and Task 2 composer.
- Produces: regression evidence that behavioral authority is Instagram-only.

- [ ] **Step 1: Write failing isolation assertions**

Extend the existing WhatsApp and AI Guide regression tests to pass a tenant configuration containing an Instagram behavioral policy and assert their instructions do not include it. Add a second-tenant fixture assertion to Task 2 where each composed instruction contains only its own policy.

- [ ] **Step 2: Run the affected tests to verify the new assertions fail before the isolation guard exists**

Run: `node --test tests/instagram-media-text-intent-priority.test.js tests/instagram-behavioral-policy-service.test.js`

Expected: FAIL until the composer is exclusively called from Instagram paths and uses only the resolved persona policy.

- [ ] **Step 3: Apply the minimal isolation correction**

Keep the resolver and composer imports/calls confined to the Instagram orchestrator. Do not add policy handling to shared tenant-runtime instruction generation, WhatsApp, or AI Guide services.

- [ ] **Step 4: Run focused regression tests**

Run: `node --test tests/instagram-media-text-intent-priority.test.js tests/instagram-behavioral-policy-service.test.js`

Expected: PASS.

- [ ] **Step 5: Run required broader verification**

Run: `npm test -- --test-name-pattern="Instagram|WhatsApp|Guide|conversation"`

Expected: the project-supported focused regression command passes without resource-lifecycle warnings. If unavailable or impractical, run the project test command from `package.json` and report the limitation.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check` and inspect changed files. Confirm only Instagram runtime, the new resolver/tests, and the approved spec/plan are changed.
