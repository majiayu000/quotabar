# GH-19 Tech Spec: Desktop Widget, Notification, and Preview Assets

## Proposed Design

Treat this issue as documentation/assets first. Runtime widget/notification behavior must be a deliberate follow-up or an explicit expansion of the implementation PR.

## Asset Handling

Use only assets needed by the repo:

- redesign preview screenshot(s)
- no-provider browser preview replacement, if updated
- service icons if licensing/source policy is acceptable

Avoid committing design-tool support files such as `support.js` or full HTML exports unless they are explicitly needed for documentation.

## Documentation

Update docs to state:

- which previews are current app screenshots;
- which previews are static design mocks;
- that no provider credentials, account identifiers, tokens, cookies, or sessions are included;
- how to refresh the screenshots.

Existing files likely involved:

- `README.md`
- `docs/demo-proof.md`
- `docs/assets/*`

## Runtime Notification or Widget Expansion

If this issue is expanded to include runtime notifications:

- choose and configure a Tauri notification capability/dependency explicitly;
- request/check permissions and show denied/unavailable errors;
- deduplicate notifications by provider/window/threshold;
- never notify from missing or demo data;
- add settings only if wired end-to-end.

If this issue is expanded to include a real desktop widget:

- define whether it is a second Tauri window, a platform widget, or an app-owned floating panel;
- specify lifecycle, positioning, hide/show behavior, and interaction with the menubar popover;
- keep provider summary data shared with GH-16.

## Test Plan

- Static/docs diff review for asset paths and captions.
- `npm test` if docs/static changes do not affect code.
- `npx tsc --noEmit && npm test` if frontend code is touched.
- Add Rust checks/tests if Tauri runtime behavior is added.

## Rollback Plan

Revert the GH-19 implementation PR. Because docs/assets should not change runtime behavior by default, rollback is expected to be low risk unless runtime notification/widget code is added.
