# QuotaBar

<p align="center">
  <img src="src-tauri/icons/app-icon.svg" alt="QuotaBar logo" width="128" />
</p>

QuotaBar is a Tauri v2 menubar app for monitoring Claude Code and Codex usage. It shows live quota windows, dual tray indicators, and local cost estimates from on-device logs.

## Features

- Claude quota: 5-hour, 7-day, Opus, Sonnet, and Claude Design windows.
- Codex quota: short and weekly ChatGPT usage windows.
- Local cost tracking: today, week, and month estimates for Claude Code and Codex.
- Dual tray icons: independent Claude and Codex menu bar indicators.
- Tray controls: enable or hide each tray while keeping at least one entry point.
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
- Tray percentages represent used quota, not remaining quota.

## Project Layout

- Frontend:
  - `src/App.tsx`
  - `src/components/*`
  - `src/services/backend.ts`
  - `src/types/models.ts`
- Backend:
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/domain/models.rs`
  - `src-tauri/src/services/claude.rs`
  - `src-tauri/src/services/codex.rs`
  - `src-tauri/src/services/cost.rs`
  - `src-tauri/src/services/tray.rs`
  - `src-tauri/src/services/tray_icon.rs`
  - `src-tauri/src/services/window.rs`

## Requirements

- macOS or Windows
- Node.js with npm
- Rust toolchain
- Tauri prerequisites installed
- Claude Code login for Claude quota and cost data
- Codex login for Codex quota and cost data

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
