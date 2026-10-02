# Product

## Register

product

## Users and purpose

QuotaBar serves developers using AI coding services. The menu bar and desktop
workspace are equally important: the menu bar answers how much quota remains,
when it resets, and whether a service needs attention; the desktop workspace
supports comparing costs and trends and finding projects and sessions.

## Confirmed direction

QuotaBar is the primary user-facing application in the usage toolchain:
tray, desktop analysis, notifications and settings belong here. The repositories
stay separate. Use the published ccstats SDK for local statistics, deduplication,
pricing and report contracts; it uses agent-sessions for Claude/Codex native
parsing and provenance. Do not copy those parsers or price tables into the UI.

Provider quota percentages remain provider-reported, with freshness and failures
visible. Local API-equivalent usage is a separate measurement, not the account's
bill or an official quota allowance. Provider auth and quota transport stay here.

The existing ccstats desktop is maintained until its source diagnostics,
investigation and device workflows have a verified handover. This direction
does not establish feature parity or authorize removing those workflows.

Use a unified visual language while optimizing each surface for its task.
Keep desktop analysis fully available. Prefer direct task labels over repeated
promotional headings. Use consistent quota terminology, service names, status
colors, and basic controls across both windows.

## Design principles

- Make quota direction and measurement scope explicit.
- Put detailed records first on detail pages; reveal supplementary statistics
  when requested.
- Distinguish missing data from zero, and estimates from subscription bills.
- Preserve source diagnostics, freshness, login recovery, and user control.

## Accessibility and constraints

Keep text readable in light and dark appearances and at the supported minimum
window sizes. Preserve keyboard focus, semantic controls, and reduced motion.
The user authorized a complete UI reconstruction using getdesign.md on
2026-09-10. DESIGN.md records the Linear reference and the application-specific
adaptation. Both surfaces share a flat, precise visual system; keep the existing
quota, source, cost, filtering, recovery, and settings behavior.
