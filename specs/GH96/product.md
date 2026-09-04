# GH-96 Product Spec: Launch QuotaBar at login

Linked issue: https://github.com/majiayu000/quotabar/issues/96

## Goals

- Add a Launch at Login toggle under Settings → Activity & system.
- Persist the choice in the OS login item via `tauri-plugin-autostart`, not a new `claude-quota-*` key.
- Fail closed and visibly if status cannot be read or the login item cannot be registered.

## Non-Goals

- Independent Settings window.
- Refresh-interval / Adaptive polling controls.
- Auto-enabling login on first launch without an explicit toggle.
- Changing Hide Dock, tray guards, or notification keys.

## Behavior Invariants

1. `B-001` Settings shows Launch at Login in Activity & system on every desktop platform. The switch reflects the plugin/OS login item, not localStorage.
2. `B-002` First launch does not register a login item. The toggle starts from `isEnabled()`.
3. `B-003` A successful toggle calls enable/disable, then re-reads `isEnabled()`. The switch only moves when that re-read matches the requested state.
4. `B-004` Permission, plugin, or registration failure leaves the previous switch value, shows the fixed error copy in Settings, and surfaces the same copy as a toast. User-visible text never includes OS error strings, paths, or tokens.
5. `B-005` Browser preview (`hasTauriBackend() === false`) keeps the switch off and does not show a status-read error. A preview toggle still fail-closes with the update error.
6. `B-006` Hide Dock stays macOS-only. Launch at Login does not add a storage key or change existing settings keys.

## Acceptance Criteria

- Activity & system contains Launch at Login above Hide Dock.
- Enabling and disabling round-trip through the autostart plugin.
- Failed reads render the switch off with visible copy.
- Failed writes do not flip the switch.
- `npx tsc --noEmit`, `npm test`, and `cargo check --manifest-path src-tauri/Cargo.toml` pass.
