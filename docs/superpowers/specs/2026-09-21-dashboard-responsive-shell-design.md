# Dashboard Responsive Shell Design

## Goal

Restore a robust, shared Dashboard mobile experience without removing any
owner, tenant, notification, navigation, or live-support capability. The
Dashboard page itself must fit every supported viewport; only deliberately
data-dense inner regions may scroll horizontally.

## Scope and non-goals

This change covers the authenticated Dashboard shell, topbar, mobile
navigation/actions, Live Support status indicator, shared dialog bounds, and
their regression contracts. It does not change tenant authorization, APIs,
handoff state, messaging, routing, WebChat, WhatsApp, AI Guide, Knowledge
Intelligence, CRM, or product workflows. It does not use tenant or
device-specific branches, viewport JavaScript hacks, or global overflow
clipping as a visual fix.

## Root cause

The owner-only actions introduced in commit `0d84806` are permanently mounted
in the topbar next to notification and sign-out controls. Their
`topbar-action` token forces `white-space: nowrap` and `flex-shrink: 0`, while
the topbar's right group also cannot shrink. At narrow widths that creates a
row wider than the viewport. Commit `579ab18` added `overflow-x: hidden` to
the page and shell, which prevents visible scrolling but does not give those
controls a valid layout. The Live Support outer row wraps, but its primary
inline row remains indivisible and can still compete with its sound controls.

## Responsive shell contract

The canonical authenticated shell owns viewport sizing, safe-area spacing and
normal flow containment. It uses progressive CSS sizing (`100vh` fallback,
then `100dvh`) and safe-area inset tokens for its mobile drawer and content
edges. Shell children use `min-width: 0`; page-level components must size to
their available inline space. `html`, `body`, and the shell must not mask
horizontal overflow. A regression test must detect any page-level width that
exceeds its viewport.

Modals use the same dynamic viewport strategy and safe-area-aware insets, so
they remain fully reachable when browser chrome changes or a mobile keyboard
is open. Dialog content scrolls internally when necessary; the page behind it
does not acquire a horizontal scrollbar.

## Topbar and mobile action model

At wide desktop widths, the existing direct topbar actions remain visible.
Below the wide-desktop action breakpoint, the topbar exposes a compact,
accessible workspace-actions control beside the always-available notification
button and mobile navigation trigger. The actions surface contains the current
workspace identity and tenant selector, owner-only Upgrade requests, Create
company and Assign customer actions, plus sign-out. It opens through the
shared accessible dialog primitive, restores focus on close, and never drops
an action based on tenant, role, or viewport.

The title and workspace identity use available-space sizing and safe
truncation. The action surface is a responsive replacement for a dense action
row rather than a CSS-hidden feature. Search and date controls retain their
current progressively enhanced wide-screen behavior.

## Live Support component

`GlobalLiveSupportIndicator` is a shared status component. Its customer
waiting state remains the primary, linked action. At phone widths, its title,
count and sound preferences use a compact grid/stack with independent
wrapping and usable touch targets. At wider widths it retains a balanced
single-row presentation. The count, notification badge and existing provider
state remain derived from the same canonical attention context.

## Verification contract

Automated responsive tests cover 320, 360, 375, 390, 393, 414, 430, 768, 820,
1024 and 1280 pixel viewports. They assert no global horizontal overflow;
reachable mobile navigation, notifications and workspace actions; owner action
availability; safely bounded modal/drawer behavior; Live Support fit; and the
wide desktop action model. Contract tests also protect the absence of global
overflow masking and require safe-area/dynamic-viewport primitives. Existing
Dashboard topbar, shell and Live Support tests remain intact.

Real-browser checks, including iOS Safari and Android Chrome toolbar/keyboard
behavior, remain a human visual acceptance gate when an authenticated staging
session is not available to automated tests.
