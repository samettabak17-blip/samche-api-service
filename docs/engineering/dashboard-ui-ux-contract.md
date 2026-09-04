# SamChe Dashboard UI/UX Contract

This contract applies to every new or substantially changed Dashboard screen.

## Shared UI Components

- Use `DashboardField`, `DashboardInput`, `DashboardSelect`, `DashboardPasswordInput`, `DashboardTextarea`, `DashboardCheckbox`, `DashboardFormMessage`, and `DashboardButton` for form controls.
- Do not create page-specific replacements for shared Dashboard primitives unless the shared component genuinely cannot support the required behavior.
- Prefer extending the shared primitive instead of duplicating styling across pages.

## Labels, Text and Contrast

- Form labels, helpers, placeholders, disabled text, errors, statuses, and secondary text must remain readable on the dark theme and target WCAG AA contrast.
- Form labels must NEVER use low-contrast ad-hoc muted colors.
- Do not use `stone-500`, `stone-600`, or equivalent low-contrast tones for critical form labels.
- Labels must remain clearly distinguishable from helper text and placeholders.
- Placeholder text may be visually secondary but must remain readable.
- Disabled text may look disabled but must never become effectively invisible.
- Error, success, warning, pending, and informational states must remain readable against their backgrounds.
- Do not rely on color alone to communicate an important state.

## Buttons

- Use the central Dashboard Button variants and sizes.
- Buttons must be compact, balanced, keyboard-focusable, and visually consistent.
- Button labels must remain readable in all states.
- Button text must not unexpectedly wrap.
- Topbar action buttons such as `Create company` must remain single-line on normal desktop layouts.
- Never add page-specific button styling that can make controls oversized, irregular, invisible, or inconsistent.
- Maintain consistent icon size, icon/text gap, height, padding, radius, hover, focus, active, disabled, and loading states.

## Forms and Focus

- Controlled inputs must preserve focus while typing.
- Do not remount fields because their value changes.
- Do not reapply autofocus on ordinary rerenders.
- Validation must not unexpectedly move focus while the user is typing.
- Password visibility controls must not clear values or steal focus.
- Form validation messages must be clear, accessible, and visually consistent.

## Dialogs, Dropdowns and Popovers

- Render dialogs, dropdowns, and popovers through the shared portal/stacking contract.
- Floating UI must remain above page cards and other normal content.
- Do not introduce arbitrary extreme `z-index` values.
- Dialogs must support appropriate focus trapping, focus restoration, Escape behavior, backdrop behavior, and scroll locking.
- Dropdowns and popovers must not be clipped by parent containers.

## Branding and Logo

- Use the canonical SamChe logo assets already present in the project.
- Do not create duplicate or substitute logos unless explicitly approved.
- SamChe branding must remain clearly visible on platform authentication screens.
- Sidebar and authentication logos must not appear excessively small or visually insignificant.
- Preserve logo aspect ratio.
- Canonical favicon must be shared across Dashboard, Login, Accept Invitation, Forgot Password, and Reset Password surfaces.

## Authentication Visual System

The following surfaces must use the same visual language:

- Login
- Accept Invitation
- Forgot Password
- Reset Password
- Change Password / Settings → Security

They must share consistent:

- branding
- typography
- form controls
- labels
- buttons
- surfaces
- colors
- spacing
- password controls
- responsive behavior

Auth screens must not diverge into unrelated page-specific design systems.

## Canonical Visual References

The authoritative visual references for authentication surfaces are:

- `docs/design-references/samche-login-reference.png`
- `docs/design-references/samche-customer-invitation-reference.png`

New work on Login and Customer Invitation / Account Setup screens must preserve the visual direction established by these references unless a new design is explicitly approved.

The reference images are design references only.

Do not implement an entire UI as a screenshot or single background image. Interactive elements must remain real accessible React/UI components.

## Dashboard Visual Style

The SamChe Dashboard should remain:

- modern
- premium
- compact
- professional
- enterprise-oriented
- dark themed
- visually consistent

Use:

- deep black / charcoal surfaces
- SamChe red accents
- controlled gold accents where appropriate
- restrained glow/effects

Avoid:

- excessive neon
- game-like interfaces
- random gradients
- arbitrary colors
- oversized controls
- unnecessary visual clutter
- poor information hierarchy

## Responsive Design

- Check desktop, tablet, and mobile layouts before merging.
- No horizontal overflow.
- No clipped dialogs.
- No hidden labels.
- No overlapping buttons.
- No floating UI behind page content.
- Mobile layouts must prioritize the primary action rather than forcing users through excessive decorative content.

## Accessibility

