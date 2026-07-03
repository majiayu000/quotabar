# GH-17 Tech Spec: Provider Detail Panels, Resets, Tips, and Cost Cards

## Proposed Design

Implement after GH-16 shell/overview is stable. This work should be a separate implementation PR because it touches shared panel and cost components.

## PR #15 Dependency

GH-17 depends on the Codex reset-credit data contract from PR #15:

- `CodexResetCredits`
- `backend.getCodexResetCredits()`
- `get_codex_reset_credits` Tauri command
- Codex service parser for `wham/rate-limit-reset-credits`

If PR #15 is merged before GH-17 starts, base GH-17 on updated `main`. If PR #15 is still open, choose one explicitly:

- create GH-17 as a stacked PR on `feat/codex-reset-credits`, or
- implement all non-reset-credit detail work and leave Bonus resets disabled behind a clearly documented follow-up.

Do not silently remove the reset-credit fetch or types.

## Detail Panel Structure

Use shared presentational pieces where they reduce duplication:

- provider detail header
- quota section
- quota progress row
- reset timeline row
- tip card
- bonus reset row
- local cost card grid
- empty/offline panel state

Shared components must accept explicit no-data states instead of converting absent data into numeric zero.

## Upcoming Resets

Build a frontend-only timeline from existing provider data:

- Claude session and weekly reset timestamps where present.
- Codex primary/secondary reset timestamps where present.
- Cursor reset timestamp where present.
- Antigravity pending state omitted unless real reset data exists later.

Timeline rows should sort by reset time and omit invalid/missing timestamps.

## Smart Tips

Tips should be conservative:

- show only for real high-usage thresholds, such as a row over an agreed threshold;
- hide when data is missing or provider is disconnected;
- avoid implying routing advice when the app cannot know available alternatives.

## Local Cost Cards

`CostSummarySection` should keep the existing backend contract and refresh behavior:

- active-provider fetch only where currently intended;
- forced refresh on manual refresh;
- string errors preserved;
- cached state visible.

## Likely Files

- `src/components/ClaudePanel.tsx`
- `src/components/CodexPanel.tsx`
- `src/components/CursorPanel.tsx`
- `src/components/AntigravityPanel.tsx`
- `src/components/QuotaCard.tsx`
- `src/components/CostSummarySection.tsx`
- `src/types/models.ts`
- `src/services/backend.ts`
- `src/styles.css`

## Test Plan

- Unit-test pure timeline/sorting/tip helpers if extracted.
- Unit-test string error preservation if `CostSummarySection` is changed.
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- If backend reset-credit code is touched: `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo test --manifest-path src-tauri/Cargo.toml`

## Rollback Plan

Revert the GH-17 implementation PR. If it is stacked on PR #15, rollback must preserve the reset-credit branch and only remove detail redesign changes.
