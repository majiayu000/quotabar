# Contributing to QuotaBar

QuotaBar is a Tauri v2 desktop app with a React frontend and Rust backend. Keep
changes focused on quota visibility, local cost visibility, tray behavior,
release readiness, or clear documentation gaps.

## Setup

```bash
npm ci
npm run tauri dev
```

Requirements:

- macOS or Windows for desktop runtime work.
- Node.js with npm.
- Rust stable toolchain.
- Tauri prerequisites for the target platform.

## Verification

Run these before opening a pull request:

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

For release or installer changes, also run:

```bash
npm run tauri build -- --bundles app
```

Use `docs/release.md` for release artifact work.

## Security and Data Rules

- Do not commit provider tokens, cookies, session files, API keys, or local auth
  material.
- Do not paste real provider account identifiers into tests, docs, issues, or
  screenshots.
- Missing provider data should render unavailable/blank/error states, not fake
  zero usage.
- If a change touches auth state, release artifacts, Tauri permissions, CSP,
  opener behavior, or notifications, call that out in the PR.

## Pull Requests

- Link the GitHub issue or SpecRail packet when one exists.
- Keep UI copy honest about provider limitations and pending support.
- Update README, docs, tests, and changelog when user-visible behavior changes.
- Do not publish releases, attach public artifacts, or change branch protection
  from a pull request.