- Target WCAG AA contrast.
- Maintain visible keyboard focus.
- Associate labels with controls.
- Add appropriate accessible names to icon-only controls.
- Preserve keyboard navigation.
- Use correct disabled and loading semantics.
- Do not remove native accessibility behavior without an equivalent accessible replacement.

## Human Visual Acceptance

Automated test success does not automatically mean visual acceptance.

When interactive browser verification is unavailable, report:

`AUTOMATED PASS — HUMAN VISUAL ACCEPTANCE REQUIRED`

Do not claim visual PASS solely because unit tests or the production build pass.

## Engineering Safety

- UI polish must not change backend behavior, authorization, tenant isolation, invitation lifecycle, SMTP/outbox behavior, WhatsApp behavior, Knowledge Intelligence behavior, CRM behavior, or provider workflows.
- UI work must not introduce database migrations unless explicitly required by a separate approved architecture task.
- Do not weaken authentication or security behavior for visual convenience.

## Mandatory Development Rule

Every future Dashboard feature or modification must comply with this contract.

In particular:

- NEVER ship a low-contrast form label.
- NEVER ship an unreadable helper/status message.
- NEVER ship an oversized or malformed button.
- NEVER allow an ordinary button label to wrap unexpectedly.
- NEVER allow a modal/dropdown/popover to render behind page content.
- NEVER allow controlled-input rerenders to steal focus.
- NEVER introduce page-specific visual primitives when the shared Dashboard system already provides the component.
- NEVER mark UI work visually GREEN without either real visual verification or an explicit human-acceptance requirement.

## Mandatory Contrast and Interactive-State Contract

This rule applies to every label, button, input, select, link, dropdown item,
tab, badge, status control, icon button, and interactive Dashboard element.

### Absolute Contrast Rule

- Text, labels, icons, and controls must remain clearly readable in EVERY state:
  - default
  - hover
  - focus
  - focus-visible
  - active
  - selected
  - disabled
  - loading
  - error
  - success
- A component that is readable only in its default state is NOT considered valid.
- Hover/focus/active styling must never make text or icons disappear into the background.
- Form labels must never use low-contrast or decorative muted colors.
- Critical labels must remain clearly readable on the dark theme at all times.

### Button State Rule

Every shared button variant must define its complete state matrix centrally:

- text color
- icon color
- background color
- border color
- hover background
- hover text
- hover icon
- active background
- active text
- focus ring
- disabled background
- disabled text
- loading state

Never rely on browser defaults or inherited generic hover classes.

### White Hover Is Forbidden Unless Contrast Is Explicitly Preserved

- A dark-theme button must NEVER become white on hover while keeping white,
  light-gray, or otherwise unreadable text/icons.
- If a button intentionally uses a light/white hover background, its hover text
  and icon colors MUST explicitly switch to a sufficiently dark contrasting color.
- Prefer preserving the SamChe dark/red design system rather than switching
  controls to white hover surfaces.
- Generic classes such as `hover:bg-white` must not be used on Dashboard buttons
  unless the matching hover text/icon contrast is explicitly defined and tested.

### SamChe Button Behavior

Primary:
- SamChe red background
- clearly readable light text
- hover remains red/darker-red/lighter-red within the approved palette
- never turns into an uncontrolled white button

Secondary / Outline:
- dark Dashboard surface
- readable light text
- controlled border
- hover uses approved dark/red/gold surface
- text remains readable

Ghost:
- transparent/dark surface
- readable text/icon
- hover uses a visible dark/red-tinted surface
- must never disappear against the page

Destructive:
- destructive/red semantic styling
- readable text in every state

Disabled:
- visually disabled
- still identifiable and readable
- must not become invisible

### Label Rule

Form labels must use the canonical `TEXT_LABEL` / shared label token.

Never use low-contrast classes such as:
- `text-stone-500`
- `text-stone-600`
- equivalent muted/dim tokens

for required or important labels.

Helper text may be visually secondary, but labels must remain stronger than:
- helper text
- placeholders
- disabled text

### Interactive-State Regression Guard

Shared UI tests must verify that critical button and control variants do not
switch to known invalid contrast combinations.

At minimum test:
- primary button hover
- secondary button hover
- outline button hover
- ghost button hover
- destructive button hover
- disabled button
- selected tabs
- dropdown options
- form labels
- password visibility controls
- topbar actions

Do not use brittle pixel-perfect tests.
Test the centralized state classes/tokens and semantic contracts.

### Mandatory Development Rule

NEVER ship a component where:
- a label is difficult to read,
- hover makes text disappear,
- hover makes an icon disappear,
- a button becomes white with unreadable text,
- disabled state becomes invisible,
- focus state reduces readability,
- selected state loses contrast.

If any interactive state violates this rule, the UI task is FAIL even when all
other automated tests pass.
