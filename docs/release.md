# First-Release Runbook

QuotaBar's first published GitHub Release is `v0.2.0`.

This runbook prepares future release artifacts, but it does not authorize
publishing. Create a public release only after a human approves the tag,
artifacts, release notes, and signing/notarization decision.

## Release Gates

Before tagging:

- Working tree is clean and based on `origin/main`.
- `npm run release:check` confirms the version matches in `package.json`,
  `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
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
npm run release:check
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

This captures the default browser-preview state without a Tauri desktop
backend. Do not seed local storage, provider credentials, sessions, or fake
quota percentages for this proof.

## Artifact Workflow

Use the `release-artifacts` workflow to produce downloadable bundles for
inspection:

```bash
gh workflow run release-artifacts.yml
```

The workflow uploads GitHub Actions artifacts only. It does not create tags,
publish GitHub Releases, or attach files to a public release.

The default `unsigned` mode remains available for pull requests and internal
artifact inspection. It must not be presented as a trusted public macOS build.
After the signing secrets below are configured, build a public macOS release
candidate with:

```bash
gh workflow run release-artifacts.yml -f macos_signing=developer-id
```

The `developer-id` mode fails before building when any required secret is
missing. It imports the certificate into an ephemeral runner keychain, asks
Tauri to sign and notarize the app, verifies the resulting app with `codesign`,
Gatekeeper, and `stapler`, then removes the temporary certificate and key.

Required GitHub Actions secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `APPLE_API_ISSUER`: App Store Connect API issuer ID
- `APPLE_API_KEY`: App Store Connect API key ID
- `APPLE_API_PRIVATE_KEY`: complete contents of the matching `.p8` private key

Expected artifact contents:

- macOS Apple Silicon: `src-tauri/target/release/bundle/dmg/*_aarch64.dmg`
- macOS Intel: `src-tauri/target/release/bundle/dmg/*_x64.dmg`
- Windows: `src-tauri/target/release/bundle/msi/*.msi`
- Windows: `src-tauri/target/release/bundle/nsis/*.exe`
- Linux x64: `src-tauri/target/release/bundle/appimage/*.AppImage`

Every uploaded workflow artifact also contains a `SHA256SUMS` text file. Verify
downloaded macOS or Linux files from the directory containing the bundle:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

On Linux, `sha256sum -c SHA256SUMS.txt` is also supported. On Windows, compare
the installer hash with `SHA256SUMS-windows.txt`:

```powershell
Get-FileHash -Algorithm SHA256 .\QuotaBar_*.exe
Get-FileHash -Algorithm SHA256 .\QuotaBar_*.msi
```

For a local macOS smoke test, build the app bundle and install it:

```bash
npm run tauri build -- --bundles app
./scripts/reinstall_and_run.sh
```

## Publishing

Publishing is a separate human-gated step:

1. Confirm the candidate's signing mode in the workflow run. A public macOS
   release must use `developer-id`; unsigned builds are tester artifacts only.
2. Create an annotated tag only after the release notes are final.
3. Create the GitHub Release manually.
4. Attach the inspected bundles and their SHA-256 manifests to the release.
5. Record the release URL and the exact verification commands used.

Do not publish a release from an unreviewed workflow run.
