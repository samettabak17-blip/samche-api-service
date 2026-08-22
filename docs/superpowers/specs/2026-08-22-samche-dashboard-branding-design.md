# SamChe Dashboard Branding Design

## Scope

Apply the official SamChe Company LLC visual identity to the existing dashboard application, with a premium responsive login experience as the primary interface update. This is presentation-only work: authentication, session persistence, API calls, validation semantics, backend behavior, and deployment configuration remain unchanged.

## Brand system

The official supplied image will be stored as `dashboard/src/assets/branding/samche-company-llc-logo.png` and rendered unchanged wherever the dashboard needs a primary brand mark. No drawn replacement, crop, generated mark, or text substitute is permitted.

Tailwind semantic tokens will replace the existing teal/turquoise values:

| Token | Purpose |
| --- | --- |
| `ink` | near-black graphite type and dark surfaces |
| `canvas` | warm off-white application background |
| `line` | warm neutral borders |
| `signal` | SamChe red for primary actions and controlled emphasis |
| `signal-soft` | pale red-tinted contextual surface |
| `gold` | restrained premium secondary emphasis |

The existing semantic token names remain so established dashboard components inherit the new palette without introducing a competing design system. Error and success states retain their conventional semantic red/green treatment.

## Login layout

At desktop width the login page is a full-height split composition:

- The left branding panel has a graphite-black layered background, the official logo, red platform label, the exact three-line headline “AI OPERATIONS. / SMARTER. / STRONGER.”, a concise product statement, and four compact feature cards.
- The background visual is CSS-built abstract lighting, rings, and a dotted field. It provides technological depth but is not a logo, image recreation, or customer-facing product graphic.
- The right panel is a dark secure sign-in surface with a contained card, labelled fields, password visibility toggle, remember-me presentation, red primary CTA, and static workspace-security copy.
- There is no Forgot Password control because the current backend contract provides no recovery flow.

The existing email/password values, required inputs, submit handler, disabled submission state, API error rendering, `401 Invalid credentials` behavior, redirect, and session management stay intact. The visible password control changes only the input `type` locally.

## Responsive behavior

- Desktop (`lg` and above): two balanced panels; the full feature-card set and background visual remain visible.
- Tablet: compact branding area remains above or alongside the form according to available space; feature cards reduce to a two-column grid.
- Mobile: one-column secure sign-in page; logo, platform label, headline, and a minimal identity message remain, while decorative field and feature cards are removed to maintain focus and performance.

All focus states retain high contrast. Inputs, checkbox, and password toggle receive descriptive labels. The password toggle exposes its current state through `aria-label` and `aria-pressed`.

## Dashboard-wide impact

Existing pages continue to use their current layouts and functionality. Rebinding the semantic Tailwind tokens changes inherited accents in navigation, panels, empty states, conversation selections, and settings to the SamChe red/graphite/gold system. Any remaining explicit teal/emerald detail will be replaced with semantic red/gold-neutral styling. This does not add dashboard features or modify tenant/role behavior.

## Tests and verification

Add or update login UI tests to confirm the existing form still submits, API errors remain visible, required fields remain present, the password visibility toggle works, the unsupported password-recovery action is absent, and the official image asset is rendered with meaningful alternative text. Run the dashboard unit suite, TypeScript project check, and Vite production build. Commit only to `staging`; do not alter `main`, backend logic, or production deployment.