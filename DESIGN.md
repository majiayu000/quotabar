# QuotaBar design

## Reference and scope

Based on the [Linear analysis from getdesign.md](https://getdesign.md/linear.app/design-md),
[source document](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md).
This is an independent reference, not an official Linear specification.

The user authorized a full UI reconstruction on 2026-09-10, then requested a
softer, more compact native tray. The menu bar and desktop analysis are equally
important, with different information densities. Preserve quota reads, recovery,
filters, session details and exports.

## Shared language

- Use flat surfaces, fine borders and restrained lavender emphasis.
- Give numeric values clear hierarchy; use tabular figures.
- Keep quota warnings semantic. Red and orange indicate constrained quota,
  not a decorative brand palette. Chart colors distinguish data sources.
- Always label remaining versus used quota. The overview bar measures remaining
  capacity; provider detail bars measure used capacity.
- Missing cost is unknown, never zero. Keep estimates distinct from bills and
  keep refresh errors and last successful reads visible.
- Keep focus indicators, keyboard navigation and reduced-motion support.

## Desktop analysis

Use a full-height sidebar, one compact title/action bar, shared scope filters,
a summary strip, charts and record tables. Put records first on detail pages.
Keep data-source diagnostics and settings directly accessible.

| Token | Light | Dark |
| --- | --- | --- |
| Canvas | #f6f7f8 | #010102 |
| Panel | #ffffff | #0f1011 |
| Sidebar | #f0f1f3 | #0b0c0e |
| Text | #23252a | #f7f8f8 |
| Secondary text | #626671 | #a0a4ae |
| Border | #e2e4e8 | #23252a |
| Accent | #5e6ad2 | #929bf3 |

Use the bundled DM Sans font with a Chinese system fallback. Do not distribute
Linear proprietary fonts. Light appearance is an application-specific inverse
palette. Existing theme choices remain accent variants for the quota panel.

## Native tray

Use the macOS system font, soft gray surfaces (#f5f5f7 / #242428), and a single
horizontally scrollable service selector. Avoid a brand header or duplicate
percentages in navigation; keep quota details in accessible labels/tooltips.

Show a continuous quota list with prominent numbers and one compact line for
last successful read and reset time. Keep refresh, usage analysis, settings and
quit together in the footer. There is only one usage-analysis entry.

Content is capped at 580px; the native window adds its 2px border, for a maximum
height of 582px. Short content shrinks naturally, subject to a 300px minimum.
The viewport supports 280–340px widths and keeps content scrollable.

## Implementation

- `src/styles/design-system.css`: shared palette and composition, with scoped
  tray surface/density rules.
- `src/redesign/shell.css`: menu navigation and frame.
- `src/styles/workspace.css`: analysis components, charts and dialogs.
- `src/hooks/use_popover_window.ts`: native height synchronization.

Use existing components and backend contracts. No new UI framework, backend
schema or invented demo data belongs in the application bundle.
