# Changelog

All notable QuotaBar changes should be summarized here before a release is cut.

## Unreleased

- None.

## 0.2.0 - 2026-07-06

- Added an artifact-only GitHub Actions workflow for macOS and Windows release bundle inspection.
- Added SECURITY, CONTRIBUTING, and CODE_OF_CONDUCT files for public project readiness.
- Replaced the disabled Tauri CSP with a restricted policy for bundled UI assets and IPC.
- Clarified first-release gates, source-build fallback, and the no-auto-publish release boundary.
- Reduced local cost refresh work by using ccstats multi-range summaries for Today, This Week, and This Month in one pass.
- Added a browser-preview demo proof screenshot and documented its no-credential capture scope.
- Report an explicit desktop-backend-unavailable error when the UI is opened outside Tauri.
- Added CI coverage for frontend tests, frontend build, Rust formatting, Rust check, and Rust tests.
- Added GitHub issue templates and a pull request template.
- Documented release artifact paths and current limitations.
- Existing application version. Historical release notes were not tracked before this changelog.
