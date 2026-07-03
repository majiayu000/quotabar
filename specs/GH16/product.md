# GH-16 Product Spec: macOS Glass Popover Shell and Provider Overview

Linked issue: https://github.com/majiayu000/quotabar/issues/16

## Goals

- Make QuotaBar's main popover match the redesign package's macOS glass shell: translucent surface, blur/saturation, 16px-class radius, hairline edge, highlight overlay, and dense menubar-app spacing.
- Add an overview-first provider experience that summarizes Claude, Codex, Cursor, and Antigravity before drilling into a provider detail panel.
- Show provider identity with stable service metadata: icon or initials, brand color, status, usage percentage, and empty/offline state.
- Preserve current QuotaBar behavior: tray activation switches tabs, manual refresh targets the active provider, dashboard opens the active provider, quit still exits the app, and tray visibility guard still prevents disabling every tray.

## Non-Goals

- Do not implement detailed provider quota rows, upcoming resets, tips, local cost redesign, settings view, desktop widget, or notification runtime behavior in this issue.
- Do not change backend quota, cost, tray, or auth response contracts.
- Do not seed demo usage values in production UI. Missing data must render as blank, offline, pending, or `--`, not `0%`.
- Do not remove or regress PR #15 Codex reset credits. This issue may ship before #15, but it must not make the later Bonus resets integration harder.

## Acceptance Criteria

- The app shell visually matches the redesign direction in light and dark themes without a solid white rectangular background.
- Provider navigation includes an `Overview` state plus Claude, Codex, Cursor, and Antigravity.
- Provider summary tiles display real connected/loading/offline status and a real usage percentage when available; no-data states do not invent values.
- The overview lists the most constrained real quota windows, sorted by highest used percentage, with provider/window label, percent, and reset text when available.
- Existing provider panels still open from provider selection without losing current quota, cost, loading, retry, or error behavior.
- Browser preview without a Tauri backend still communicates backend-unavailable state and does not show fake provider usage.
- If the popover width changes from the current 320px toward the redesign's 340px shell, Tauri window sizing and preview docs are updated consistently.

## Verification

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- If Tauri sizing/window code changes: `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo test --manifest-path src-tauri/Cargo.toml`
- Attach a browser or Tauri screenshot to the implementation PR.
