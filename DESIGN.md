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

The 2026-09-14 approved concept adopts Codenotch's progressive disclosure in a
menu bar popover. Use the macOS system font, graphite (#25282b) or soft gray
surfaces, teal quota capacity, and amber/red warnings. The overview has a small
QuotaBar header with Settings, followed by one section per visible account.

Each account keeps its name and detail action on a separate header row, followed
by a 64px provider ring and a 33px headline percentage. Quota-window bars and reset
times use separate rows, preserving the original approved spacious composition.
All overview readings follow the saved
remaining/used preference (remaining by default). The headline follows the most
constrained window and names it explicitly when weekly detail is hidden. Missing data has no fill;
stale data is dimmed, explicitly marked, and links to recovery. Pending provider
detection remains visible until it completes.

The overview is intentionally limited to quota readings, reset times and read/recovery
states. Provider details start directly with quota and usage content, without a
repeated account-identity header. Plans, estimates and bonus information remain
in their respective detail sections.

Provider details retain all quota windows, pace, account data, bonus grants, local
estimates, costs and trends. The overview and provider details share the provider selector beneath the QuotaBar
header, and the compact action bar. Account rows also open provider details.
The selector uses a transparent single row of small icons and labels, with a thin
teal underline for the active page. It does not change the spacious overview
composition. Narrow windows show text-only tabs to retain readable labels. Detail cards use the same type scale,
spacing and palette; only the amount of information changes.
Detail quota readings retain used-quota semantics. The overview footer contains
refresh/read time, one analysis entry, and Quit.
Settings use Display, Alerts and Accounts pages in both windows. Theme choices
and reference budgets are collapsed; existing notification thresholds and native
menu bar used-quota semantics remain explicit.

Content is capped at 580px; the native window adds its 2px border, for a maximum
height of 582px. Short content shrinks naturally, subject to a 300px minimum.
The viewport supports 280–340px widths and keeps content scrollable.

## Implementation

- `src/styles/design-system.css`: shared palette and composition, with scoped
  tray surface/density rules.
- `src/redesign/shell.css`: menu navigation and frame.
- `src/styles/workspace.css`: analysis components, charts and dialogs.
- `src/hooks/use_popover_window.ts`: native height synchronization.
- `src/styles/compact.css`: shared tray navigation, actions, account cards and settings;
  imported last in `main.tsx`, after legacy styles.
- `src/components/QuotaOverview.tsx`: account readings and state presentation.

Use existing components and backend contracts. No new UI framework, backend
schema or invented demo data belongs in the application bundle.

Quota progress uses one solid-color helper across overview and details, with
warning at 80% used and critical at 95% used, independent of remaining/used display.
