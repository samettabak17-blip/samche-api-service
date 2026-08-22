# SamChe Dashboard Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the existing dashboard with the official SamChe Company LLC visual system and replace the login presentation with the approved responsive premium split layout without changing authentication behavior.

**Architecture:** Retain the existing semantic Tailwind token names so pages keep their component contracts while their palette changes centrally. Keep login’s existing submit/auth code intact and replace only its JSX presentation and local password visibility state. Use the supplied logo image as an imported asset with no modification.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, React Testing Library, Vitest, Lucide React.

**Spec:** `docs/superpowers/specs/2026-08-22-samche-dashboard-branding-design.md`

## Global Constraints

- Work and commit only on `staging`; do not modify `main`, backend logic, production deployment, or legacy chat/webhook flows.
- Use `dashboard/src/assets/branding/samche-company-llc-logo.png` unchanged; do not crop, redraw, stylize, or replace it.
- Preserve existing login submit behavior, API client, validation, redirect, sessionStorage/JWT handling, and `401 Invalid credentials` rendering.
- Do not add a password recovery feature; the backend does not support it.
- Keep the scope to branding tokens and login presentation, not general Phase 5 layout polish.

---

### Task 1: Brand assets and semantic palette

**Files:**
- Create: `dashboard/src/assets/branding/samche-company-llc-logo.png`
- Modify: `dashboard/tailwind.config.ts`
- Modify: `dashboard/src/styles/globals.css`
- Modify: `dashboard/src/components/ui/mutation-feedback.tsx`
- Modify: `dashboard/src/features/conversations/conversation-utils.ts`

**Interfaces:**
- Consumes: Existing `ink`, `canvas`, `line`, `signal`, and `signal-soft` Tailwind classes.
- Produces: SamChe-red semantic accents and a `gold` Tailwind color available to presentation components.

- [ ] **Step 1: Write failing palette checks**

Create `dashboard/src/features/auth/login-page.test.tsx` with assertions that the rendered login page contains the official logo alternative text and no "Forgot password" control.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- login-page.test.tsx`

Expected: FAIL because the current login page has no official logo image.

- [ ] **Step 3: Add the unchanged official asset and palette**

Copy the supplied PNG to the exact branding path. Change `signal` to the SamChe red, `signal-soft` to a pale red surface, and add `gold`; update focus styling to a red alpha outline. Replace explicit teal/emerald utility choices in the named components with semantic red/gold-neutral equivalents.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- login-page.test.tsx`

Expected: still FAIL until the login view imports and renders the asset.

### Task 2: Responsive premium login presentation

**Files:**
- Modify: `dashboard/src/features/auth/login-page.tsx`
- Test: `dashboard/src/features/auth/login-page.test.tsx`

**Interfaces:**
- Consumes: `useAuth().login(email, password)`, `ApiError`, the official PNG import, and Tailwind semantic tokens.
- Produces: `LoginPage` with the unchanged auth submit contract and local `showPassword: boolean` state.

- [ ] **Step 1: Complete the failing UI test**

Test for the exact three-line headline, required email/password fields, the official image (`alt="SamChe Company LLC"`), a password toggle with `aria-pressed`, and absence of `Forgot password`. Mock `useAuth` and assert that submitting still calls `login` with trimmed email and the entered password.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- login-page.test.tsx`

Expected: FAIL because the existing component lacks the official image, headline, and password visibility control.

- [ ] **Step 3: Implement the approved layout**

Preserve the existing `submit` function and field state. Add only `showPassword` local state. Render the desktop split layout, mobile identity header, exact approved copy, CSS-only abstract background, feature cards, remember-me display, security copy, labelled email/password fields, and red sign-in CTA. Do not render a recovery action.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- login-page.test.tsx`

Expected: PASS; submit behavior and password toggle assertions succeed.

### Task 3: Dashboard brand-mark rebinding and verification

**Files:**
- Modify: `dashboard/src/components/layout/sidebar.tsx`
- Modify: `dashboard/src/components/layout/sidebar.test.tsx` only if its rendered markup assertions require the official image.
- Modify: files from Tasks 1–2 only as required by test output.

**Interfaces:**
- Consumes: official logo import and semantic palette.
- Produces: sidebar brand header using the official asset, while navigation/role behavior is unchanged.

- [ ] **Step 1: Extend or write a sidebar rendering assertion**

Assert that the sidebar displays an image with alternative text `SamChe Company LLC` and retains the existing navigation labels.

- [ ] **Step 2: Run the focused sidebar test to verify it fails**

Run: `npm test -- sidebar.test.tsx`

Expected: FAIL because the sidebar currently uses a generated `S` tile.

- [ ] **Step 3: Replace only the synthetic mark**

Use the official image in the sidebar with an object-fit container; retain all tenant and navigation markup and behavior.

- [ ] **Step 4: Run complete verification**

Run: `npm test`, `npx tsc -b`, and `npx vite build --configLoader runner` from `dashboard/`.

Expected: all tests pass, TypeScript exits zero, and Vite produces `dashboard/dist`.

- [ ] **Step 5: Commit the verified staging change**

Commit only the asset, dashboard source/tests, and branding design/plan documents to `staging` with message `feat(dashboard): apply SamChe branding and login design`.