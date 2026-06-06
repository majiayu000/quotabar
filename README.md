# QuotaBar

<p align="center">
  <img src="src-tauri/icons/app-icon.svg" alt="QuotaBar logo" width="128" />
</p>

QuotaBar is a Tauri v2 menubar app for monitoring Claude Code, Codex, Cursor, and Antigravity usage. It shows live quota windows, per-provider tray indicators, and local cost estimates from on-device logs.

## Features

- Provider switcher: full-name cards for Claude, Codex, Cursor, and Antigravity.
- Claude quota: 5-hour, 7-day, Opus, Sonnet, and Claude Design windows.
- Codex quota: short and weekly ChatGPT usage windows, with reset times shown as days plus hours when available.
- Cursor quota: signed-in Cursor usage and request-limit windows when session data is available.
- Antigravity panel: placeholder provider status while quota tracking is pending.
- Local cost tracking: today, week, and month estimates for Claude Code, Codex, and Cursor.
- Per-provider tray icons: independent menu bar indicators for supported providers.
- Tray controls: enable or hide each tray while keeping at least one entry point.
- Collapsible settings: theme and tray controls live at the bottom of the scrollable panel.
- Background polling: refreshes every 60 seconds, backs off to 5 minutes on 429, and backs off to 1 hour on Claude auth failures.
- Read-only Claude OAuth: reads Claude Code credentials from the correct source, but never refreshes or writes OAuth tokens.
- Hidden-window polling: disables macOS webview throttling so menubar mode keeps working.

## Quota Semantics

- Claude tray value:
  - prefers `weeklyTotal`
  - falls back to max of `weeklyOpus`, `weeklySonnet`, and `weeklyDesign`
  - falls back to current session usage
- Codex tray value:
  - prefers `secondary_window.used_percent`
  - falls back to `primary_window.used_percent`
- Cursor tray value:
  - uses Cursor quota percentage when available
- Antigravity tray value:
  - shows provider availability while usage tracking is pending
- Tray percentages represent used quota, not remaining quota.

## Project Layout

- Frontend:
  - `src/App.tsx`
  - `src/components/*`
  - `src/services/backend.ts`
  - `src/services/service_meta.ts`
  - `src/services/tray_visibility.ts`
  - `src/types/models.ts`
  - `src/utils/*`
- Backend:
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/domain/models.rs`
  - `src-tauri/src/services/claude.rs`
  - `src-tauri/src/services/codex.rs`
  - `src-tauri/src/services/cursor.rs`
  - `src-tauri/src/services/antigravity.rs`
  - `src-tauri/src/services/cost.rs`
  - `src-tauri/src/services/http.rs`
  - `src-tauri/src/services/tray.rs`
  - `src-tauri/src/services/tray_icon.rs`
  - `src-tauri/src/services/window.rs`
- Release notes:
  - `CHANGELOG.md`
  - `docs/release.md`

## Requirements

- macOS or Windows
- Node.js with npm
- Rust toolchain
- Tauri prerequisites installed
- Claude Code login for Claude quota and cost data
- Codex login for Codex quota and cost data
- Cursor sign-in or `CURSOR_SESSION_TOKEN` for Cursor quota data
- Antigravity installed for Antigravity provider status

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm install
npm run tauri build -- --bundles app
```

macOS app bundle output:

`src-tauri/target/release/bundle/macos/QuotaBar.app`

Windows installer output:

`src-tauri/target/release/bundle/msi/`
`src-tauri/target/release/bundle/nsis/`

## Release Artifacts

There is no published GitHub release yet. When a release is cut, build from a clean checkout and attach the generated platform artifact from the paths above to the matching GitHub release tag. See `docs/release.md` for the release checklist.

## Install / Run

macOS:

```bash
./scripts/stop_app.sh
./scripts/install_app.sh
./scripts/run_app.sh
```

Or one-shot restart after rebuild:

```bash
./scripts/reinstall_and_run.sh
```

Windows:

- Build installer: `npm run tauri build -- --bundles msi,nsis`
- Install from the generated `.msi` or `.exe`

## Verification

```bash
npm run build
npm test
cd src-tauri && cargo check
cd src-tauri && cargo test
```

## Limitations

- QuotaBar reads local provider auth state; it does not manage provider login flows.
- Claude quota depends on Claude Code OAuth credentials and Anthropic's current usage response shape.
- Codex quota depends on `~/.codex/auth.json` and ChatGPT usage windows returned by the current backend API.
- Cursor quota requires Cursor sign-in or `CURSOR_SESSION_TOKEN`.
- Antigravity support currently reports provider availability only; quota windows are not exposed yet.
- Cost estimates are derived from local logs and may be empty until provider tools have written usage history.

## Troubleshooting

- Tray icon flashes then disappears:
  - check menu bar manager hidden area, such as Ice or Bartender
  - ensure the app is not auto-grouped into hidden extras
- No Claude quota data:
  - macOS: ensure Claude Code login exists in Keychain with `claude login`
  - Windows/Linux: set `CLAUDE_CODE_OAUTH_TOKEN`
  - if Claude auth fails, re-login with Claude Code and click Refresh
- No Codex quota data:
  - ensure `~/.codex/auth.json` is valid
  - run the `codex` login flow again if the token expired
- No Cursor quota data:
  - sign in to Cursor
  - or set `CURSOR_SESSION_TOKEN`
- Antigravity quota is pending:
  - Antigravity support currently exposes provider status, not quota windows
- Persistent 429 rate limiting:
  - QuotaBar uses a Claude Code user agent and serves stale cached data when available
  - polling backs off to 5 minutes after 429 responses
- Cost data is empty:
  - local logs may not exist yet
  - costs are estimated offline from local Claude/Codex logs via `ccstats`

## Repository Rename

Recommended GitHub repository name: `quotabar`.

After the repository is renamed on GitHub, update local remotes with:

```bash
git remote set-url origin https://github.com/majiayu000/quotabar.git
```

## License

MIT
