# GH-27 Tasks

## Implementation Tasks

- [x] `REL27-T1` Owner: codex. Done when: the upstream ccstats GH27 notes no longer occupy `specs/GH27`, and this issue has product, tech, and task specs. Verify: `find specs/GH27 specs/UPSTREAM-CCSTATS-GH27 -maxdepth 1 -type f -print`.
- [x] `REL27-T2` Owner: codex. Done when: README and `docs/release.md` describe the first-release path, source-build fallback, artifact workflow, and no auto-publish boundary. Verify: `rg -n "Release Artifacts|First-release|release-artifacts|Do not publish" README.md docs/release.md`.
- [x] `REL27-T3` Owner: codex. Done when: public project hygiene files exist for security, contribution, and conduct. Verify: `test -f SECURITY.md && test -f CONTRIBUTING.md && test -f CODE_OF_CONDUCT.md`.
- [x] `REL27-T4` Owner: codex. Done when: Tauri CSP is restricted instead of `null`. Verify: `rg -n "\"csp\"|ipc: http://ipc.localhost|unsafe-inline" src-tauri/tauri.conf.json`.
- [x] `REL27-T5` Owner: codex. Done when: a release artifact workflow builds macOS and Windows bundles and uploads workflow artifacts without creating a release. Verify: `rg -n "Release Artifacts|upload-artifact|workflow_dispatch|tauri build" .github/workflows/release-artifacts.yml`.
- [x] `REL27-T6` Owner: codex. Done when: GitHub repo metadata no longer points to the old `quota-menubar-tauri` homepage. Verify: `gh repo view majiayu000/quotabar --json homepageUrl,description,repositoryTopics`.
- [x] `REL27-T7` Owner: codex. Done when: project verification passes. Verify: `npm test && npm run build && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml && npm run tauri build -- --bundles app`.

## Handoff Notes

This issue intentionally stops before publishing a GitHub Release. Release creation, public installer upload, signing, notarization, and branch-protection policy changes remain human-gated.
