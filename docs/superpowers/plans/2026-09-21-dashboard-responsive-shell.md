# Dashboard Responsive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a canonical Dashboard responsive shell that keeps all controls usable without page-level horizontal overflow.

**Architecture:** The authenticated shell owns dynamic viewport and safe-area sizing, while the topbar moves dense workspace actions to an accessible action surface below the wide desktop breakpoint. Live Support receives its own responsive layout token so its canonical provider state remains unchanged while the UI adapts.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-09-21-dashboard-responsive-shell-design.md`

## Global Constraints

- Preserve tenant authorization, tenant isolation, owner-only permissions, API behavior, handoff/realtime semantics, and all existing Dashboard routes.
- Use no device-name/user-agent conditions, JavaScript viewport hacks, or global `overflow-x` masking.
- Retain direct owner actions at wide desktop widths; provide every hidden compact-width action in the workspace action surface.
- The page must fit 320, 360, 375, 390, 393, 414, 430, 768, 820, 1024 and 1280 pixel viewports.
- Use shared Dashboard primitives and preserve accessible focus, labels, Escape behavior, and focus restoration.

## Review Focus

- Long workspace name: must truncate safely without moving notification or action controls outside 320px.
- OWNER action availability: Upgrade requests, Create company and Assign customer must remain reachable below the desktop breakpoint.
- CUSTOMER action availability: workspace identity, tenant selection and sign-out must remain reachable without owner controls.
- Live Support with a multi-digit count and blocked audio: status and sound controls must wrap without page overflow.
- Dialog/drawer under dynamic viewport: safe-area-aware bounds must fit the available mobile viewport and retain internal scrolling.

---

### Task 1: Establish the shared responsive shell contract

**Files:**
- Modify: `dashboard/src/styles/globals.css`
- Modify: `dashboard/src/components/layout/app-shell.tsx`
- Modify: `dashboard/src/components/layout/responsive-contract.test.tsx`

**Interfaces:**
- Produces: `dashboard-shell`, `dashboard-mobile-drawer`, and `dashboard-main-content` structural class contracts.
- Consumes: existing `AppShell` navigation and `Sidebar` props unchanged.

- [ ] **Step 1: Write the failing responsive contract assertions**

```tsx
expect(screen.getByTestId('dashboard-shell')).toHaveClass('dashboard-shell');
expect(readGlobalStyles()).not.toMatch(/overflow-x:\s*hidden/);
expect(readGlobalStyles()).toMatch(/100dvh/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run src/components/layout/responsive-contract.test.tsx`

Expected: FAIL because the test identifiers and no-masking contract do not yet exist.

- [ ] **Step 3: Implement structural containment and dynamic viewport sizing**

```tsx
<div data-testid="dashboard-shell" className="dashboard-shell bg-canvas lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
  <div className="min-w-0">...</div>
</div>
```

```css
.dashboard-shell { min-height: 100vh; min-height: 100dvh; inline-size: 100%; }
.dashboard-main-content { min-width: 0; padding-bottom: max(1.25rem, env(safe-area-inset-bottom)); }
```

- [ ] **Step 4: Run the focused shell contract tests**

Run: `npm test -- --run src/components/layout/responsive-contract.test.tsx src/components/layout/app-shell.test.tsx`

Expected: PASS with navigation drawer, safe-area and page-width assertions satisfied.

### Task 2: Build the responsive topbar action surface

**Files:**
- Modify: `dashboard/src/components/layout/topbar.tsx`
- Modify: `dashboard/src/components/layout/topbar.test.tsx`
- Modify: `dashboard/src/components/layout/responsive-contract.test.tsx`

**Interfaces:**
- Produces: the `Workspace actions` dialog trigger and its compact action surface.
- Consumes: existing `setPlanReviewOpen`, `setCreateOpen`, `setAssignOpen`, `onSelectTenant`, and `onLogout` handlers.

- [ ] **Step 1: Write failing tests for compact action reachability**

```tsx
await user.click(screen.getByRole('button', { name: 'Workspace actions' }));
expect(screen.getByRole('dialog', { name: 'Workspace actions' })).toBeTruthy();
expect(screen.getByRole('button', { name: 'Upgrade requests' })).toBeTruthy();
expect(screen.getByRole('button', { name: 'Create company' })).toBeTruthy();
expect(screen.getByRole('button', { name: 'Assign customer' })).toBeTruthy();
```

- [ ] **Step 2: Run the focused topbar tests to verify they fail**

Run: `npm test -- --run src/components/layout/topbar.test.tsx src/components/layout/responsive-contract.test.tsx`

Expected: FAIL because no compact workspace action surface exists.

- [ ] **Step 3: Move compact-width actions into the shared modal**

```tsx
<button aria-label="Workspace actions" onClick={() => setWorkspaceActionsOpen(true)} />
<Modal open={workspaceActionsOpen} title="Workspace actions" onClose={() => setWorkspaceActionsOpen(false)}>
  <select aria-label="Selected tenant" value={selectedTenantId} onChange={...} />
  {systemRole === 'OWNER' && <DashboardButton onClick={() => setPlanReviewOpen(true)}>Upgrade requests</DashboardButton>}
</Modal>
```

Keep compact trigger visibility below the wide-desktop breakpoint and direct owner controls at that breakpoint and above. Close the action surface before opening a nested mutation dialog.

- [ ] **Step 4: Run topbar and responsive contract tests**

Run: `npm test -- --run src/components/layout/topbar.test.tsx src/components/layout/responsive-contract.test.tsx`

Expected: PASS with owner/customer action sets, title truncation and notification access covered.

### Task 3: Make Live Support and shared dialogs responsive

**Files:**
- Modify: `dashboard/src/features/live-support/live-support-attention-provider.tsx`
- Modify: `dashboard/src/features/live-support/live-support-attention-provider.test.tsx`
- Modify: `dashboard/src/components/ui/modal.tsx`
- Modify: `dashboard/src/components/layout/responsive-contract.test.tsx`

**Interfaces:**
- Produces: `live-support-indicator` responsive semantic structure and safe-area-bounded `Modal` surfaces.
- Consumes: `LiveSupportAttentionProvider` context fields unchanged.

- [ ] **Step 1: Write failing fit and state-preservation assertions**

```tsx
expect(screen.getByRole('status')).toHaveClass('live-support-indicator');
expect(screen.getByRole('link', { name: /customers waiting/i })).toBeTruthy();
expect(screen.getByRole('button', { name: 'Mute' })).toBeTruthy();
```

- [ ] **Step 2: Run focused Live Support and dialog tests to verify failure**

Run: `npm test -- --run src/features/live-support/live-support-attention-provider.test.tsx src/components/layout/responsive-contract.test.tsx`

Expected: FAIL because the semantic responsive classes are absent.

- [ ] **Step 3: Add compact grid/stack and dynamic dialog bounds**

```tsx
<div role="status" className="live-support-indicator">
  <Link className="live-support-indicator__primary" ... />
  <div className="live-support-indicator__controls" ... />
</div>
```

```tsx
<section className="... max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] ...">
```

- [ ] **Step 4: Run focused Live Support, modal and responsive tests**

Run: `npm test -- --run src/features/live-support/live-support-attention-provider.test.tsx src/components/layout/responsive-contract.test.tsx`

Expected: PASS with unchanged attention-state behavior and bounded responsive markup.

### Task 4: Lock the permanent viewport regression matrix

**Files:**
- Modify: `dashboard/src/components/layout/responsive-contract.test.tsx`
- Modify: `docs/engineering/dashboard-ui-ux-contract.md`

**Interfaces:**
- Produces: exported `DASHBOARD_RESPONSIVE_VIEWPORTS` and documented Dashboard responsive release contract.

- [ ] **Step 1: Write failing matrix coverage tests**

```tsx
expect(DASHBOARD_RESPONSIVE_VIEWPORTS).toEqual([320, 360, 375, 390, 393, 414, 430, 768, 820, 1024, 1280]);
for (const width of DASHBOARD_RESPONSIVE_VIEWPORTS) {
  expect(isPageWidthWithinViewport({ scrollWidth: width, clientWidth: width })).toBe(true);
}
```

- [ ] **Step 2: Run the regression contract test to verify failure**

Run: `npm test -- --run src/components/layout/responsive-contract.test.tsx`

Expected: FAIL because the canonical matrix/helper and full assertions are absent.

- [ ] **Step 3: Add the matrix, deterministic geometry helper and documentation**

```tsx
export const DASHBOARD_RESPONSIVE_VIEWPORTS = [320, 360, 375, 390, 393, 414, 430, 768, 820, 1024, 1280] as const;
export const isPageWidthWithinViewport = ({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) => scrollWidth <= clientWidth;
```

Document that shared Dashboard surfaces must use shell containment, responsive action surfaces and dialog-safe bounds; local tables may explicitly scroll, but pages cannot.

- [ ] **Step 4: Run all Dashboard responsive tests**

Run: `npm test -- --run src/components/layout/responsive-contract.test.tsx src/components/layout/topbar.test.tsx src/components/layout/app-shell.test.tsx src/features/live-support/live-support-attention-provider.test.tsx`

Expected: PASS.

### Task 5: Verify the release candidate

**Files:**
- Verify: modified Dashboard files and their task-scoped diff.

- [ ] **Step 1: Run the Dashboard test suite**

Run: `npm test`

Expected: PASS without forced process termination.

- [ ] **Step 2: Run the Dashboard production build**

Run: `npm run build`

Expected: PASS and produce the Vite build.

- [ ] **Step 3: Inspect the final diff and whitespace**

Run: `git diff --check` and `git diff -- dashboard/src docs/engineering/dashboard-ui-ux-contract.md docs/superpowers`

Expected: no whitespace errors and only approved task files.

- [ ] **Step 4: Commit and push task-scoped changes**

Run: `git add <approved files>`, `git commit -m "fix(dashboard): restore responsive application shell"`, then `git push origin staging`.

Expected: local `HEAD` equals refreshed `origin/staging` after the push.

- [ ] **Step 5: Verify the deployment and health**

Run the repository's documented staging deployment verification and health check, then compare the deployed source revision to the pushed commit.

Expected: exact deployed revision and HTTP 200 health response; otherwise report the verification limitation without claiming release completion.
