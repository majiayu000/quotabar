# GH-96 Tech Spec: Launch QuotaBar at login

Linked issue: https://github.com/majiayu000/quotabar/issues/96

## Approach

Register `tauri-plugin-autostart` with `MacosLauncher::LaunchAgent` and no extra argv. The frontend talks to the plugin through `src/services/autostart.ts`, matching the dynamic-import style of `notifications.ts`. Settings owns the switch state; App only receives failure copy for the existing timed toast.

## Files

- `src-tauri/Cargo.toml` / `Cargo.lock` — `tauri-plugin-autostart` 2.5.1
- `src-tauri/src/lib.rs` — plugin init
- `src-tauri/capabilities/default.json` — `autostart:default`
- `package.json` / lockfile — `@tauri-apps/plugin-autostart` 2.5.1
- `src/services/autostart.ts` — typed read/write, fixed failure messages
- `src/components/SettingsView.tsx` — Startup row
- `src/App.tsx` — `onAutostartNotice={showTimedToast}`
- `src/redesign-settings.css` — alert hint color
- `tests/autostart.test.ts`, `tests/autostart_settings.test.tsx`, `tests/panel_shell_ui.test.tsx`
- `CHANGELOG.md`, `README.md`

## Failure copy

- Status read: `Launch at Login status could not be read. The toggle stays off.`
- Update: `Launch at Login could not be updated. The system login item was left unchanged.`

Console errors use the same fixed strings. Do not log the original exception.

## Verification

- `npx vitest run tests/autostart.test.ts tests/autostart_settings.test.tsx tests/panel_shell_ui.test.tsx`
- `npx tsc --noEmit`
- `npm test`
- `cargo check --manifest-path src-tauri/Cargo.toml`
