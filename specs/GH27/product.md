# GH-27 Product Spec: First Public Release Readiness

## Goals

- Prepare QuotaBar for a first public desktop-app release without publishing the release.
- Make the repository understandable and safe for outside users and contributors.
- Provide a manual release artifact workflow that can build downloadable desktop bundles before a release is cut.
- Keep the current honest product boundary: provider credentials are read locally, release artifacts are not published yet, and Antigravity quota tracking remains pending provider support.

## Non-Goals

- Do not publish a GitHub Release.
- Do not upload installer artifacts to a public release.
- Do not add branch protection or merge policy settings.
- Do not add provider quota features or change quota semantics.

## Acceptance Criteria

- README and release docs explain the current install and release status without stale rename guidance.
- GitHub metadata no longer points to the old `quota-menubar-tauri` homepage.
- `SECURITY.md` and `CONTRIBUTING.md` exist with QuotaBar-specific credential and token boundaries.
- A release workflow can build and upload macOS and Windows desktop artifacts as workflow artifacts without auto-publishing a GitHub Release.
- Tauri CSP is restricted for the bundled React UI and Tauri IPC instead of being disabled with `csp: null`.
- The pre-existing upstream ccstats GH27 notes no longer occupy the local `specs/GH27` namespace.
- Fresh frontend and Rust verification passes.
