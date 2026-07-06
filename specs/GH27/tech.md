# GH-27 Tech Spec: First Public Release Readiness

## Proposed Design

Use a repository-preparation PR rather than publishing a release directly.

Documentation changes:

- Update README release and install sections so outside users understand the current no-release state, source-build path, and release artifact plan.
- Replace the stale repository rename section with support and security-report guidance.
- Expand `docs/release.md` into a first-release runbook with local verification, release artifact workflow usage, and explicit human gate before tag/release publication.
- Add `SECURITY.md`, `CONTRIBUTING.md`, and `CODE_OF_CONDUCT.md` for public project hygiene.

Workflow changes:

- Add `.github/workflows/release-artifacts.yml`.
- Run on pull requests touching release-critical paths and on manual dispatch.
- Build macOS and Windows bundles on pinned hosted runners.
- Upload workflow artifacts with `actions/upload-artifact`.
- Do not create or mutate GitHub Releases.

Security changes:

- Replace `app.security.csp: null` with a restrictive CSP object for local bundled assets, Tauri IPC, inline CSS needed by the current React/CSS stack, and image data URLs.
- Keep Tauri capabilities scoped to core, opener, and notification permissions.

Metadata changes:

- Update GitHub repository metadata out of band with `gh repo edit` so the homepage no longer points at the old repo and topics reflect current providers.

## Test Plan

- `npm test`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri build -- --bundles app`

## Rollback Plan

Revert the PR. The release workflow is artifact-only and does not publish releases, so rollback does not need to delete release assets. If the CSP breaks the desktop shell, revert only the CSP object to the previous release branch state and keep the docs/community files.
