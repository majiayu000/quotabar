# Release Notes

QuotaBar does not currently have a published GitHub release.

## Build Artifacts

Release builds should be produced from a clean checkout with:

```bash
npm ci
npm run tauri build -- --bundles app
```

macOS app bundle:

```text
src-tauri/target/release/bundle/macos/QuotaBar.app
```

Windows installer bundles:

```text
src-tauri/target/release/bundle/msi/
src-tauri/target/release/bundle/nsis/
```

Attach the generated platform bundle to the GitHub release for the matching tag.

## Pre-release Verification

Run these commands before tagging:

```bash
npm test
npm run build
cd src-tauri && cargo fmt --check
cd src-tauri && cargo check
cd src-tauri && cargo test
```

Do not include provider tokens, cookies, session files, or local auth material in release artifacts.
