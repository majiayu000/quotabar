# GH-16 Tech Spec: macOS Glass Popover Shell and Provider Overview

## Proposed Design

Build this as the first implementation PR in the UI redesign stack. It should start from `main` or from a branch that already contains any merged prerequisite UI/spec work, but it must not be based on the open PR #15 unless the implementation deliberately becomes a stacked PR.

### App Shell

- Update the React/CSS shell around `src/App.tsx` and `src/styles.css` to provide the glass popover surface.
- Keep the app root transparent so the Tauri popover does not show a white rectangular backing.
- Use CSS custom properties for glass surface, hairline edge, text colors, service accents, and progress colors so later provider detail and settings PRs can reuse the same theme tokens.
- Keep scroll and height behavior compatible with the existing resize cap. The popover should remain usable in a menubar context, not become a full landing page.

### Overview State

- Extend tab state to include `overview` while preserving `TrayServiceName` for actual tray service IDs.
- Tray activation events should still select the concrete provider tab.
- The default tab can remain the saved provider when valid, but a new install should prefer `overview` if that does not disrupt tray activation.
- Persist the new tab value only if it is explicitly supported by the tab storage validation.

### Provider Summary Model

Create a small frontend summary model derived from existing state:

- Claude: `getClaudeTrayUsedPercent(quota)` plus session/weekly reset labels when present.
- Codex/Cursor: callback-reported `usedPercent`, `connected`, and `loading`.
- Antigravity: connected/pending state, with no usage percentage unless a real backend value exists.

The summary model must distinguish:

- `number` usage percentage
- `null` no data
- disconnected/offline
- loading/syncing

No UI path may coerce no-data to `0`.

### Likely Files

- `src/App.tsx`
- `src/components/TabSwitcher.tsx`
- `src/services/service_meta.ts`
- `src/styles.css`
- Potentially `src-tauri/src/services/window.rs` and docs if width/sizing changes.

## Dependency Notes

- GH-17 will reuse the overview summary and glass tokens, so keep names stable and avoid one-off CSS.
- GH-18 will reuse the footer/settings shell, so avoid moving settings into a shape that blocks a settings view.
- GH-19 may reuse the same provider summary data for static preview/widget design.

## Test Plan

- Unit-test pure summary helpers if they are extracted.
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- If Tauri window dimensions/config change: `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo test --manifest-path src-tauri/Cargo.toml`

## Rollback Plan

Revert the GH-16 implementation PR. Because this issue should not change backend contracts, rollback should restore the previous shell/provider switcher without data migration.
