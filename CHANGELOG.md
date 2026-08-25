# Changelog

All notable QuotaBar changes should be summarized here before a release is cut.

## Unreleased

- Added Grok Build quota tracking: SuperGrok weekly/monthly pool, product mix, extra credits, and a per-provider tray.
- Estimate SuperGrok pool USD value from Grok's own `costUsdTicks` on completed turns, scaled by the official used percent.
- Added Codex weekly API-equivalent USD and token estimates from the ccstats SDK,
  while keeping estimate failures isolated from official quota and pace data.
- Show the Codex weekly value estimate against the official 7-day window even
  when the local CLI snapshot reports 0% or lives in the primary slot.
- Preserve over-limit Cursor usage while deriving truthful reset dates, normalize only the tray IPC boundary,
  cache generated tray PNGs, and stop Overview cost work while the popover is hidden.

## 0.3.1 - 2026-08-22

- Added a validated Codex weekly quota pace projection, including projected usage at reset, risk status, and estimated depletion time from the ccstats SDK.
- Kept weekly pace failures isolated from official Codex quota data and rejected stale, cross-window, or divergent local snapshots instead of displaying misleading projections.
- Hardened concurrent Codex refreshes and account-scoped quota caching against stale or partial state.
- Made provider switcher transitions transactional and reduced unnecessary forced tray icon resynchronization.
- Reduced repeated local cost parsing with multi-range summaries and cached snapshots.
- Updated the application version to 0.3.1 and refreshed macOS and Windows release artifacts.

## 0.3.0 - 2026-07-17

- Surfaced settings storage read and write failures instead of silently degrading, including background-write failures.
- Prevented stale provider refreshes from overwriting newer state and made popover visibility failures observable and fail closed.
- Committed notification deduplication only after delivery and kept fatal frontend diagnostics safe and observable.
- Removed sensitive Claude credential fragments from diagnostics, unused Codex stats wiring, and the obsolete priority price override.
- Split legacy and redesigned stylesheets into smaller modules without changing their rendered output.
- Created the annotated v0.3.0 source tag. No GitHub Release artifacts were published for this tag.

## 0.2.0 - 2026-07-06

- Added an artifact-only GitHub Actions workflow for macOS and Windows release bundle inspection.
- Added SECURITY, CONTRIBUTING, and CODE_OF_CONDUCT files for public project readiness.
- Replaced the disabled Tauri CSP with a restricted policy for bundled UI assets and IPC.
- Clarified first-release gates, source-build fallback, and the no-auto-publish release boundary.
- Reduced local cost refresh work by using ccstats multi-range summaries for Today, This Week, and This Month in one pass.
- Added a browser-preview demo proof screenshot and documented its no-credential capture scope.
- Report an explicit desktop-backend-unavailable error when the UI is opened outside Tauri.
- Added CI coverage for frontend tests, frontend build, Rust formatting, Rust check, and Rust tests.
- Added GitHub issue templates and a pull request template.
- Documented release artifact paths and current limitations.
- Existing application version. Historical release notes were not tracked before this changelog.
