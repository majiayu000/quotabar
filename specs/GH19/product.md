# GH-19 Product Spec: Desktop Widget, Notification, and Preview Assets

Linked issue: https://github.com/majiayu000/quotabar/issues/19

## Goals

- Bring the redesign package's desktop widget, notification mock, menu bar state, and no-provider preview into the repository as clear product/design assets.
- Update documentation previews to reflect the new UI direction while preserving the no-secret demo proof contract.
- Explicitly separate static preview/mock assets from runtime desktop widget or native notification functionality.
- Document how screenshots/assets were captured or generated so they can be refreshed.

## Non-Goals

- Do not implement a real macOS desktop widget, second Tauri window, or native notification scheduler unless this issue is explicitly expanded in a later implementation PR.
- Do not add account identifiers, tokens, cookies, sessions, or real private usage data to committed screenshots.
- Do not change quota/cost business logic.
- Do not present widget or notification mocks as shipped runtime features.

## Acceptance Criteria

- README/docs show redesign-aligned preview assets with clear captions and privacy scope.
- Assets are stored under stable, intentional paths and exclude unused export clutter.
- If desktop widget/notification remain mocks, docs say they are previews, not current runtime features.
- The old red-marked header treatment from `uploads/pasted-1783093579022-0.png` is not used as target UI.
- Preview image(s) contain no secrets and no fake live account data.
- If runtime notifications are later included under this issue, denied/unavailable permission states are visible and errors are not silently swallowed.

## Verification

- `npm test` or documented static/docs verification.
- If runtime Tauri notification/window code is added: `cargo check --manifest-path src-tauri/Cargo.toml`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npx tsc --noEmit`, and `npm test`.
