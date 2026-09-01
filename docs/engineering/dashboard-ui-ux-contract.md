# SamChe Dashboard UI/UX Contract

This contract applies to every new or substantially changed Dashboard screen.

- Use `DashboardField`, `DashboardInput`, `DashboardSelect`, `DashboardPasswordInput`, `DashboardTextarea`, `DashboardCheckbox`, `DashboardFormMessage`, and `DashboardButton` for form controls.
- Form labels, helpers, placeholders, disabled text, errors, and statuses must remain readable on the dark theme and target WCAG AA contrast. Do not use ad-hoc muted label colors.
- Use the central Button variants and sizes. Buttons are compact, keyboard-focusable, and `nowrap`; never add page-specific button styling that can wrap or hide the label.
- Render dialogs, dropdowns, and popovers through the shared portal/stacking contract. They must remain above page cards without arbitrary extreme z-index values.
- Controlled inputs must preserve focus while typing; do not remount fields or reapply autofocus on ordinary rerenders.
- Check desktop, tablet, and mobile layouts plus keyboard interaction before merging.
- UI polish must not change backend behavior, authorization, tenant isolation, or provider workflows.
