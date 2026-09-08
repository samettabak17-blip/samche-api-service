# Auth Reference Visual Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match Login and Customer Invitation to all four authoritative PNG references across mobile and desktop while preserving auth behavior.

**Architecture:** One shared semantic layout keeps a mobile document order and switches to the reference desktop grid at the desktop breakpoint. CSS uses clipped responsive logo framing, variant classes, and measured card/capability geometry; the page remains real accessible React rather than a screenshot implementation.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vite, Vitest, browser viewport inspection.

**Spec:** `docs/superpowers/specs/2026-09-08-whatsapp-channel-typing-auth-acceptance-repair-design.md`

## Global Constraints

- The four PNGs under `docs/design-reference/` are read-only authority.
- Reuse `dashboard/src/assets/branding/samche-company-llc-logo.png` and preserve its aspect ratio.
- Mobile order is logo/hero, compact form, exactly six capabilities, footer.
- Preserve login, forgot-password, invitation validation, and invitation acceptance behavior.

---

### Task 1: Semantic mobile/desktop variants

**Files:**
- Modify: `dashboard/src/features/auth/auth-visual-layout.tsx`
- Modify: `dashboard/src/features/auth/login-page.tsx`
- Modify: `dashboard/src/features/auth/accept-invitation-page.tsx`
- Modify: `dashboard/src/features/auth/auth-visual-comparison.test.tsx`

**Interfaces:**
- Produces: explicit `login`/`invitation` layout variants and responsive capability titles.

- [ ] **Step 1: Write failing semantic tests**

Assert no duplicate invitation logo, exactly six capability items, mobile `Automation` copy, Login mobile-only compact decorations, mandatory invitation company/email context, and unchanged form actions.

- [ ] **Step 2: Run focused Vitest and confirm RED**

Run `npm test -- auth-visual-comparison.test.tsx` from `dashboard`.

- [ ] **Step 3: Implement the minimal semantic layout changes**

Keep one logo in the hero, add variant classes/data attributes, provide desktop/mobile capability labels, and mark optional Login card decoration for responsive hiding.

- [ ] **Step 4: Run focused Vitest and confirm GREEN**

Run the same test.

### Task 2: Reference-measured responsive CSS

**Files:**
- Modify: `dashboard/src/styles/globals.css`
- Modify: `dashboard/src/features/auth/auth-visual-comparison.test.tsx`

**Interfaces:**
- Produces: visible logo scaling, desktop grid/card placement, compact mobile card, laser layering, compact capabilities, and overflow safety.

- [ ] **Step 1: Add failing class-contract tests for the responsive structure**

Assert variant hooks and CSS contracts for clipped logo framing, mobile decoration hiding, two-column desktop grid, two-column mobile capability grid, and responsive sizing with `clamp()`.

- [ ] **Step 2: Run focused test and confirm RED**

Run the auth visual test.

- [ ] **Step 3: Implement CSS from reference measurements**

Use mobile-first spacing for 320–430 px, desktop breakpoint geometry for 1600×983 and 1672×941, isolate and layer the SVG correctly, enlarge/crop the padded logo, and compact fields/gaps without removing accessibility.

- [ ] **Step 4: Run focused test and build**

Run the auth tests and `npm run build` from `dashboard`.

### Task 3: Rendered viewport comparison

**Files:**
- No reference files modified.
- No production fixture data committed.

**Interfaces:**
- Produces: recorded rendered measurements and visual comparison evidence.

- [ ] **Step 1: Render Login at all required widths**

Inspect 320, 375, 384, 390, 393, 414, 430, tablet, 1600×983, and large desktop. Record document width/height, logo/card/capability bounds, order, and overflow.

- [ ] **Step 2: Render Invitation with a local non-production API fixture**

Use a temporary local validation response to render the real page component at 364×620 and 1672×941 without changing production behavior or staging data.

- [ ] **Step 3: Compare screenshots with all four exact PNGs**

Review logo scale, laser geometry, card size/position, hero spacing, capability layout, footer position, clipping, overflow, and remaining variance. Iterate CSS until the comparison supports the final PASS/FAIL claims.

- [ ] **Step 4: Re-run auth behavior and build gates**

Run full Dashboard tests and production build after final visual changes.
