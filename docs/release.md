# First-Release Runbook

QuotaBar does not currently have a published GitHub Release.

This runbook prepares release artifacts, but it does not authorize publishing.
Create the public release only after a human approves the tag, artifacts, release
notes, and signing/notarization decision.

## Release Gates

Before tagging:

- Working tree is clean and based on `origin/main`.
- Version matches in `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json`.
- `CHANGELOG.md` has release notes outside `Unreleased`.
- README install, limitations, and troubleshooting sections match current
  behavior.
- Demo proof has been refreshed or explicitly accepted as current.
- No provider tokens, cookies, session files, or local auth material are present
  in the repository or release artifacts.
- CI is green on `main`.

## Local Verification

Run from a clean checkout:

```bash
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
```

Refresh the browser-preview visual proof only when the UI has changed:

```bash
npm run dev -- --host 127.0.0.1
npx playwright screenshot --wait-for-timeout=3500 --viewport-size=340,580 http://127.0.0.1:1420 docs/assets/quotabar-no-provider-preview.png
```

## Artifact Workflow

Use the `release-artifacts` workflow to produce downloadable bundles for
inspection:

```bash
gh workflow run release-artifacts.yml
```

The workflow uploads GitHub Actions artifacts only. It does not create tags,
publish GitHub Releases, or attach files to a public release.

Expected artifact contents:

- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`
- Windows: `src-tauri/target/release/bundle/msi/*.msi`
- Windows: `src-tauri/target/release/bundle/nsis/*.exe`

For a local macOS smoke test, build the app bundle and install it:

```bash
npm run tauri build -- --bundles app
./scripts/reinstall_and_run.sh
```

## Publishing

Publishing is a separate human-gated step:

1. Decide whether this release is signed/notarized. Unsigned macOS builds may
   trigger Gatekeeper warnings and should be labeled as tester builds.
2. Create an annotated tag only after the release notes are final.
3. Create the GitHub Release manually.
4. Attach the inspected workflow artifacts to the release.
5. Record the release URL and the exact verification commands used.

Do not publish a release from an unreviewed workflow run.
