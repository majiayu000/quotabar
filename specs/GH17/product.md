# GH-17 Product Spec: Provider Detail Panels, Resets, Tips, and Cost Cards

Linked issue: https://github.com/majiayu000/quotabar/issues/17

## Goals

- Redesign active provider detail panels to match the package's main view: provider header, plan/status, quota sections, progress rows, reset copy, smart tips, upcoming resets, and local cost cards.
- Preserve current provider semantics for Claude, Codex, Cursor, and Antigravity.
- Present Codex rate-limit reset credits from PR #15 as the design's Bonus resets/Gifted section.
- Keep local cost summaries for Claude, Codex, and Cursor, while making unsupported Antigravity cost/quota states explicit.

## Non-Goals

- Do not change ccstats calculations, pricing policy, auth handling, or backend response shapes except where PR #15 already adds reset credits.
- Do not implement the settings view, tray controls redesign, desktop widget, or native notifications.
- Do not silently hide backend/frontend errors.
- Do not directly overwrite current `CodexPanel.tsx` with the zip snapshot, because that snapshot is based on `origin/main` and would remove PR #15 reset credits.

## Acceptance Criteria

- Claude, Codex, Cursor, and Antigravity detail panels use the redesign visual structure while retaining their current loading, error, retry, and no-data behavior.
- Codex Bonus resets shows available reset credits from PR #15 with available count, available-only filtering, title fallback, expiry text, and stable expiry ordering.
- Generic Codex credits and Bonus resets remain separate concepts in the UI.
- Upcoming resets uses real reset timestamps from provider data where available and omits unsupported rows.
- Smart tips are derived from real high-usage states or are hidden; no demo copy appears in production for missing data.
- Local cost cards keep Today, This Week, and This Month semantics and continue to display cached/error/loading states correctly.
- Missing quota/cost data renders as blank, offline, pending, or `--`, not fake `0%`.

## Verification

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- If PR #15 backend contracts are included or modified: `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo test --manifest-path src-tauri/Cargo.toml`
- Manual check with Codex reset credits data if available, or mocked frontend fixture without exposing tokens/account data.
